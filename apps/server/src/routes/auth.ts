import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { issuer } from "@openauthjs/openauth";
import { createClient } from "@openauthjs/openauth/client";
import { CodeProvider, type CodeProviderError, type CodeProviderState } from "@openauthjs/openauth/provider/code";
import { MicrosoftProvider } from "@openauthjs/openauth/provider/microsoft";
import { createSubjects } from "@openauthjs/openauth/subject";
import { openAuthSqliteStorage } from "@quick/db";
import type { QuickUser } from "@quick/shared";
import {
  errorResponseSchema,
  quickAnonymousSessionSchema,
  quickLoginResponseSchema,
  quickSessionResponseSchema,
} from "../schemas";
import * as v from "valibot";
import { codeAuthEnabled, entraConfig, port, quickDomain } from "../config";

const AUTH_ACCESS_COOKIE = "quick_access_token";
const AUTH_REFRESH_COOKIE = "quick_refresh_token";
const AUTH_RETURN_TO_COOKIE = "quick_return_to";
const OPENAUTH_CLIENT_ID = "quick-platform";

const openAuthSubjects = createSubjects({
  user: v.object({
    id: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
  }),
});

type AuthSession = {
  user: QuickUser;
};

function forwardedProto(c: Context) {
  return c.req.header("X-Forwarded-Proto") ?? new URL(c.req.url).protocol.replace(":", "");
}

function publicPlatformOrigin(c: Context) {
  return `${forwardedProto(c)}://${quickDomain}`;
}

function stripPort(host: string) {
  return host.split(":")[0] ?? host;
}

function isQuickHost(hostname: string) {
  return hostname === quickDomain || hostname.endsWith(`.${quickDomain}`);
}

function sanitizeReturnTo(value: string | undefined) {
  if (!value) {
    return "/";
  }

  if (value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }

  try {
    const url = new URL(value);

    if ((url.protocol === "https:" || url.protocol === "http:") && isQuickHost(url.hostname)) {
      return url.toString();
    }
  } catch {
    return "/";
  }

  console.warn(`[auth] rejected unsafe return_to: ${value}`);
  return "/";
}

function authReturnTo(c: Context) {
  return sanitizeReturnTo(c.req.query("return_to") || c.req.query("returnTo"));
}

function authCookieDomain(c: Context) {
  const host = stripPort(c.req.header("X-Forwarded-Host") ?? c.req.header("Host") ?? new URL(c.req.url).host);

  if (!isQuickHost(host)) {
    return undefined;
  }

  return process.env.QUICK_COOKIE_DOMAIN ?? `.${quickDomain}`;
}

function authCookieOptions(c: Context, maxAge: number) {
  return {
    domain: authCookieDomain(c),
    httpOnly: true,
    maxAge,
    path: "/",
    sameSite: "Lax" as const,
    secure: true,
  };
}

function writeTokenCookies(c: Context, tokens: { access: string; refresh: string }) {
  setCookie(c, AUTH_ACCESS_COOKIE, tokens.access, authCookieOptions(c, 60 * 60 * 24 * 30));
  setCookie(c, AUTH_REFRESH_COOKIE, tokens.refresh, authCookieOptions(c, 60 * 60 * 24 * 365));
}

function clearAuthSession(c: Context) {
  const options = { domain: authCookieDomain(c), path: "/", secure: true };
  deleteCookie(c, AUTH_ACCESS_COOKIE, options);
  deleteCookie(c, AUTH_REFRESH_COOKIE, options);
  deleteCookie(c, AUTH_RETURN_TO_COOKIE, options);
}

function openAuthClient(c: Context) {
  const origin = publicPlatformOrigin(c);
  const internalOrigin = `http://127.0.0.1:${port}`;
  const forwardedHost = quickDomain;
  const forwardedScheme = forwardedProto(c);

  return createClient({
    clientID: OPENAUTH_CLIENT_ID,
    issuer: origin,
    fetch: async (input, init) => {
      const url = new URL(input.toString());

      if (url.origin === origin) {
        const internalUrl = new URL(`${url.pathname}${url.search}`, internalOrigin);
        const headers = new Headers(init?.headers);
        headers.set("Host", forwardedHost);
        headers.set("X-Forwarded-Host", forwardedHost);
        headers.set("X-Forwarded-Proto", forwardedScheme);

        return fetch(internalUrl, { ...init, headers });
      }

      return fetch(input, init);
    },
  });
}

