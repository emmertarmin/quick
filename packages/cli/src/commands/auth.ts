import { createClient } from "@openauthjs/openauth/client";
import type { CommandDefinition } from "../cli/types.js";
import type { QuickSessionResponse } from "../api-types.js";
import { clearAuth, getAuthPath, loadAuth, saveAuth, type StoredAuth } from "../config/auth.js";
import { resolveRemote } from "../config/remote.js";

function apiUrl(remote: string, path: string) {
  const url = new URL(remote);
  const basePath = url.pathname.replace(/\/+$/, "");
  const apiBasePath = basePath.endsWith("/api") || basePath === "/api" ? basePath : `${basePath}/api`;
  url.pathname = `${apiBasePath}${path}`.replace(/\/+/g, "/");
  return url.toString();
}

function openBrowser(url: string) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];

  try {
    Bun.spawn([command, ...args], {
      stdout: "ignore",
      stderr: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

async function waitForAuthorizationCode(successRedirectUrl: string) {
  let resolveCode: (code: string) => void;
  let rejectCode: (error: Error) => void;

  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const stopServerSoon = () => {
    setTimeout(() => server.stop(true), 500);
  };

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);

      if (url.pathname !== "/callback") {
        return new Response("Not found", { status: 404 });
      }

      const error = url.searchParams.get("error");
      if (error) {
        rejectCode(new Error(error));
        stopServerSoon();
        return new Response("Quick login failed. You can close this tab.", {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
          status: 400,
        });
      }

      const code = url.searchParams.get("code");
      if (!code) {
        rejectCode(new Error("Missing authorization code"));
        stopServerSoon();
        return new Response("Quick login failed: missing authorization code. You can close this tab.", {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
          status: 400,
        });
      }

      resolveCode(code);
      stopServerSoon();
      return new Response(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="refresh" content="5; url=${escapeHtml(successRedirectUrl)}">
    <title>Quick login complete</title>
    <style>
      :root { color-scheme: light dark; --bg: #ffffff; --text: #111827; --muted: #6b7280; --border: #bbf7d0; --surface: #f0fdf4; --link: #15803d; --success: #16a34a; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 2rem; background: var(--bg); color: var(--text); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      main { width: min(100%, 28rem); padding: 2rem; border: 1px solid var(--border); border-radius: 0.9rem; background: var(--surface); text-align: center; box-shadow: 0 20px 50px rgb(22 163 74 / 0.12); }
      .mark { display: inline-grid; place-items: center; width: 2.75rem; height: 2.75rem; margin-bottom: 1rem; border-radius: 999px; background: var(--success); color: white; font-size: 1.6rem; line-height: 1; }
      h1 { margin: 0 0 0.75rem; font-size: 1.5rem; line-height: 1.2; }
      p { margin: 0; color: var(--muted); line-height: 1.5; }
      p + p { margin-top: 0.5rem; }
      a { color: var(--link); }
      @media (prefers-color-scheme: dark) { :root { --bg: #0b0f19; --text: #f9fafb; --muted: #9ca3af; --border: #14532d; --surface: #052e16; --link: #86efac; --success: #22c55e; } main { box-shadow: none; } }
    </style>
  </head>
  <body>
    <main>
      <div class="mark" aria-hidden="true">✓</div>
      <h1>Quick login complete</h1>
      <p>You can close this tab and return to your terminal.</p>
      <p>Redirecting to <a href="${escapeHtml(successRedirectUrl)}">Quick</a> in <span id="countdown">5</span> seconds…</p>
    </main>
    <script>
      const redirectUrl = ${JSON.stringify(successRedirectUrl)};
      const countdown = document.querySelector("#countdown");
      let remaining = 5;
      const interval = setInterval(() => {
        remaining -= 1;
        countdown.textContent = String(remaining);
        if (remaining <= 0) {
          clearInterval(interval);
          window.location.assign(redirectUrl);
        }
      }, 1000);
    </script>
  </body>
</html>`, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    },
  });

  return {
    callbackUrl: `http://127.0.0.1:${server.port}/callback`,
    code: codePromise,
  };
}

async function fetchSession(remote: string, auth: Pick<StoredAuth, "accessToken" | "refreshToken">) {
  const response = await fetch(apiUrl(remote, "/auth/session"), {
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      "X-Quick-Refresh-Token": auth.refreshToken,
    },
  });

  const accessToken = response.headers.get("X-Quick-Access-Token");
  const refreshToken = response.headers.get("X-Quick-Refresh-Token");
  const body = (await response.json().catch(() => undefined)) as QuickSessionResponse | undefined;

  return { response, body, tokens: accessToken && refreshToken ? { accessToken, refreshToken } : undefined };
}

export async function loadAuthForRemote(remote: string) {
  const auth = await loadAuth();
  if (!auth || auth.remote !== remote) {
    throw new Error(`Not logged in to ${remote}. Run \`quick auth login\`.`);
  }

  return auth;
}

export async function verifyAuthForRemote(remote: string, auth: StoredAuth) {
  const session = await fetchSession(remote, auth);
  if (!session.response.ok || !session.body?.authenticated) {
    return { authenticated: false as const, auth };
  }

  const nextAuth = { ...auth, ...session.tokens, user: session.body.user };
  await saveAuth(nextAuth);
  return { authenticated: true as const, auth: nextAuth, user: session.body.user };
}

export async function refreshAuthFromResponse(remote: string, auth: StoredAuth, response: Response) {
  const accessToken = response.headers.get("X-Quick-Access-Token");
  const refreshToken = response.headers.get("X-Quick-Refresh-Token");

  if (!accessToken || !refreshToken) {
    return auth;
  }

  const nextAuth = { ...auth, accessToken, refreshToken };
  await saveAuth(nextAuth);
  return nextAuth;
}

const loginCommand: CommandDefinition = {
  name: "login",
  summary: "Log in to Quick",
  flags: [
    {
      name: "remote",
      type: "string",
      description: "Quick server URL. Overrides QUICK_REMOTE and config remote.",
    },
  ],
  execute: async ({ values }) => {
    const remote = await resolveRemote({ remoteFlag: values.remote });
    const client = createClient({ clientID: "quick-cli", issuer: remote });
    const callback = await waitForAuthorizationCode(remote);
    const { url } = await client.authorize(callback.callbackUrl, "code");

    console.log(`Opening browser for Quick login: ${url}`);
    if (!openBrowser(url)) {
      console.log(`Open this URL in your browser:\n${url}`);
    } else {
      console.log(`If the browser does not open, visit:\n${url}`);
    }

    const code = await callback.code;
    const exchanged = await client.exchange(code, callback.callbackUrl);

    if (exchanged.err) {
      throw new Error("Login failed: could not exchange authorization code");
    }

    const auth: StoredAuth = {
      remote,
      accessToken: exchanged.tokens.access,
      refreshToken: exchanged.tokens.refresh,
    };

    const session = await fetchSession(remote, auth);
    if (!session.response.ok || !session.body?.authenticated) {
      throw new Error("Login failed: could not read authenticated session");
    }

    const nextAuth = {
      ...auth,
      ...session.tokens,
      user: session.body.user,
    };
    await saveAuth(nextAuth);

    console.log(`Logged in to ${remote} as ${session.body.user.email ?? session.body.user.id}`);
    console.log(`Auth state: ${getAuthPath()}`);
  },
};

const statusCommand: CommandDefinition = {
  name: "status",
  aliases: ["whoami"],
  summary: "Show Quick login status",
  flags: [
    {
      name: "remote",
      type: "string",
      description: "Quick server URL. Overrides QUICK_REMOTE and config remote.",
    },
  ],
  execute: async ({ values }) => {
    const remote = await resolveRemote({ remoteFlag: values.remote });
    const auth = await loadAuth();

    if (!auth || auth.remote !== remote) {
      console.log(`Not logged in to ${remote}`);
      return;
    }

    const session = await fetchSession(remote, auth);
    if (!session.response.ok || !session.body?.authenticated) {
      console.log(`Not logged in to ${remote}`);
      return;
    }

    const nextAuth = { ...auth, ...session.tokens, user: session.body.user };
    await saveAuth(nextAuth);
    console.log(`Logged in to ${remote} as ${session.body.user.email ?? session.body.user.id}`);
  },
};

const logoutCommand: CommandDefinition = {
  name: "logout",
  summary: "Log out of Quick",
  execute: async () => {
    await clearAuth();
    console.log("Logged out.");
  },
};

export const authCommand: CommandDefinition = {
  name: "auth",
  summary: "Log in and manage Quick authentication",
  subcommands: [loginCommand, statusCommand, logoutCommand],
};
