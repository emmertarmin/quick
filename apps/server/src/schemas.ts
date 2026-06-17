import { z } from "@hono/zod-openapi";

export const jsonBlobSchema = z.object({}).catchall(z.unknown());

export const quickDocumentSchema = jsonBlobSchema.extend({
  id: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const errorResponseSchema = z.object({
  error: z.string(),
});

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
});

export const quickUserSchema = z.object({
  id: z.string(),
  email: z.string().optional(),
  name: z.string().optional(),
});

export const quickAuthenticatedSessionSchema = z.object({
  authenticated: z.literal(true),
  user: quickUserSchema,
});

export const quickAnonymousSessionSchema = z.object({
  authenticated: z.literal(false),
  user: z.null(),
});

export const quickSessionResponseSchema = z.union([
  quickAuthenticatedSessionSchema,
  quickAnonymousSessionSchema,
]);

export const quickLoginStartResponseSchema = quickAnonymousSessionSchema.extend({
  authorizationUrl: z.string(),
  returnTo: z.string(),
});

export const quickLoginResponseSchema = z.union([
  quickAuthenticatedSessionSchema.extend({
    mode: z.string().optional(),
    returnTo: z.string().optional(),
  }),
  quickLoginStartResponseSchema,
]);

export const quickSiteSchema = z.object({
  site: z.string(),
  url: z.string(),
  exists: z.literal(true),
  hasIndex: z.boolean(),
  lastDeployedAt: z.string().optional(),
  lastDeployedBy: quickUserSchema.optional(),
  fileCount: z.number().optional(),
});

export const quickSitesResponseSchema = z.object({
  sites: z.array(quickSiteSchema),
});

export const siteHeaderSchema = z.object({
  "X-Quick-Site": z.string().optional(),
});

export const collectionParamsSchema = z.object({
  collection: z.string(),
});

export const documentParamsSchema = collectionParamsSchema.extend({
  id: z.string(),
});

export function isJsonBlob(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
