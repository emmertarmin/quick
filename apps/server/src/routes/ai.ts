import { Agent, type AgentMessage } from "@earendil-works/pi-agent-core";
import { createModels, type AssistantMessage, type Context as PiContext, type Message as PiMessage, type Usage } from "@earendil-works/pi-ai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { QuickAiAgentRequest, QuickAiAgentResponse, QuickAiAgentToolCall, QuickAiAgentTranscriptBlock, QuickAiAgentTranscriptMessage, QuickAiChatMessage, QuickAiChatRequest, QuickAiChatResponse, QuickAiToolsResponse } from "@quick/shared";
import { quickChatEnabled, quickChatModel, quickChatProvider } from "../config";
import { createQuickAiTools, isQuickAiToolName, listQuickAiTools } from "../ai-tools";
import { readAuthSession } from "./auth";

function aiError(message: string) {
  return { error: message };
}

function isChatMessage(value: unknown): value is QuickAiChatMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as Record<string, unknown>;
  return (
    (message.role === "system" || message.role === "user" || message.role === "assistant") &&
    typeof message.content === "string"
  );
}

function parseChatRequest(value: unknown): QuickAiChatRequest | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const messages = (value as { messages?: unknown }).messages;

  if (!Array.isArray(messages) || messages.length === 0 || !messages.every(isChatMessage)) {
    return undefined;
  }

  return { messages };
}

function parseAgentRequest(value: unknown): QuickAiAgentRequest | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const request = value as { input?: unknown; instructions?: unknown; tools?: unknown };

  if (typeof request.input !== "string" || !request.input.trim()) {
    return undefined;
  }

  if (request.instructions !== undefined && typeof request.instructions !== "string") {
    return undefined;
  }

  if (request.tools !== undefined && (!Array.isArray(request.tools) || !request.tools.every((tool) => typeof tool === "string"))) {
    return undefined;
  }

  return {
    input: request.input,
    instructions: request.instructions,
    tools: request.tools,
  };
}

let models: ReturnType<typeof createModels> | undefined;

function chatModels() {
  if (!models) {
    models = createModels();

    if (quickChatProvider === "openrouter") {
      models.setProvider(openrouterProvider());
    } else {
      throw new Error(`Unsupported QUICK_CHAT_PROVIDER: ${quickChatProvider}`);
    }
  }

  return models;
}

function zeroUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

function piMessages(messages: QuickAiChatMessage[]) {
  const systemPrompt = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n") || undefined;
  const timestamp = Date.now();
  const conversation: PiMessage[] = messages
    .filter((message) => message.role !== "system")
    .map((message): PiMessage => {
      if (message.role === "assistant") {
        return {
          role: "assistant",
          content: [{ type: "text", text: message.content }],
          api: "openai-completions",
          provider: quickChatProvider,
          model: quickChatModel,
          usage: zeroUsage(),
          stopReason: "stop",
          timestamp,
        };
      }

      return {
        role: "user",
        content: message.content,
        timestamp,
      };
    });

  return { systemPrompt, messages: conversation } satisfies PiContext;
}

function textFromAssistantMessage(message: AssistantMessage) {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function normalizedUsage(usage: Usage | undefined): QuickAiChatResponse["usage"] {
  if (!usage) {
    return undefined;
  }

  return {
    input: usage.input,
    output: usage.output,
    totalTokens: usage.totalTokens,
    cost: {
      total: usage.cost.total,
    },
  };
}

function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
  return !!message && typeof message === "object" && "role" in message && message.role === "assistant";
}

function latestAssistantMessage(messages: AgentMessage[]) {
  return messages.findLast(isAssistantMessage);
}

function transcriptBlocks(content: unknown): QuickAiAgentTranscriptBlock[] {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }

  if (!Array.isArray(content)) {
    return [];
  }

  return content.flatMap((block): QuickAiAgentTranscriptBlock[] => {
    if (!block || typeof block !== "object") {
      return [];
    }

    const value = block as Record<string, unknown>;

    if (value.type === "text" && typeof value.text === "string") {
      return [{ type: "text", text: value.text }];
    }

    if (value.type === "thinking" && typeof value.thinking === "string") {
      return [{ type: "thinking", thinking: value.thinking }];
    }

    if (value.type === "toolCall" && typeof value.id === "string" && typeof value.name === "string") {
      return [{
        type: "toolCall",
        id: value.id,
        name: value.name,
        arguments: value.arguments && typeof value.arguments === "object" && !Array.isArray(value.arguments) ? value.arguments as Record<string, unknown> : {},
      }];
    }

    if (value.type === "image" && typeof value.mimeType === "string") {
      return [{ type: "image", mimeType: value.mimeType }];
    }

    return [];
  });
}

