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

export const quickNetFetchRequestSchema = z.object({
  url: z.string().min(1).openapi({ description: "Absolute public HTTPS URL on port 443. URL credentials are forbidden." }),
});

export const quickNetFetchResponseSchema = z.object({
  url: z.string().openapi({ description: "Final validated URL after at most three redirects." }),
  status: z.number().int().min(100).max(599).openapi({ description: "Upstream HTTP status, including upstream 4xx and 5xx responses." }),
  headers: z.object({
    "content-type": z.string().optional(),
    etag: z.string().optional(),
    "last-modified": z.string().optional(),
  }),
  body: z.string().openapi({ description: "Decoded text body, limited to 10 MiB before JSON encoding." }),
});

export const JEV_MAX_STATE_DEPTH = 32;

const jevQuestionIdSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const jevInstructionsSchema = z.string().min(1).max(2000);
const jevCriterionTextSchema = z.string().min(1).max(1000);

// Iterative and bounded so hostile nesting cannot overflow the stack.
function withinJsonDepth(root: unknown, maxDepth: number) {
  const stack: Array<[unknown, number]> = [[root, 0]];
  while (stack.length) {
    const [value, depth] = stack.pop()!;
    if (!value || typeof value !== "object") continue;
    if (depth + 1 > maxDepth) return false;
    for (const child of Array.isArray(value) ? value : Object.values(value)) stack.push([child, depth + 1]);
  }
  return true;
}

export const quickJevQuestionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("choice"),
    instructions: jevInstructionsSchema,
    criteria: z.record(jevQuestionIdSchema, jevCriterionTextSchema).refine((criteria) => {
      const count = Object.keys(criteria).length;
      return count >= 2 && count <= 32;
    }, { message: "Choice questions require between 2 and 32 options" }),
  }).strict(),
  z.object({
    type: z.literal("score"),
    instructions: jevInstructionsSchema,
    criteria: z.array(jevCriterionTextSchema).min(2).max(10),
  }).strict(),
  z.object({
    type: z.literal("bool"),
    instructions: jevInstructionsSchema,
    criteria: z.object({ true: jevCriterionTextSchema, false: jevCriterionTextSchema }).strict(),
  }).strict(),
]);

export const quickJevClassifyRequestSchema = z.object({
  state: z.record(z.string(), z.unknown()).refine((state) => withinJsonDepth(state, JEV_MAX_STATE_DEPTH), {
    message: `State nesting depth must not exceed ${JEV_MAX_STATE_DEPTH}`,
  }).openapi({ description: "JSON object sent to the classifier as state. Nesting depth is limited to 32." }),
  questions: z.record(jevQuestionIdSchema, quickJevQuestionSchema).refine((questions) => {
    const count = Object.keys(questions).length;
    return count >= 1 && count <= 16;
  }, { message: "Between 1 and 16 questions are required" }),
}).strict();

export const quickJevAnswerSchema = z.union([
  z.object({
    type: z.literal("choice"),
    choice: z.string(),
    probabilities: z.record(z.string(), z.number()),
    confidence: z.number(),
  }),
  z.object({
    type: z.literal("score"),
    score: z.number(),
    confidence: z.number(),
  }),
  z.object({
    type: z.literal("bool"),
    probability: z.number(),
  }),
]);

export const quickJevClassifyResponseSchema = z.object({
  model: z.string(),
  answers: z.record(z.string(), quickJevAnswerSchema),
  usage: z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
  }).optional(),
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
