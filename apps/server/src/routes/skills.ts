import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";

const quickSkillPath = join(import.meta.dir, "..", "skills", "quick", "SKILL.md");

function publicOrigin(request: Request) {
  const url = new URL(request.url);
  const proto = request.headers.get("X-Forwarded-Proto") ?? url.protocol.replace(/:$/, "") ?? "https";
  const host = request.headers.get("X-Forwarded-Host") ?? request.headers.get("Host") ?? url.host;
  return `${proto}://${host}`;
}

async function readQuickSkill(origin: string) {
  const template = await readFile(quickSkillPath, "utf8");
  return template.replaceAll("{{ QUICK_ORIGIN }}", origin);
}

export function registerSkillRoutes(app: OpenAPIHono) {
  app.openapi(
    createRoute({
      method: "get",
      path: "/skills/quick/SKILL.md",
      responses: {
        200: {
          content: {
            "text/markdown": {
              schema: z.string().openapi({ description: "Quick agent skill markdown." }),
            },
          },
          description: "Quick agent skillfile with server-specific documentation links.",
        },
      },
    }),
    async (c) => {
    return c.text(await readQuickSkill(publicOrigin(c.req.raw)), 200, {
      "Content-Type": "text/markdown; charset=utf-8",
    });
  });
}