function agentTranscript(messages: AgentMessage[]): QuickAiAgentTranscriptMessage[] {
  return messages.flatMap((message): QuickAiAgentTranscriptMessage[] => {
    if (!message || typeof message !== "object" || !("role" in message)) {
      return [];
    }

    if (message.role === "user") {
      return [{ role: "user", content: transcriptBlocks(message.content) }];
    }

    if (message.role === "assistant") {
      return [{
        role: "assistant",
        content: transcriptBlocks(message.content),
        stopReason: message.stopReason,
        errorMessage: message.errorMessage,
      }];
    }

    if (message.role === "toolResult") {
      return [{
        role: "toolResult",
        toolCallId: message.toolCallId,
        toolName: message.toolName,
        content: transcriptBlocks(message.content),
        details: message.details,
        isError: message.isError,
      }];
    }

    return [];
  });
}

export function registerAiRoutes(app: OpenAPIHono) {
  app.get("/ai/tools", async (c) => {
    const session = await readAuthSession(c);

    if (!session) {
      return c.json(aiError("Authentication required"), 401);
    }

    const response: QuickAiToolsResponse = { tools: listQuickAiTools() };
    return c.json(response, 200);
  });

  app.post("/ai/agent", async (c) => {
    if (!quickChatEnabled) {
      return c.json(aiError("Quick AI agent is disabled"), 503);
    }

    if (!quickChatModel) {
      return c.json(aiError("QUICK_CHAT_MODEL must be set"), 500);
    }

    if (quickChatProvider === "openrouter" && !process.env.OPENROUTER_API_KEY?.trim()) {
      return c.json(aiError("OPENROUTER_API_KEY must be set for QUICK_CHAT_PROVIDER=openrouter"), 500);
    }

    const session = await readAuthSession(c);

    if (!session) {
      return c.json(aiError("Authentication required"), 401);
    }

    const request = parseAgentRequest(await c.req.json().catch(() => undefined));

    if (!request) {
      return c.json(aiError("Expected JSON body with non-empty input string, optional instructions string, and optional tools string array"), 400);
    }

    const requestedTools = request.tools ?? [];
    const unknownTools = requestedTools.filter((name) => !isQuickAiToolName(name));

    if (unknownTools.length > 0) {
      return c.json(aiError(`Unknown Quick AI tool(s): ${unknownTools.join(", ")}`), 400);
    }

    try {
      const collection = chatModels();
      const model = collection.getModel(quickChatProvider, quickChatModel);

      if (!model) {
        return c.json(aiError(`Unknown ${quickChatProvider} chat model: ${quickChatModel}`), 500);
      }

      const toolCalls: QuickAiAgentToolCall[] = [];
      const agent = new Agent({
        initialState: {
          systemPrompt: request.instructions ?? "",
          model,
          thinkingLevel: "off",
          tools: createQuickAiTools({ c, user: session.user }, requestedTools),
        },
        streamFn: (model, context, options) => collection.streamSimple(model, context, options),
        beforeToolCall: async ({ toolCall, args }) => {
          console.log(`[ai] tool call ${toolCall.name}`, args);
        },
        afterToolCall: async ({ toolCall, args, isError }) => {
          toolCalls.push({
            name: toolCall.name,
            input: args && typeof args === "object" && !Array.isArray(args) ? args as Record<string, unknown> : {},
            isError,
          });
        },
      });

      await agent.prompt(request.input);

      const message = latestAssistantMessage(agent.state.messages);

      if (!message) {
        throw new Error("Agent did not return an assistant message");
      }

      const output = textFromAssistantMessage(message);
      const response: QuickAiAgentResponse = {
        output,
        message: {
          role: "assistant",
          content: output,
        },
        usage: normalizedUsage(message.usage),
        toolCalls,
        transcript: agentTranscript(agent.state.messages),
      };

      return c.json(response, 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[ai] agent failed", error);
      return c.json(aiError(message), 500);
    }
  });

  app.post("/ai/chat", async (c) => {
    if (!quickChatEnabled) {
      return c.json(aiError("Quick AI chat is disabled"), 503);
    }

    if (!quickChatModel) {
      return c.json(aiError("QUICK_CHAT_MODEL must be set"), 500);
    }

    if (quickChatProvider === "openrouter" && !process.env.OPENROUTER_API_KEY?.trim()) {
      return c.json(aiError("OPENROUTER_API_KEY must be set for QUICK_CHAT_PROVIDER=openrouter"), 500);
    }

    const session = await readAuthSession(c);

    if (!session) {
      return c.json(aiError("Authentication required"), 401);
    }

    const request = parseChatRequest(await c.req.json().catch(() => undefined));

    if (!request) {
      return c.json(aiError("Expected JSON body with non-empty messages array"), 400);
    }

    try {
      const collection = chatModels();
      const model = collection.getModel(quickChatProvider, quickChatModel);

      if (!model) {
        return c.json(aiError(`Unknown ${quickChatProvider} chat model: ${quickChatModel}`), 500);
      }

      const message = await collection.complete(model, piMessages(request.messages));
      const text = textFromAssistantMessage(message);
      const response: QuickAiChatResponse = {
        text,
        message: {
          role: "assistant",
          content: text,
        },
        usage: normalizedUsage(message.usage),
      };

      return c.json(response, 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[ai] chat failed", error);
      return c.json(aiError(message), 500);
    }
  });
}
