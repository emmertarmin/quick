import { resolve } from "node:path";
import type { OpenAPIHono } from "@hono/zod-openapi";

function getBuiltSdkPath() {
  return resolve(import.meta.dir, "../../../../packages/sdk/dist/browser/quick.js");
}

export function registerSdkRoutes(app: OpenAPIHono) {
  app.get("/quick.js", async (c) => {
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