function bearerToken(c: Context) {
  const authorization = c.req.header("Authorization") ?? "";
  return authorization.match(/^Bearer\s+(.+)$/i)?.[1];
}

export async function readAuthSession(c: Context): Promise<AuthSession | undefined> {
  const bearerAccess = bearerToken(c);
  const access = bearerAccess ?? getCookie(c, AUTH_ACCESS_COOKIE);
  const refresh = bearerAccess ? c.req.header("X-Quick-Refresh-Token") : getCookie(c, AUTH_REFRESH_COOKIE);

  if (!access) {
    return undefined;
  }

  const verified = await openAuthClient(c).verify(openAuthSubjects, access, { refresh });

  if (verified.err) {
    return undefined;
  }

  if (verified.tokens) {
    if (bearerAccess) {
      c.header("X-Quick-Access-Token", verified.tokens.access);
      c.header("X-Quick-Refresh-Token", verified.tokens.refresh);
    } else {
      writeTokenCookies(c, verified.tokens);
    }
  }

  if (verified.subject.type !== "user") {
    return undefined;
  }

  return { user: verified.subject.properties };
}

async function openAuthAuthorizeUrl(c: Context, returnTo: string) {
  const callbackUrl = `${publicPlatformOrigin(c)}/api/auth/callback`;
  const authorizeOptions = entraConfig || !codeAuthEnabled ? undefined : { provider: "code" };
  const { url } = await openAuthClient(c).authorize(callbackUrl, "code", authorizeOptions);
  setCookie(c, AUTH_RETURN_TO_COOKIE, returnTo, authCookieOptions(c, 60 * 10));
  return url;
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function codeProviderPage(state: CodeProviderState, form?: FormData, error?: CodeProviderError) {
  const email = form?.get("email")?.toString() ?? "dev@quick.local";
  const errorHtml = error ? `<p style="color: #b00020">${escapeHtml(error.type)}</p>` : "";
  const codeHtml = state.type === "code" ? `<p>Development code: <strong>${escapeHtml(state.code)}</strong></p>` : "";

  return new Response(`<!doctype html>
<title>Quick login</title>
<body style="font-family: sans-serif; max-width: 36rem; margin: 4rem auto; line-height: 1.4">
  <h1>Quick login</h1>
  ${errorHtml}
  ${codeHtml}
  ${state.type === "start" ? `<form method="post"><input type="hidden" name="action" value="request"><label>Email <input name="email" type="email" value="${escapeHtml(email)}"></label> <button>Send code</button></form>` : `<form method="post"><input type="hidden" name="action" value="verify"><label>Code <input name="code" inputmode="numeric" autofocus></label> <button>Verify</button></form><form method="post"><input type="hidden" name="action" value="resend"><input type="hidden" name="email" value="${escapeHtml(email)}"><button>Resend</button></form>`}
</body>`, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

const codeProvider = CodeProvider<{ email: string }>({
  length: 6,
  request: async (_request, state, form, error) => codeProviderPage(state, form, error),
  sendCode: async (claims, code) => {
    if (!claims.email?.includes("@")) {
      return { type: "invalid_claim", key: "email", value: claims.email ?? "" };
    }

    console.log(`[auth] development login code for ${claims.email}: ${code}`);
  },
});

const openAuthProviders: {
  code?: typeof codeProvider;
  microsoft?: ReturnType<typeof MicrosoftProvider>;
} = {};

if (codeAuthEnabled) {
  openAuthProviders.code = codeProvider;
}

if (entraConfig) {
  openAuthProviders.microsoft = MicrosoftProvider({
    tenant: entraConfig.tenant,
    clientID: entraConfig.clientID,
    clientSecret: entraConfig.clientSecret,
    scopes: ["openid", "profile", "email", "User.Read"],
  });
}

async function microsoftUser(accessToken: string) {
  const response = await fetch("https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Microsoft Graph /me failed: ${response.status} ${await response.text()}`);
  }

  const profile = await response.json() as {
    id?: string;
    displayName?: string;
    mail?: string;
    userPrincipalName?: string;
  };
  const microsoftID = profile.id;
  const email = profile.mail || profile.userPrincipalName;

  if (!microsoftID && !email) {
    throw new Error("Microsoft Graph /me did not return an id or email");
  }

  return {
    id: email ?? microsoftID!,
    email,
    name: profile.displayName ?? email ?? microsoftID,
    subject: `microsoft:${microsoftID ?? email}`,
  };
}

const openAuthIssuer = issuer({
  allow: async () => true,
  providers: openAuthProviders,
  storage: openAuthSqliteStorage(),
  subjects: openAuthSubjects,
  success: async (ctx, value) => {
    if (!value) {
      throw new Error("Missing OpenAuth success value");
    }

    if (value.provider === "microsoft") {
      const microsoftValue = value as typeof value & { tokenset: { access: string } };
      const user = await microsoftUser(microsoftValue.tokenset.access);
      return ctx.subject(
        "user",
        {
          id: user.id,
          email: user.email,
          name: user.name,
        },
        { subject: user.subject },
      );
    }

    const codeValue = value as typeof value & { claims: { email: string } };
    const email = codeValue.claims.email;
    return ctx.subject(
      "user",
      {
        id: email,
        email,
        name: email,
      },
      { subject: `user:${email}` },
    );
  },
});

const apiErrorResponseSchema = errorResponseSchema.openapi("ErrorResponse");
const apiQuickAnonymousSessionSchema = quickAnonymousSessionSchema.openapi("QuickAnonymousSession");
const apiQuickLoginResponseSchema = quickLoginResponseSchema.openapi("QuickLoginResponse");
const apiQuickSessionResponseSchema = quickSessionResponseSchema.openapi("QuickSessionResponse");

const authQuerySchema = z.object({
  format: z.string().optional().openapi({
    description: "Set to `json` to receive a JSON login-start response instead of a redirect.",
    example: "json",
  }),
  return_to: z.string().optional().openapi({
    description: "Relative or Quick-host URL to return to after login.",
    example: "/dashboard",
  }),
  returnTo: z.string().optional().openapi({
    description: "Alias for return_to.",
    example: "/dashboard",
  }),
});

const callbackQuerySchema = z.object({
  code: z.string().optional().openapi({
    description: "Authorization code returned by OpenAuth.",
  }),
});

const errorJson = (description: string) => ({
  content: {
    "application/json": {
      schema: apiErrorResponseSchema,
    },
  },
  description,
});

const sessionJson = (description: string) => ({
  content: {
    "application/json": {
      schema: apiQuickSessionResponseSchema,
    },
  },
  description,
});

const redirectResponse = (description: string) => ({
  headers: z.object({
    Location: z.string().openapi({
      description: "Redirect target.",
    }),
  }),
  description,
});

export const authRoutes = new OpenAPIHono();

authRoutes.openapi(
  createRoute({
    method: "get",
    path: "/auth/login",
    request: {
      query: authQuerySchema,
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: apiQuickLoginResponseSchema,
          },
        },
        description: "Login start response when format=json.",
      },
      302: redirectResponse("Redirect to OpenAuth authorization flow when format is omitted."),
    },
  }),
  async (c) => {
  const returnTo = authReturnTo(c);
  const authorizationUrl = await openAuthAuthorizeUrl(c, returnTo);

  if (c.req.query("format") === "json") {
    return c.json({
      authenticated: false as const,
      authorizationUrl,
      returnTo,
      user: null,
    });
  }

  return c.redirect(authorizationUrl);
  },
);

