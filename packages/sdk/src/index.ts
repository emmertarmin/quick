import type {
  JsonBlob,
  QuickAiAgentRequest,
  QuickAiAgentResponse,
  QuickAiChatMessage,
  QuickAiChatRequest,
  QuickAiChatResponse,
  QuickDocument,
  QuickLoginResponse,
  QuickSessionResponse,
  QuickSite,
  QuickSitesResponse,
  QuickUser,
} from "@quick/shared";

export type {
  JsonBlob,
  QuickAiAgentRequest,
  QuickAiAgentResponse,
  QuickAiChatMessage,
  QuickAiChatRequest,
  QuickAiChatResponse,
  QuickAuthenticatedSession,
  QuickAnonymousSession,
  QuickDocument,
  QuickLoginResponse,
  QuickLoginStartResponse,
  QuickSessionResponse,
  QuickSite,
  QuickSitesResponse,
  QuickUser,
} from "@quick/shared";

export type QuickClientOptions = {
  baseUrl?: string;
};

export type QuickLoginOptions = {
  returnTo?: string;
};

export type QuickCollectionSubscribeHandlers<T extends JsonBlob = JsonBlob> = {
  onCreate?(document: T & QuickDocument): void;
  onUpdate?(document: T & QuickDocument): void;
  onDelete?(id: string, document?: T & QuickDocument): void;
  onError?(error: Event | Error): void;
};

export type QuickCollection<T extends JsonBlob = JsonBlob> = {
  all(): Promise<Array<T & QuickDocument>>;
  create(document: T): Promise<T & QuickDocument>;
  get(id: string): Promise<T & QuickDocument>;
  replace(id: string, document: T): Promise<T & QuickDocument>;
  update(id: string, document: Partial<T>): Promise<T & QuickDocument>;
  delete(id: string): Promise<T & QuickDocument>;
  subscribe(handlers: QuickCollectionSubscribeHandlers<T>): () => void;
};

export type QuickDatabase = {
  collection<T extends JsonBlob = JsonBlob>(name: string): QuickCollection<T>;
};

export type QuickAiChatInput = QuickAiChatMessage[] | QuickAiChatRequest;

export type QuickAi = {
  agent(request: QuickAiAgentRequest): Promise<QuickAiAgentResponse>;
  chat(messagesOrRequest: QuickAiChatInput): Promise<QuickAiChatResponse>;
};

export type QuickAuth = {
  session(): Promise<QuickSessionResponse>;
  login(options?: QuickLoginOptions): Promise<QuickLoginResponse>;
  logout(): Promise<QuickSessionResponse>;
};

export type QuickIdentity = {
  current(): Promise<QuickUser | null>;
};

export type QuickFile = {
  id: string;
  name: string;
  content_type: string;
  size: number;
  url: string;
  created_at: string;
  updated_at: string;
};

export type QuickFiles = {
  all(): Promise<QuickFile[]>;
  upload(file: File): Promise<QuickFile>;
  delete(id: string): Promise<QuickFile>;
};

export type QuickSites = {
  all(): Promise<QuickSite[]>;
  get(site: string): Promise<QuickSite | { site: string; exists: false; url: string; hasIndex: false }>;
};

export type QuickRealtimeMessage<T = unknown> = {
  type: "event";
  event: string;
  payload: T;
  meta: {
    id: string;
    site: string;
    channel: string;
    connection_id: string;
    user: QuickUser | null;
    sent_at: string;
  };
};

export type QuickPresenceMember<T extends JsonBlob = JsonBlob> = {
  connection_id: string;
  user: QuickUser | null;
  state: T;
  joined_at: string;
  updated_at: string;
};

export type QuickRealtimeChannel = {
  ready: Promise<void>;
  send(event: string, payload?: unknown): void;
  on(event: string, handler: (payload: unknown, message: QuickRealtimeMessage) => void): () => void;
  onError(handler: (error: Event | Error) => void): () => void;
  close(): void;
};

export type QuickPresenceChannel<T extends JsonBlob = JsonBlob> = QuickRealtimeChannel & {
  join(state?: T): void;
  update(state: T): void;
  leave(): void;
  onSnapshot(handler: (members: Array<QuickPresenceMember<T>>) => void): () => void;
  onJoin(handler: (member: QuickPresenceMember<T>) => void): () => void;
  onUpdate(handler: (member: QuickPresenceMember<T>) => void): () => void;
  onLeave(handler: (member: QuickPresenceMember<T>) => void): () => void;
};

