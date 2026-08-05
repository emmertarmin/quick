import { stat } from "node:fs/promises";
import { join } from "node:path";
import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import type { QuickNetFetchResponse } from "@quick/shared";
import { bodyLimit } from "hono/body-limit";
import { quickDomain, sitesRoot } from "../config";
import { NetFetchError, createNetFetchLimiter, fetchPublicTextResource } from "../net-fetch";
import { errorResponseSchema, quickNetFetchRequestSchema, quickNetFetchResponseSchema, siteHeaderSchema } from "../schemas";
import { readAuthSession } from "./auth";

const siteNamePattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const maxRequestBytes = 8 * 1024;
const limiter = createNetFetchLimiter();

function netError(message: string) {
  return { error: message };
}

async function isDeployedSite(site: string) {
  return Boolean((await stat(join(sitesRoot, site, "index.html")).catch(() => undefined))?.isFile());
}

const apiErrorSchema = errorResponseSchema.openapi("NetFetchErrorResponse");
const apiRequestSchema = quickNetFetchRequestSchema.openapi("QuickNetFetchRequest");
const apiResponseSchema = quickNetFetchResponseSchema.openapi("QuickNetFetchResponse");
const apiSiteHeaderSchema = siteHeaderSchema.openapi("NetFetchSiteHeader", {
  description: "Site name, set by the trusted Quick edge from the request host.",
});
const errorJson = (description: string) => ({
  content: { "application/json": { schema: apiErrorSchema } },
  description,
});

type NetRouteDependencies = {
  isDeployedSite: typeof isDeployedSite;
  readAuthSession: typeof readAuthSession;
  fetchPublicTextResource: typeof fetchPublicTextResource;
};

export function registerNetRoutes(app: OpenAPIHono, overrides: Partial<NetRouteDependencies> = {}) {
  const dependencies: NetRouteDependencies = { isDeployedSite, readAuthSession, fetchPublicTextResource, ...overrides };
  app.openapi(
    createRoute({
      method: "post",
      path: "/net/fetch",
      middleware: bodyLimit({
        maxSize: maxRequestBytes,
        onError: (c) => c.json(netError("Request body is too large"), 413),
      }),
      request: {
        headers: apiSiteHeaderSchema,
        body: { content: { "application/json": { schema: apiRequestSchema } }, required: true },
      },
      responses: {
        200: {
          content: { "application/json": { schema: apiResponseSchema } },
          description: "Constrained text response. Upstream HTTP errors are represented by the status field.",
        },
        400: errorJson("Invalid request or destination URL."),
        401: errorJson("Authentication required."),
        403: errorJson("A deployed site is required, or the destination is forbidden."),
        413: errorJson("Request or upstream response is too large."),
        415: errorJson("Upstream response is not a supported text format."),
        429: errorJson("Rate or concurrency limit exceeded."),
        502: errorJson("DNS, redirect, or upstream request failure."),
        503: errorJson("Quick infrastructure address verification unavailable."),
        504: errorJson("Upstream timeout."),
      },
    }),
    async (c) => {
      const site = c.req.header("X-Quick-Site")?.trim();
      if (!site || !siteNamePattern.test(site)) return c.json(netError("A valid Quick site context is required"), 400);
      if (!await dependencies.isDeployedSite(site)) return c.json(netError("A deployed Quick site context is required"), 403);
      const session = await dependencies.readAuthSession(c);
      if (!session) return c.json(netError("Authentication required"), 401);

      let release: (() => void) | undefined;
      try {
        release = limiter.acquire(`${site}\n${session.user.id}`);
        const body = c.req.valid("json");
        if (!body.url.trim()) {
          return c.json(netError("Expected JSON body with a non-empty URL string"), 400);
        }
        const response: QuickNetFetchResponse = await dependencies.fetchPublicTextResource(body.url, quickDomain);
        return c.json(response, 200);
      } catch (error) {
        if (error instanceof NetFetchError) return c.json(netError(error.message), error.status);
        console.error("[net] fetch failed", error);
        return c.json(netError("Network fetch failed"), 502);
      } finally {
        release?.();
      }
    },
  );
}