authRoutes.openapi(
  createRoute({
    method: "post",
    path: "/auth/login",
    request: {
      query: authQuerySchema,
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: apiQuickLoginResponseSchema,
          },
        },
        description: "Login start response.",
      },
    },
  }),
  async (c) => {
  const returnTo = authReturnTo(c);
  const authorizationUrl = await openAuthAuthorizeUrl(c, returnTo);

  return c.json({
    authenticated: false as const,
    authorizationUrl,
    returnTo,
    user: null,
  });
  },
);

authRoutes.openapi(
  createRoute({
    method: "get",
    path: "/auth/callback",
    request: {
      query: callbackQuerySchema,
    },
    responses: {
      302: redirectResponse("Redirect to the sanitized return_to target after successful login."),
      400: errorJson("Missing authorization code."),
      401: errorJson("Invalid authorization code."),
    },
  }),
  async (c) => {
  const code = c.req.query("code");

  if (!code) {
    return c.json({ error: "Missing authorization code" }, 400);
  }

  const callbackUrl = `${publicPlatformOrigin(c)}/api/auth/callback`;
  const exchanged = await openAuthClient(c).exchange(code, callbackUrl);

  if (exchanged.err) {
    return c.json({ error: "Invalid authorization code" }, 401);
  }

  writeTokenCookies(c, exchanged.tokens);
  const returnTo = sanitizeReturnTo(getCookie(c, AUTH_RETURN_TO_COOKIE));
  deleteCookie(c, AUTH_RETURN_TO_COOKIE, { domain: authCookieDomain(c), path: "/", secure: true });

  return c.redirect(returnTo);
  },
);