export type QuickRealtime = {
  channel(name: string): QuickRealtimeChannel;
  presence<T extends JsonBlob = JsonBlob>(name: string): QuickPresenceChannel<T>;
};

export type QuickClient = {
  ai: QuickAi;
  auth: QuickAuth;
  db: QuickDatabase;
  files: QuickFiles;
  identity: QuickIdentity;
  realtime: QuickRealtime;
  sites: QuickSites;
};

export class QuickRequestError extends Error {
  readonly body: unknown;
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly statusText: string;

  constructor(options: {
    body: unknown;
    method: string;
    path: string;
    status: number;
    statusText: string;
  }) {
    super(formatErrorMessage(options));
    this.name = "QuickRequestError";
    this.body = options.body;
    this.method = options.method;
    this.path = options.path;
    this.status = options.status;
    this.statusText = options.statusText;
  }
}

function formatErrorMessage(error: {
  body: unknown;
  method: string;
  path: string;
  status: number;
  statusText: string;
}) {
  const status = `${error.status} ${error.statusText}`.trim();
  const body = formatErrorBody(error.body);
  const detail = body ? `: ${body}` : "";

  return `Quick request failed: ${error.method} ${error.path} ${status}${detail}`;
}

function formatErrorBody(body: unknown) {
  if (typeof body === "string") {
    return body;
  }

  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
    return body.error;
  }

  if (body === undefined) {
    return undefined;
  }

  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}

function isUnauthorizedRequest(error: unknown) {
  return error instanceof QuickRequestError && error.status === 401;
}

type CollectionCreateEvent<T extends JsonBlob = JsonBlob> = { type: "create"; document: T & QuickDocument };
type CollectionUpdateEvent<T extends JsonBlob = JsonBlob> = { type: "update"; document: T & QuickDocument };
type CollectionDeleteEvent<T extends JsonBlob = JsonBlob> = {
  type: "delete";
  id: string;
  document?: T & QuickDocument;
};
type CollectionRealtimeEvent<T extends JsonBlob = JsonBlob> =
  | CollectionCreateEvent<T>
  | CollectionUpdateEvent<T>
  | CollectionDeleteEvent<T>;

function parseCollectionRealtimeEvent<T extends JsonBlob>(event: MessageEvent<string>) {
  return JSON.parse(event.data) as CollectionRealtimeEvent<T>;
}

