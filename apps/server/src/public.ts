import { extname, join, resolve, sep } from "node:path";
import { stat } from "node:fs/promises";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { quickDomain, quickScheme, sitesRoot } from "./config";

const repoRoot = resolve(import.meta.dir, "../../..");
const platformWebRoot = resolve(repoRoot, "apps/web/dist");
const publicServerPaths = new Set(["/quick.js", "/authorize", "/token"]);
const apexServerPaths = new Set(["/health", "/doc", "/ui", "/skills/quick/SKILL.md"]);
// Upgrade requests must reach Hono with Bun's original Request so server.upgrade(c.req.raw) works.
// Store site metadata out-of-band for that original Request; if future middleware replaces c.req.raw,
// it must preserve or rederive this metadata before realtime WebSocket handlers run.
const publicRequestSites = new WeakMap<Request, string | undefined>();
type BunServer = ReturnType<typeof Bun.serve>;

export function getPublicRequestSite(request: Request) {
  return publicRequestSites.get(request);
}

function stripPort(host: string) {
  return host.split(":")[0] ?? host;
}

function forwardedProto(request: Request) {
  return request.headers.get("X-Forwarded-Proto") ?? quickScheme;
}

function forwardedHost(request: Request) {
  return request.headers.get("X-Forwarded-Host") ?? request.headers.get("Host");
}

function publicUrl(request: Request) {
  const url = new URL(request.url);
  const host = forwardedHost(request) ?? quickDomain;
  return `${forwardedProto(request)}://${host}${url.pathname}${url.search}`;
}

function siteFromHost(request: Request) {
  const url = new URL(request.url);
  const host = stripPort(forwardedHost(request) ?? url.host);

  if (host === quickDomain) {
    return undefined;
  }

  const suffix = `.${quickDomain}`;
  if (!host.endsWith(suffix)) {
    return undefined;
  }

  const prefix = host.slice(0, -suffix.length);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(prefix)) {
    return undefined;
  }

  return prefix;
}

function withQuickHeaders(request: Request, site: string | undefined, pathname?: string) {
  const url = new URL(request.url);
  if (pathname) {
    url.pathname = pathname;
  }

  const headers = new Headers(request.headers);
  if (site) {
    headers.set("X-Quick-Site", site);
  } else {
    headers.delete("X-Quick-Site");
  }

  headers.set("X-Forwarded-Proto", forwardedProto(request));
  const host = forwardedHost(request);
  if (host) {
    headers.set("X-Forwarded-Host", host);
  } else {
    headers.delete("X-Forwarded-Host");
  }

  return new Request(url, {
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    duplex: "half",
    headers,
    method: request.method,
  } as RequestInit & { duplex: "half" });
}

function isUpgradeRequest(request: Request) {
  return request.headers.get("Upgrade")?.toLowerCase() === "websocket";
}

function fetchApp(app: OpenAPIHono, request: Request, server?: BunServer) {
  return app.fetch(request, server);
}

function apiPath(pathname: string) {
  if (pathname === "/api") {
    return "/";
  }

  if (pathname.startsWith("/api/")) {
    return pathname.slice(4);
  }

  return undefined;
}

function isServerPath(pathname: string, site: string | undefined) {
  return publicServerPaths.has(pathname)
    || (!site && apexServerPaths.has(pathname))
    || pathname.startsWith("/.well-known/")
    || pathname.startsWith("/code/")
    || pathname.startsWith("/microsoft/");
}

function contentType(path: string) {
  switch (extname(path).toLowerCase()) {
    case ".html": return "text/html; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".mjs": return "text/javascript; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".svg": return "image/svg+xml";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".gif": return "image/gif";
    case ".webp": return "image/webp";
    case ".ico": return "image/x-icon";
    case ".txt": return "text/plain; charset=utf-8";
    default: return "application/octet-stream";
  }
}

function safeJoin(root: string, pathname: string) {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }

  if (decoded.includes("\0")) {
    return undefined;
  }

  const relative = decoded.replace(/^\/+/, "");
  const target = resolve(root, relative);
  const rootWithSep = root.endsWith(sep) ? root : `${root}${sep}`;

  if (target !== root && !target.startsWith(rootWithSep)) {
    return undefined;
  }

  return target;
}

