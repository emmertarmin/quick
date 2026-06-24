import { swaggerUI } from "@hono/swagger-ui";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { websocket } from "hono/bun";
import { healthResponseSchema } from "./schemas";
import { authRoutes } from "./routes/auth";
import { registerAiRoutes } from "./routes/ai";
import { registerCollectionRoutes } from "./routes/collections";
import { registerFileRoutes } from "./routes/files";
import { registerSchemaRoutes } from "./routes/schemas";
import { registerSdkRoutes } from "./routes/sdk";
import { registerSkillRoutes } from "./routes/skills";
import { registerSiteRoutes } from "./routes/sites";
import { registerSiteStatsRoutes } from "./routes/site-stats";
import { registerRealtimeRoutes } from "./routes/realtime";
import { port, publicApiBase } from "./config";
import { createPublicFetch } from "./public";

const app = new OpenAPIHono();

app.use("*", async (c, next) => {
  const site = c.req.header("X-Quick-Site") ?? "<platform>";
  console.log(`[${site}] ${c.req.method} ${c.req.path}`);
  await next();
});

app.openapi(
  createRoute({
    method: "get",
    path: "/health",
    responses: {
      200: {
        content: {
          "application/json": {
            schema: healthResponseSchema.openapi("HealthResponse"),
          },
        },
        description: "API health check",
      },
    },
  }),
  (c) => c.json({ status: "ok" as const }),
);
app.route("/", authRoutes);
registerAiRoutes(app);
registerSdkRoutes(app);
registerSkillRoutes(app);
registerSchemaRoutes(app);
registerCollectionRoutes(app);
registerFileRoutes(app);
registerSiteStatsRoutes(app);
registerSiteRoutes(app);
registerRealtimeRoutes(app);

app.doc("/doc", {
  openapi: "3.0.0",
  info: {
    title: "Quick API",
    version: "0.1.0",
  },
});

app.get("/ui", swaggerUI({ url: `${publicApiBase}/doc` }));

export { app };

if (import.meta.main) {
  Bun.serve({
    port,
    fetch: createPublicFetch(app),
    websocket: websocket as Bun.WebSocketHandler<unknown>,
  });

  console.log(`Server listening internally on http://0.0.0.0:${port}`);
  console.log(`Public API: ${publicApiBase}`);
  console.log(`OpenAPI JSON: ${publicApiBase}/doc`);
  console.log(`Swagger UI: ${publicApiBase}/ui`);
}
