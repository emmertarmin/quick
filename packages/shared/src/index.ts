export type JsonBlob = Record<string, unknown>;

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

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

export type QuickNetFetchRequest = {
  url: string;
};

export type QuickNetFetchResponse = {
  url: string;
  status: number;
  headers: {
    "content-type"?: string;
    etag?: string;
    "last-modified"?: string;
  };
  body: string;
};

export type QuickJevChoiceQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
};

export type QuickJevScoreQuestion = {
  type: "score";
  instructions: string;
  criteria: string[];
};

export type QuickJevBoolQuestion = {
  type: "bool";
  instructions: string;
  criteria: { true: string; false: string };
};

export type QuickJevQuestion = QuickJevChoiceQuestion | QuickJevScoreQuestion | QuickJevBoolQuestion;

export type QuickJevClassifyRequest = {
  state: Record<string, JsonValue>;
  questions: Record<string, QuickJevQuestion>;
};

export type QuickJevChoiceAnswer = {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};

export type QuickJevScoreAnswer = {
  type: "score";
  score: number;
  confidence: number;
};

export type QuickJevBoolAnswer = {
  type: "bool";
  probability: number;
};

export type QuickJevAnswer = QuickJevChoiceAnswer | QuickJevScoreAnswer | QuickJevBoolAnswer;

export type QuickJevClassifyResponse = {
  model: string;
  answers: Record<string, QuickJevAnswer>;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
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

export type QuickAiChatStreamEvent =
  | { type: "delta"; delta: string }
  | { type: "done"; text: string; message: QuickAiChatMessage; usage?: QuickAiChatUsage }
  | { type: "error"; error: string };

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

export type QuickAiAgentStreamEvent =
  | { type: "message_start"; message: QuickAiAgentTranscriptMessage }
  | { type: "message_update"; message: QuickAiAgentTranscriptMessage; delta?: string }
  | { type: "message_end"; message: QuickAiAgentTranscriptMessage }
  | { type: "tool_start"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_update"; toolCallId: string; toolName: string; args: unknown; partialResult: unknown }
  | { type: "tool_end"; toolCallId: string; toolName: string; result: unknown; isError: boolean }
  | ({ type: "done" } & QuickAiAgentResponse)
  | { type: "error"; error: string };