async function readableFile(path: string) {
  const info = await stat(path).catch(() => undefined);
  if (info?.isFile()) return path;
  if (info?.isDirectory()) {
    const index = join(path, "index.html");
    const indexInfo = await stat(index).catch(() => undefined);
    if (indexInfo?.isFile()) return index;
  }
  return undefined;
}

async function fileResponse(path: string) {
  const file = Bun.file(path);
  return new Response(file, {
    headers: {
      "Cache-Control": "no-cache",
      "Content-Type": contentType(path),
    },
  });
}

async function servePlatformStatic(pathname: string) {
  const target = safeJoin(platformWebRoot, pathname);
  if (!target) return new Response("Bad request", { status: 400 });

  const file = await readableFile(target) ?? await readableFile(join(platformWebRoot, "index.html"));
  if (!file) return new Response("Platform web app has not been built. Run `bun run --cwd apps/web build` or `bun run build`.", { status: 503 });

  return fileResponse(file);
}

async function serveSiteStatic(site: string, pathname: string) {
  const root = resolve(sitesRoot, site);
  const target = safeJoin(root, pathname);
  if (!target) return new Response("Bad request", { status: 400 });

  const file = await readableFile(target)
    ?? await readableFile(join(target, "index.html"))
    ?? await readableFile(join(root, "index.html"));

  if (!file) return new Response("Not found", { status: 404 });
  return fileResponse(file);
}

async function verifySiteAuth(app: OpenAPIHono, request: Request, site: string) {
  const headers = new Headers(request.headers);
  headers.set("X-Quick-Site", site);
  headers.set("X-Original-URI", publicUrl(request));
  headers.set("X-Forwarded-Proto", forwardedProto(request));
  const host = forwardedHost(request);
  if (host) {
    headers.set("X-Forwarded-Host", host);
  } else {
    headers.delete("X-Forwarded-Host");
  }

  const verifyUrl = new URL(request.url);
  verifyUrl.pathname = "/internal/auth/verify";
  verifyUrl.search = "";

  return app.fetch(new Request(verifyUrl, { headers, method: "GET" }));
}

async function proxyPlatformDev(request: Request) {
  const upstream = process.env.QUICK_WEB_DEV_UPSTREAM?.trim();
  if (!upstream) return undefined;

  try {
    const upstreamUrl = new URL(request.url);
    const target = new URL(upstream);
    upstreamUrl.protocol = target.protocol;
    upstreamUrl.host = target.host;

    return await fetch(new Request(upstreamUrl, {
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      duplex: "half",
      headers: request.headers,
      method: request.method,
    } as RequestInit & { duplex: "half" }));
  } catch {
    return undefined;
  }
}

export function createPublicFetch(app: OpenAPIHono) {
  return async function publicFetch(request: Request, server?: BunServer) {
    const url = new URL(request.url);
    const site = siteFromHost(request);
    const strippedApiPath = apiPath(url.pathname);

    publicRequestSites.set(request, site);

    if (strippedApiPath) {
      if (isUpgradeRequest(request)) {
        return fetchApp(app, request, server);
      }

      return fetchApp(app, withQuickHeaders(request, site, strippedApiPath), server);
    }

    if (isServerPath(url.pathname, site)) {
      return fetchApp(app, withQuickHeaders(request, site), server);
    }

    if (site) {
      const verified = await verifySiteAuth(app, request, site);
      if (verified.status === 401) {
        const login = verified.headers.get("X-Quick-Auth-Login")
          ?? `${forwardedProto(request)}://${quickDomain}/api/auth/login?return_to=${encodeURIComponent(publicUrl(request))}`;
        return Response.redirect(login, 302);
      }
      if (!verified.ok) return verified;

      return serveSiteStatic(site, url.pathname);
    }

    const devResponse = await proxyPlatformDev(request);
    if (devResponse && ![502, 503, 504].includes(devResponse.status)) return devResponse;

    return servePlatformStatic(url.pathname);
  };
}
