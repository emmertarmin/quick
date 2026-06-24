export type JsonBlob = Record<string, unknown>;

export type QuickDocument = JsonBlob & {
  id: string;
  created_at: string;
  updated_at: string;
};

export type QuickUser = {
  id: string;
  email?: string;
  name?: string;
};

export type QuickAuthenticatedSession = {
  authenticated: true;
  user: QuickUser;
};

export type QuickAnonymousSession = {
  authenticated: false;
  user: null;
};

export type QuickSessionResponse = QuickAuthenticatedSession | QuickAnonymousSession;

export type QuickLoginStartResponse = QuickAnonymousSession & {
  authorizationUrl: string;
  returnTo: string;
};

export type QuickLoginResponse =
  | (QuickAuthenticatedSession & {
      mode?: string;
      returnTo?: string;
    })
  | QuickLoginStartResponse;

export type QuickSite = {
  site: string;
  url: string;
  exists: true;
  hasIndex: boolean;
  lastDeployedAt?: string;
  lastDeployedBy?: QuickUser;
  fileCount?: number;
  thumbnailUrl?: string;
};

export type QuickSitesResponse = {
  sites: QuickSite[];
};

export type QuickAiChatRole = "system" | "user" | "assistant";

export type QuickAiChatMessage = {
  role: QuickAiChatRole;
  content: string;
};

export type QuickAiChatRequest = {
  messages: QuickAiChatMessage[];
};

export type QuickAiChatUsage = {
  input?: number;
  output?: number;
  totalTokens?: number;
  cost?: {
    total?: number;
  };
};

export type QuickAiChatResponse = {
  text: string;
  message: QuickAiChatMessage;
  usage?: QuickAiChatUsage;
};

export type QuickAiAgentTool = {
  name: string;
  description: string;
  label: string;
  parameters: JsonBlob;
};

export type QuickAiToolsResponse = {
  tools: QuickAiAgentTool[];
};

export type QuickAiAgentRequest = {
  input: string;
  instructions?: string;
  tools?: string[];
};

export type QuickAiAgentToolCall = {
  name: string;
  input: Record<string, unknown>;
  isError?: boolean;
};

export type QuickAiAgentTranscriptBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> }
  | { type: "image"; mimeType: string };

export type QuickAiAgentTranscriptMessage =
  | { role: "user"; content: QuickAiAgentTranscriptBlock[] }
  | { role: "assistant"; content: QuickAiAgentTranscriptBlock[]; stopReason?: string; errorMessage?: string }
  | { role: "toolResult"; toolCallId: string; toolName: string; content: QuickAiAgentTranscriptBlock[]; details?: unknown; isError: boolean };

export type QuickAiAgentResponse = {
  output: string;
  message: QuickAiChatMessage;
  usage?: QuickAiChatUsage;
  toolCalls?: QuickAiAgentToolCall[];
  transcript?: QuickAiAgentTranscriptMessage[];
};
