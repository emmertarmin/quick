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

export const quickFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  content_type: z.string(),
  size: z.number(),
  url: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const jsonSchemaSchema = z.object({}).catchall(z.unknown());

export const quickAiChatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

export const quickAiChatRequestSchema = z.object({
  messages: z.array(quickAiChatMessageSchema).min(1),
});

export const quickAiChatUsageSchema = z.object({
  input: z.number().optional(),
  output: z.number().optional(),
  totalTokens: z.number().optional(),
  cost: z.object({
    total: z.number().optional(),
  }).optional(),
});

export const quickAiChatResponseSchema = z.object({
  text: z.string(),
  message: quickAiChatMessageSchema,
  usage: quickAiChatUsageSchema.optional(),
});

export const quickAiChatStreamEventSchema = z.union([
  z.object({ type: z.literal("delta"), delta: z.string() }),
  z.object({ type: z.literal("done"), text: z.string(), message: quickAiChatMessageSchema, usage: quickAiChatUsageSchema.optional() }),
  z.object({ type: z.literal("error"), error: z.string() }),
]);

export const quickAiAgentToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  label: z.string(),
  parameters: jsonSchemaSchema,
});

export const quickAiToolsResponseSchema = z.object({
  tools: z.array(quickAiAgentToolSchema),
});

export const quickAiAgentRequestSchema = z.object({
  input: z.string().min(1),
  instructions: z.string().optional(),
  tools: z.array(z.string()).optional(),
});

export const quickAiAgentToolCallSchema = z.object({
  name: z.string(),
  input: jsonBlobSchema,
  isError: z.boolean().optional(),
});

export const quickAiAgentTranscriptBlockSchema = z.union([
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("thinking"), thinking: z.string() }),
  z.object({ type: z.literal("toolCall"), id: z.string(), name: z.string(), arguments: jsonBlobSchema }),
  z.object({ type: z.literal("image"), mimeType: z.string() }),
]);

export const quickAiAgentTranscriptMessageSchema = z.union([
  z.object({ role: z.literal("user"), content: z.array(quickAiAgentTranscriptBlockSchema) }),
  z.object({ role: z.literal("assistant"), content: z.array(quickAiAgentTranscriptBlockSchema), stopReason: z.string().optional(), errorMessage: z.string().optional() }),
  z.object({ role: z.literal("toolResult"), toolCallId: z.string(), toolName: z.string(), content: z.array(quickAiAgentTranscriptBlockSchema), details: z.unknown().optional(), isError: z.boolean() }),
]);

export const quickAiAgentResponseSchema = z.object({
  output: z.string(),
  message: quickAiChatMessageSchema,
  usage: quickAiChatUsageSchema.optional(),
  toolCalls: z.array(quickAiAgentToolCallSchema).optional(),
  transcript: z.array(quickAiAgentTranscriptMessageSchema).optional(),
});

export const quickAiAgentStreamEventSchema = z.union([
  z.object({ type: z.literal("message_start"), message: quickAiAgentTranscriptMessageSchema }),
  z.object({ type: z.literal("message_update"), message: quickAiAgentTranscriptMessageSchema, delta: z.string().optional() }),
  z.object({ type: z.literal("message_end"), message: quickAiAgentTranscriptMessageSchema }),
  z.object({ type: z.literal("tool_start"), toolCallId: z.string(), toolName: z.string(), args: z.unknown() }),
  z.object({ type: z.literal("tool_update"), toolCallId: z.string(), toolName: z.string(), args: z.unknown(), partialResult: z.unknown() }),
  z.object({ type: z.literal("tool_end"), toolCallId: z.string(), toolName: z.string(), result: z.unknown(), isError: z.boolean() }),
  quickAiAgentResponseSchema.extend({ type: z.literal("done") }),
  z.object({ type: z.literal("error"), error: z.string() }),
]);

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
