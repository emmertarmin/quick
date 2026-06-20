import type { OpenAPIHono } from "@hono/zod-openapi";
import { upgradeWebSocket } from "hono/bun";
import type { WSContext } from "hono/ws";
import type { JsonBlob, QuickUser } from "@quick/shared";
import { getPublicRequestSite } from "../public";
import { readAuthSession } from "./auth";

const maxChannelLength = 100;
const maxEventLength = 100;
const maxPayloadBytes = 16 * 1024;
const heartbeatIntervalMs = 25_000;

type RealtimeClient = {
  id: string;
  site: string;
  channel: string;
  user: QuickUser | null;
  ws: WSContext;
  presence?: PresenceMember;
  heartbeat?: Timer;
};

type PresenceMember = {
  connection_id: string;
  user: QuickUser | null;
  state: JsonBlob;
  joined_at: string;
  updated_at: string;
};

type ClientMessage =
  | { type: "event"; event: string; payload?: unknown }
  | { type: "presence:join"; state?: unknown }
  | { type: "presence:update"; state?: unknown }
  | { type: "presence:leave" }
  | { type: "ping" };

const channels = new Map<string, Set<RealtimeClient>>();

function siteFromHeaderValue(value: string | undefined) {
  const site = value?.trim();
  return site && site.length > 0 ? site : undefined;
}

function siteFromRequest(request: Request, headerValue: string | undefined) {
  return siteFromHeaderValue(headerValue) ?? getPublicRequestSite(request);
}

function isJsonBlob(value: unknown): value is JsonBlob {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sanitizeName(value: string | undefined, fallback: string, maxLength: number) {
  const name = value?.trim() || fallback;

  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/.test(name)) {
    return undefined;
  }

  return name.slice(0, maxLength);
}

function channelKey(site: string, channel: string) {
  return `${site}\u0000${channel}`;
}

function sendJson(client: RealtimeClient, message: unknown) {
  try {
    client.ws.send(JSON.stringify(message));
  } catch {
    removeClient(client);
  }
}

function clientsFor(client: RealtimeClient) {
  return channels.get(channelKey(client.site, client.channel));
}

function broadcast(client: RealtimeClient, message: unknown, options: { includeSelf?: boolean } = {}) {
  const clients = clientsFor(client);

  if (!clients) {
    return;
  }

  for (const target of clients) {
    if (!options.includeSelf && target.id === client.id) {
      continue;
    }

    sendJson(target, message);
  }
}

function presenceSnapshot(client: RealtimeClient) {
  return Array.from(clientsFor(client) ?? [])
    .map((member) => member.presence)
    .filter((member) => member !== undefined);
}

function removeClient(client: RealtimeClient) {
  if (client.heartbeat) {
    clearInterval(client.heartbeat);
    client.heartbeat = undefined;
  }

  const key = channelKey(client.site, client.channel);
  const clients = channels.get(key);

  if (!clients?.delete(client)) {
    return;
  }

  if (clients.size === 0) {
    channels.delete(key);
  }

  if (client.presence) {
    broadcast(client, {
      type: "presence:leave",
      member: client.presence,
    });
  }
}

function readMessage(data: unknown): ClientMessage | undefined {
  if (typeof data !== "string") {
    return undefined;
  }

  if (new TextEncoder().encode(data).byteLength > maxPayloadBytes) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(data) as unknown;

    if (!isJsonBlob(parsed) || typeof parsed.type !== "string") {
      return undefined;
    }

    return parsed as ClientMessage;
  } catch {
    return undefined;
  }
}

function handleClientMessage(client: RealtimeClient, message: ClientMessage) {
  if (message.type === "ping") {
    sendJson(client, { type: "pong", sent_at: new Date().toISOString() });
    return;
  }

  if (message.type === "event") {
    const event = sanitizeName(message.event, "message", maxEventLength);

    if (!event) {
      sendJson(client, { type: "error", error: "Invalid event name" });
      return;
    }

    broadcast(client, {
      type: "event",
      event,
      payload: message.payload,
      meta: {
        id: crypto.randomUUID(),
        site: client.site,
        channel: client.channel,
        connection_id: client.id,
        user: client.user,
        sent_at: new Date().toISOString(),
      },
    });
    return;
  }

  if (message.type === "presence:join") {
    const now = new Date().toISOString();
    const state = isJsonBlob(message.state) ? message.state : {};
    client.presence = {
      connection_id: client.id,
      user: client.user,
      state,
      joined_at: now,
      updated_at: now,
    };

    sendJson(client, {
      type: "presence:snapshot",
      members: presenceSnapshot(client),
    });
    broadcast(client, { type: "presence:join", member: client.presence });
    return;
  }

  if (message.type === "presence:update") {
    if (!client.presence) {
      handleClientMessage(client, { type: "presence:join", state: message.state });
      return;
    }

    client.presence = {
      ...client.presence,
      state: isJsonBlob(message.state) ? message.state : {},
      updated_at: new Date().toISOString(),
    };

    broadcast(client, { type: "presence:update", member: client.presence }, { includeSelf: true });
    return;
  }

  if (message.type === "presence:leave") {
    const member = client.presence;
    client.presence = undefined;

    if (member) {
      broadcast(client, { type: "presence:leave", member });
    }
  }
}

export function registerRealtimeRoutes(app: OpenAPIHono) {
  const realtimeWebSocket = upgradeWebSocket(async (c) => {
    const site = siteFromRequest(c.req.raw, c.req.header("X-Quick-Site"));
    const channel = sanitizeName(c.req.query("channel"), "default", maxChannelLength);
    const session = await readAuthSession(c);

    if (!site || !channel) {
      return {
        onOpen(_event, ws) {
          ws.close(1008, !site ? "Missing trusted X-Quick-Site header" : "Invalid channel name");
        },
      };
    }

    let client: RealtimeClient | undefined;

    return {
      onOpen(_event, ws) {
        client = {
          id: crypto.randomUUID(),
          site,
          channel,
          user: session?.user ?? null,
          ws,
        };

        const key = channelKey(site, channel);
        const clients = channels.get(key) ?? new Set<RealtimeClient>();
        clients.add(client);
        channels.set(key, clients);

        sendJson(client, {
          type: "ready",
          connection_id: client.id,
          site,
          channel,
          user: client.user,
        });

        client.heartbeat = setInterval(() => {
          if (client) {
            sendJson(client, { type: "heartbeat", sent_at: new Date().toISOString() });
          }
        }, heartbeatIntervalMs);
      },

      onMessage(event) {
        if (!client) {
          return;
        }

        const message = readMessage(event.data);

        if (!message) {
          sendJson(client, { type: "error", error: "Invalid realtime message" });
          return;
        }

        handleClientMessage(client, message);
      },

      onClose() {
        if (client) {
          removeClient(client);
          client = undefined;
        }
      },

      onError() {
        if (client) {
          removeClient(client);
          client = undefined;
        }
      },
    };
  });

  app.get("/realtime/ws", realtimeWebSocket);
  app.get("/api/realtime/ws", realtimeWebSocket);
}
