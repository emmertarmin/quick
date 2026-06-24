import { resolve } from "node:path";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";

function getBuiltSdkPath() {
  return resolve(import.meta.dir, "../../../../packages/sdk/dist/browser/quick.js");
}

export function registerSdkRoutes(app: OpenAPIHono) {
  app.openapi(
    createRoute({
      method: "get",
      path: "/quick.js",
      responses: {
        200: {
          content: {
            "text/javascript": {
              schema: z.string().openapi({ description: "Browser SDK JavaScript bundle." }),
            },
          },
          description: "Quick browser SDK bundle.",
        },
        503: {
          content: {
            "text/plain": {
              schema: z.string(),
            },
          },
          description: "SDK bundle has not been built.",
        },
      },
    }),
    async (c) => {
    const file = Bun.file(getBuiltSdkPath());

    if (!(await file.exists())) {
      return c.text("quick.js has not been built. Run `bun run sdk:build:browser` or `bun run build`.", 503);
    }

    return c.body(await file.arrayBuffer(), 200, {
      "Cache-Control": "no-cache",
      "Content-Length": String(file.size),
      "Content-Type": "text/javascript; charset=utf-8",
    });
  });
}
