import { stat } from "node:fs/promises";
import { join } from "node:path";
import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import type { QuickJevClassifyRequest } from "@quick/shared";
import { bodyLimit } from "hono/body-limit";
import { jevConfig, sitesRoot } from "../config";
import { JevError, classifyWithJev, createJevLimiter, type JevConfig, type JevLimiter } from "../jev";
import { errorResponseSchema, quickJevClassifyRequestSchema, quickJevClassifyResponseSchema, siteHeaderSchema } from "../schemas";
import { readAuthSession } from "./auth";

const siteNamePattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const maxRequestBytes = 64 * 1024;
const limiter = createJevLimiter();

function jevError(message: string) {
  return { error: message };
}

async function isDeployedSite(site: string) {
  return Boolean((await stat(join(sitesRoot, site, "index.html")).catch(() => undefined))?.isFile());
}

const apiErrorSchema = errorResponseSchema.openapi("JevErrorResponse");
const apiRequestSchema = quickJevClassifyRequestSchema.openapi("QuickJevClassifyRequest");
const apiResponseSchema = quickJevClassifyResponseSchema.openapi("QuickJevClassifyResponse");
const apiSiteHeaderSchema = siteHeaderSchema.openapi("JevSiteHeader", {
  description: "Site name, set by the trusted Quick edge from the request host.",
});
const errorJson = (description: string) => ({
  content: { "application/json": { schema: apiErrorSchema } },
  description,
});

type JevRouteDependencies = {
  isDeployedSite: typeof isDeployedSite;
  readAuthSession: typeof readAuthSession;
  classify: typeof classifyWithJev;
  config: JevConfig | undefined;
  limiter: JevLimiter;
};

export function registerJevRoutes(app: OpenAPIHono, overrides: Partial<JevRouteDependencies> = {}) {
  const dependencies: JevRouteDependencies = {
    isDeployedSite,
    readAuthSession,
    classify: classifyWithJev,
    config: jevConfig,
    limiter,
    ...overrides,
  };
  app.openapi(
    createRoute({
      method: "post",
      path: "/jev/classify",
      middleware: bodyLimit({
        maxSize: maxRequestBytes,
        onError: (c) => c.json(jevError("Request body is too large"), 413),
      }),
      request: {
        headers: apiSiteHeaderSchema,
        body: { content: { "application/json": { schema: apiRequestSchema } }, required: true },
      },
      responses: {
        200: {
          content: { "application/json": { schema: apiResponseSchema } },
          description: "Structured classifier answers for every requested question.",
        },
        400: errorJson("Invalid request, site context, or state nesting."),
        401: errorJson("Authentication required."),
        403: errorJson("A deployed site is required."),
        413: errorJson("Request body is too large."),
        429: errorJson("Rate or concurrency limit exceeded."),
        502: errorJson("Upstream failure or invalid upstream response."),
        503: errorJson("Jev classification is not configured."),
        504: errorJson("Upstream timeout."),
      },
    }),
    async (c) => {
      const site = c.req.header("X-Quick-Site")?.trim();
      if (!site || !siteNamePattern.test(site)) return c.json(jevError("A valid Quick site context is required"), 400);
      if (!await dependencies.isDeployedSite(site)) return c.json(jevError("A deployed Quick site context is required"), 403);
      const session = await dependencies.readAuthSession(c);
      if (!session) return c.json(jevError("Authentication required"), 401);
      const config = dependencies.config;
      if (!config) return c.json(jevError("Jev classification is not configured"), 503);

      let release: (() => void) | undefined;
      try {
        release = dependencies.limiter.acquire(`${site}\n${session.user.id}`, site);
        const body = c.req.valid("json");
        const response = await dependencies.classify(body as QuickJevClassifyRequest, config);
        return c.json(response, 200);
      } catch (error) {
        if (error instanceof JevError) return c.json(jevError(error.message), error.status);
        console.error("[jev] classify failed", error);
        return c.json(jevError("Jev classification failed"), 502);
      } finally {
        release?.();
      }
    },
  );
}