authRoutes.openapi(
  createRoute({
    method: "post",
    path: "/auth/logout",
    responses: {
      200: {
        content: {
          "application/json": {
            schema: apiQuickAnonymousSessionSchema,
          },
        },
        description: "Auth cookies cleared.",
      },
    },
  }),
  (c) => {
  clearAuthSession(c);

  return c.json({ authenticated: false as const, user: null });
  },
);

authRoutes.openapi(
  createRoute({
    method: "get",
    path: "/auth/session",
    responses: {
      200: sessionJson("Current authenticated session."),
      401: sessionJson("No valid session."),
    },
  }),
  async (c) => {
  const session = await readAuthSession(c);

  if (!session) {
    return c.json({ authenticated: false as const, user: null }, 401);
  }

  return c.json({ authenticated: true as const, user: session.user }, 200);
  },
);

authRoutes.openapi(
  createRoute({
    method: "get",
    path: "/identity/me",
    responses: {
      200: sessionJson("Current authenticated identity."),
      401: sessionJson("No valid session."),
    },
  }),
  async (c) => {
  const session = await readAuthSession(c);

  if (!session) {
    return c.json({ authenticated: false as const, user: null }, 401);
  }

  return c.json({ authenticated: true as const, user: session.user }, 200);
  },
);

authRoutes.openapi(
  createRoute({
    method: "get",
    path: "/internal/auth/verify",
    request: {
      headers: z.object({
        "X-Original-URI": z.string().optional().openapi({
          description: "Original URI supplied by the edge proxy for login redirects.",
          example: "/",
        }),
      }),
    },
    responses: {
      204: {
        headers: z.object({
          "X-Quick-Auth-User": z.string().openapi({
            description: "Authenticated user id.",
          }),
          "X-Quick-Auth-Email": z.string().optional().openapi({
            description: "Authenticated user email, when known.",
          }),
        }),
        description: "Session verified for the edge proxy.",
      },
      401: {
        headers: z.object({
          "X-Quick-Auth-Login": z.string().openapi({
            description: "Login URL for the edge proxy to redirect unauthenticated requests.",
          }),
        }),
        description: "No valid session.",
      },
    },
  }),
  async (c) => {
  const session = await readAuthSession(c);

  if (!session) {
    c.header("X-Quick-Auth-Login", `${publicPlatformOrigin(c)}/api/auth/login?return_to=${encodeURIComponent(c.req.header("X-Original-URI") ?? "/")}`);
    return c.body(null, 401);
  }

  c.header("X-Quick-Auth-User", session.user.id);
  if (session.user.email) c.header("X-Quick-Auth-Email", session.user.email);

  return c.body(null, 204);
  },
);

// OpenAuth protocol/provider endpoints are mounted but intentionally not duplicated in
// our OpenAPI document. They are owned by @openauthjs/openauth and exposed by the
// edge as /authorize, /token, /.well-known/*, and /code/*.
authRoutes.route("/", openAuthIssuer);
