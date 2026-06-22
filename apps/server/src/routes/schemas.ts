import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";

const quickRepoConfigSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://quick.dev/schemas/quick.schema.json",
  title: "Quick repo config",
  type: "object",
  additionalProperties: false,
  properties: {
    $schema: { type: "string" },
    site: {
      type: "string",
      pattern: "^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$",
      description: "Default Quick site name for commands run in this repository.",
    },
    remote: {
      type: "string",
      format: "uri",
      description: "Default Quick server URL for this repository.",
    },
    deploy: {
      type: "object",
      additionalProperties: false,
      properties: {
        input: {
          type: "string",
          description: "Default deploy directory or file path, resolved relative to this .quick.json file.",
        },
        confirmOverwrite: {
          type: "boolean",
          description: "Confirm deploy overwrites without an interactive prompt.",
        },
      },
    },
    thumbnail: {
      type: "object",
      additionalProperties: false,
      properties: {
        capture: {
          type: "object",
          additionalProperties: false,
          properties: {
            format: {
              type: "string",
              enum: ["webp", "png"],
              description: "Default thumbnail capture format.",
            },
            output: {
              type: "string",
              description: "Default thumbnail output path, resolved relative to this .quick.json file.",
            },
          },
        },
      },
    },
  },
} as const;

const quickRepoConfigOpenApiSchema = z.object({}).catchall(z.unknown()).openapi("QuickRepoConfigJsonSchema");

export function registerSchemaRoutes(app: OpenAPIHono) {
  app.openapi(
    createRoute({
      method: "get",
      path: "/schemas/quick.schema.json",
      responses: {
        200: {
          content: {
            "application/json": {
              schema: quickRepoConfigOpenApiSchema,
            },
          },
          description: "JSON Schema for .quick.json repo configuration",
        },
      },
    }),
    (c) => c.json(quickRepoConfigSchema),
  );
}