function realtimeUrl(baseUrl: string, channel: string) {
  const path = `/realtime/ws?channel=${encodeURIComponent(channel)}`;

  if (baseUrl.startsWith("http://") || baseUrl.startsWith("https://")) {
    const url = new URL(`${baseUrl}${path}`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.toString();
  }

  const origin = globalThis.location?.origin ?? "http://localhost";
  const url = new URL(`${baseUrl}${path}`, origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

async function readResponseBody(response: Response) {
  const text = await response.text();

  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export function createQuickClient(options: QuickClientOptions = {}): QuickClient {
  const baseUrl = options.baseUrl ?? "/api";

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);

    if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
    });

    if (!response.ok) {
      throw new QuickRequestError({
        body: await readResponseBody(response),
        method: init.method ?? "GET",
        path,
        status: response.status,
        statusText: response.statusText,
      });
    }

    return response.json() as Promise<T>;
  }

  const anonymousSession: QuickSessionResponse = {
    authenticated: false,
    user: null,
  };

  const ai: QuickAi = {
    agent(body) {
      return request<QuickAiAgentResponse>("/ai/agent", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },

    chat(messagesOrRequest) {
      const body = Array.isArray(messagesOrRequest) ? { messages: messagesOrRequest } : messagesOrRequest;

      return request<QuickAiChatResponse>("/ai/chat", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
  };

  const auth: QuickAuth = {
    async session() {
      try {
        return await request<QuickSessionResponse>("/auth/session");
      } catch (error) {
        if (isUnauthorizedRequest(error)) {
          return anonymousSession;
        }

        throw error;
      }
    },

    login(options = {}) {
      const search = new URLSearchParams({ format: "json" });

      if (options.returnTo) {
        search.set("return_to", options.returnTo);
      }

      return request<QuickLoginResponse>(`/auth/login?${search.toString()}`);
    },

    logout() {
      return request<QuickSessionResponse>("/auth/logout", { method: "POST" });
    },
  };

  const identity: QuickIdentity = {
    async current() {
      try {
        const response = await request<QuickSessionResponse>("/identity/me");
        return response.authenticated ? response.user : null;
      } catch (error) {
        if (isUnauthorizedRequest(error)) {
          return null;
        }

        throw error;
      }
    },
  };

  const sites: QuickSites = {
    async all() {
      const response = await request<QuickSitesResponse>("/sites");
      return response.sites;
    },

    get(site) {
      return request<QuickSite | { site: string; exists: false; url: string; hasIndex: false }>(`/sites/${encodeURIComponent(site)}`);
    },
  };

  const files: QuickFiles = {
    all() {
      return request<QuickFile[]>("/files");
    },

    upload(file) {
      const body = new FormData();
      body.set("file", file);

      return request<QuickFile>("/files", {
        method: "POST",
        body,
      });
    },

    delete(id) {
      return request<QuickFile>(`/files/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    },
  };

  const realtime: QuickRealtime = {
    channel(name) {
      if (!("WebSocket" in globalThis)) {
        throw new Error("Quick realtime channels require WebSocket support");
      }

      const socket = new WebSocket(realtimeUrl(baseUrl, name));
      const eventHandlers = new Map<string, Set<(payload: unknown, message: QuickRealtimeMessage) => void>>();
      const errorHandlers = new Set<(error: Event | Error) => void>();
      let readyResolve: () => void;
      let readyReject: (error: Error) => void;
      const ready = new Promise<void>((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
      });

      socket.addEventListener("message", (event) => {
        try {
          const message = JSON.parse(String(event.data)) as { type?: string; event?: string; payload?: unknown };

          if (message.type === "ready") {
            readyResolve();
            return;
          }

          if (message.type === "event" && typeof message.event === "string") {
            for (const handler of eventHandlers.get(message.event) ?? []) {
              handler(message.payload, message as QuickRealtimeMessage);
            }
          }
        } catch (error) {
          for (const handler of errorHandlers) {
            handler(error instanceof Error ? error : new Error(String(error)));
          }
        }
      });

      socket.addEventListener("error", (event) => {
        readyReject(new Error("Quick realtime connection failed"));
        for (const handler of errorHandlers) {
          handler(event);
        }
      });

      function send(event: string, payload?: unknown) {
        const data = JSON.stringify({ type: "event", event, payload });

        if (socket.readyState === WebSocket.OPEN) {
          socket.send(data);
          return;
        }

        socket.addEventListener("open", () => socket.send(data), { once: true });
      }

      return {
        ready,
        send,
        on(event, handler) {
          const handlers = eventHandlers.get(event) ?? new Set<(payload: unknown, message: QuickRealtimeMessage) => void>();
          handlers.add(handler);
          eventHandlers.set(event, handlers);
          return () => handlers.delete(handler);
        },
        onError(handler) {
          errorHandlers.add(handler);
          return () => errorHandlers.delete(handler);
        },
        close() {
          socket.close();
        },
      };
    },

    presence<T extends JsonBlob = JsonBlob>(name: string): QuickPresenceChannel<T> {
      if (!("WebSocket" in globalThis)) {
        throw new Error("Quick realtime presence requires WebSocket support");
      }

      const snapshotHandlers = new Set<(members: Array<QuickPresenceMember<T>>) => void>();
      const joinHandlers = new Set<(member: QuickPresenceMember<T>) => void>();
      const updateHandlers = new Set<(member: QuickPresenceMember<T>) => void>();
      const leaveHandlers = new Set<(member: QuickPresenceMember<T>) => void>();

      const rawSocket = new WebSocket(realtimeUrl(baseUrl, name));
      const eventHandlers = new Map<string, Set<(payload: unknown, message: QuickRealtimeMessage) => void>>();
      const errorHandlers = new Set<(error: Event | Error) => void>();
      let readyResolve: () => void;
      let readyReject: (error: Error) => void;
      const ready = new Promise<void>((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
      });

      rawSocket.addEventListener("message", (event) => {
        try {
          const message = JSON.parse(String(event.data)) as { type?: string; event?: string; payload?: unknown; members?: Array<QuickPresenceMember<T>>; member?: QuickPresenceMember<T> };

          if (message.type === "ready") {
            readyResolve();
          } else if (message.type === "event" && typeof message.event === "string") {
            for (const handler of eventHandlers.get(message.event) ?? []) handler(message.payload, message as QuickRealtimeMessage);
          } else if (message.type === "presence:snapshot") {
            for (const handler of snapshotHandlers) handler(message.members ?? []);
          } else if (message.type === "presence:join" && message.member) {
            for (const handler of joinHandlers) handler(message.member);
          } else if (message.type === "presence:update" && message.member) {
            for (const handler of updateHandlers) handler(message.member);
          } else if (message.type === "presence:leave" && message.member) {
            for (const handler of leaveHandlers) handler(message.member);
          }
        } catch (error) {
          for (const handler of errorHandlers) handler(error instanceof Error ? error : new Error(String(error)));
        }
      });

      rawSocket.addEventListener("error", (event) => {
        readyReject(new Error("Quick realtime connection failed"));
        for (const handler of errorHandlers) handler(event);
      });

      function sendRaw(message: unknown) {
        const data = JSON.stringify(message);

        if (rawSocket.readyState === WebSocket.OPEN) {
          rawSocket.send(data);
          return;
        }

        rawSocket.addEventListener("open", () => rawSocket.send(data), { once: true });
      }

      return {
        ready,
        send(event, payload) {
          sendRaw({ type: "event", event, payload });
        },
        on(event, handler) {
          const handlers = eventHandlers.get(event) ?? new Set<(payload: unknown, message: QuickRealtimeMessage) => void>();
          handlers.add(handler);
          eventHandlers.set(event, handlers);
          return () => handlers.delete(handler);
        },
        onError(handler) {
          errorHandlers.add(handler);
          return () => errorHandlers.delete(handler);
        },
        close() {
          rawSocket.close();
        },
        join(state = {} as T) {
          sendRaw({ type: "presence:join", state });
        },
        update(state) {
          sendRaw({ type: "presence:update", state });
        },
        leave() {
          sendRaw({ type: "presence:leave" });
        },
        onSnapshot(handler) {
          snapshotHandlers.add(handler);
          return () => snapshotHandlers.delete(handler);
        },
        onJoin(handler) {
          joinHandlers.add(handler);
          return () => joinHandlers.delete(handler);
        },
        onUpdate(handler) {
          updateHandlers.add(handler);
          return () => updateHandlers.delete(handler);
        },
        onLeave(handler) {
          leaveHandlers.add(handler);
          return () => leaveHandlers.delete(handler);
        },
      };
    },
  };

  const db: QuickDatabase = {
    collection<T extends JsonBlob = JsonBlob>(name: string): QuickCollection<T> {
      const encodedName = encodeURIComponent(name);
      const path = `/db/collections/${encodedName}/documents`;
      const subscribePath = `/db/collections/${encodedName}/subscribe`;

      return {
        all() {
          return request<Array<T & QuickDocument>>(path);
        },

        create(document) {
          return request<T & QuickDocument>(path, {
            method: "POST",
            body: JSON.stringify(document),
          });
        },

        get(id) {
          return request<T & QuickDocument>(`${path}/${encodeURIComponent(id)}`);
        },

        replace(id, document) {
          return request<T & QuickDocument>(`${path}/${encodeURIComponent(id)}`, {
            method: "PUT",
            body: JSON.stringify(document),
          });
        },

        update(id, document) {
          return request<T & QuickDocument>(`${path}/${encodeURIComponent(id)}`, {
            method: "PATCH",
            body: JSON.stringify(document),
          });
        },

        delete(id) {
          return request<T & QuickDocument>(`${path}/${encodeURIComponent(id)}`, {
            method: "DELETE",
          });
        },

        subscribe(handlers) {
          if (!("EventSource" in globalThis)) {
            throw new Error("Quick collection subscriptions require EventSource support");
          }

          const source = new EventSource(`${baseUrl}${subscribePath}`, { withCredentials: true });

          source.addEventListener("create", (event) => {
            const message = parseCollectionRealtimeEvent<T>(event) as CollectionCreateEvent<T>;
            handlers.onCreate?.(message.document);
          });

          source.addEventListener("update", (event) => {
            const message = parseCollectionRealtimeEvent<T>(event) as CollectionUpdateEvent<T>;
            handlers.onUpdate?.(message.document);
          });

          source.addEventListener("delete", (event) => {
            const message = parseCollectionRealtimeEvent<T>(event) as CollectionDeleteEvent<T>;
            handlers.onDelete?.(message.id, message.document);
          });

          source.addEventListener("error", (event) => {
            handlers.onError?.(event);
          });

          return () => source.close();
        },
      };
    },
  };

  return { ai, auth, db, files, identity, realtime, sites };
}
