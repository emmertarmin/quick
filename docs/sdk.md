# Quick SDK

The Quick SDK is the browser-facing API that turns a static page into a small app with identity, persistence, realtime updates, file uploads, and platform discovery.

In deployed sites, import it from the platform-provided bundle:

<div class="code-title">index.html</div>

```html
<script type="module">
  import { createQuickClient } from "/quick.js";

  const quick = createQuickClient();
</script>
```

During local development or package-based usage, the source package is `@quick/sdk`.

## Client

<div class="code-title">index.html</div>

```js
const quick = createQuickClient();
```

By default, the SDK talks to `/api`, which is the expected path when running inside a Quick site. You can override this for tests or custom integrations:

<div class="code-title">index.html</div>

```js
const quick = createQuickClient({ baseUrl: "https://quick.example.com/api" });
```

The client exposes:

- `quick.auth`
- `quick.identity`
- `quick.ai`
- `quick.db`
- `quick.files`
- `quick.realtime`
- `quick.sites`

## Auth and identity

Check the current browser session:

<div class="code-title">index.html</div>

```js
const session = await quick.auth.session();

if (!session.authenticated) {
  const login = await quick.auth.login({ returnTo: location.href });
  location.href = login.authorizationUrl;
}
```

Ask for the current user when you only care about identity:

<div class="code-title">index.html</div>

```js
const me = await quick.identity.current();
```

`identity.current()` returns the authenticated user or `null`.

Log out with:

<div class="code-title">index.html</div>

```js
await quick.auth.logout();
```

## AI

Use `quick.ai` for authenticated server-side AI calls from a static app.

### AI chat

`quick.ai.chat(...)` provides simple chat completions. The basic call accepts an array of messages:

<div class="code-title">index.html</div>

```js
const res = await quick.ai.chat([{ role: "user", content: "Summarize my tasks" }]);

console.log(res.text);
```

You can also pass an object with a `messages` property:

<div class="code-title">index.html</div>

```js
const res = await quick.ai.chat({
  messages: [
    { role: "system", content: "Be concise." },
    { role: "user", content: "Summarize my tasks" },
  ],
});
```

Responses are normalized:

```js
{
  text: "...",
  message: { role: "assistant", content: "..." },
  usage: {
    input: 12,
    output: 34,
    totalTokens: 46,
    cost: { total: 0.0001 },
  },
}
```

`quick.ai.chat(...)` requires an authenticated Quick session. If the user is not signed in, the request fails with `401 Authentication required`; use `quick.auth.session()` or `quick.identity.current()` to decide whether to show a sign-in flow.

#### Streaming chat

`quick.ai.chatStream(...)` takes the same input and returns an async iterable of events instead of a single response. Use it to render replies as they arrive:

<div class="code-title">index.html</div>

```js
let content = "";

for await (const event of quick.ai.chatStream([{ role: "user", content: "Summarize my tasks" }])) {
  if (event.type === "delta") {
    content += event.delta;
  } else if (event.type === "done") {
    content = event.message.content;
  } else if (event.type === "error") {
    throw new Error(event.error);
  }
}
```

Stream events are one of:

- `{ type: "delta", delta }` — an incremental chunk of assistant text.
- `{ type: "done", text, message, usage }` — the final assistant `message` and usage totals.
- `{ type: "error", error }` — a terminal error string.

Provider credentials stay server-side. The Quick server must be configured with AI chat enabled, a provider, a model, and the provider API key, for example:

```sh
QUICK_CHAT_ENABLED=true
QUICK_CHAT_PROVIDER=openrouter
QUICK_CHAT_MODEL=...
OPENROUTER_API_KEY=...
```

The browser app only calls `/api/ai/chat` (or `/api/ai/chat/stream`); it never sees the provider API key.

### AI agent

`quick.ai.agent(...)` runs a single agent turn using the same server-side model configuration. Quick prepends a minimal server-side system prompt containing the current date (`YYYY-MM-DD`) to any client-provided `instructions`. The agent also receives server-side default tools, including `quick_datetime_get` for the current server-local date/time (`YYYY-MM-DD hh:mm:ss`); additional whitelisted Quick-native tools are requested by name.

The `tools` field is a plain array of tool-name strings. Listing the names you intend to allow as a constant keeps the agent's capabilities explicit:

<div class="code-title">index.html</div>

```js
const REQUESTED_TOOL_NAMES = [
  "quick_user_get",
  "quick_documents_list",
  "quick_document_get",
  "quick_document_create",
  "quick_document_update",
];

const res = await quick.ai.agent({
  instructions: "Be concise. Use the available tools first.",
  input: "What is on my todo list?",
  tools: REQUESTED_TOOL_NAMES,
});

console.log(res.output);
console.log(res.toolCalls);
```

To discover which names are valid on the connected server, call `quick.ai.tools()` and read the `name` of each entry. A common pattern is to keep an explicit whitelist and intersect it with the available tools, so you can warn about anything missing without ever sending a name the server does not expose:

<div class="code-title">index.html</div>

```js
const available = new Set((await quick.ai.tools()).tools.map((tool) => tool.name));
const tools = REQUESTED_TOOL_NAMES.filter((name) => available.has(name));

const res = await quick.ai.agent({ input: "What is on my todo list?", tools });
```

`quick.ai.agent(...)` requires an authenticated Quick session and uses `/api/ai/agent`. `quick.ai.tools()` lists the current whitelisted tools from `/api/ai/tools`, including each tool's JSON-schema-like `parameters` schema:

```js
{
  tools: [
    {
      name: "quick_document_get",
      label: "Get document",
      description: "Read a single document by id from a Quick DB collection for the current app/site. Mirrors quick.db.collection(name).get(id).",
      parameters: {
        type: "object",
        properties: {
          collection: { type: "string", minLength: 1 },
          id: { type: "string", minLength: 1 },
        },
        required: ["collection", "id"],
      },
    },
  ],
}
```

Requested tool names are additive: the server-side default tools are available even when `tools` is omitted, so `quick_datetime_get` is always present. Built-in tools include current date/time, current user, current app context, site-scoped document reads/writes/search, site-scoped uploaded file listing, current-site metadata, and cross-site discovery via `quick_sites_list`. `quick_documents_search` supports broad text search and a Mongo-inspired `filter` object with dot paths and operators such as `$eq`, `$in`, `$exists`, `$regex`, `$and`, and `$or`.

#### Streaming agent turns

`quick.ai.agentStream(...)` takes the same request (including the `tools` name array) and returns an async iterable of events, so you can render the transcript and tool activity as they happen:

<div class="code-title">index.html</div>

```js
for await (const event of quick.ai.agentStream({
  input: "What is on my todo list?",
  tools: REQUESTED_TOOL_NAMES,
})) {
  switch (event.type) {
    case "message_start":
    case "message_update":
    case "message_end":
      // event.message is a transcript message (user | assistant | toolResult)
      break;
    case "tool_start":
      console.log("calling", event.toolName, event.args);
      break;
    case "tool_end":
      console.log("result", event.toolName, event.result, event.isError);
      break;
    case "done":
      console.log(event.output, event.toolCalls);
      break;
    case "error":
      throw new Error(event.error);
  }
}
```

Stream events are one of:

- `{ type: "message_start" | "message_update" | "message_end", message }` — transcript messages as they build; `message_update` may include a `delta` text chunk.
- `{ type: "tool_start", toolCallId, toolName, args }` — a tool call has started.
- `{ type: "tool_update", toolCallId, toolName, args, partialResult }` — a partial tool result.
- `{ type: "tool_end", toolCallId, toolName, result, isError }` — the final tool result.
- `{ type: "done", output, message, usage, toolCalls, transcript }` — the same shape as the non-streaming `quick.ai.agent(...)` response.
- `{ type: "error", error }` — a terminal error string.

Transcript messages carry typed content blocks (`text`, `thinking`, `toolCall`, `image`) and come in three roles: `user`, `assistant` (with optional `stopReason`/`errorMessage`), and `toolResult` (with `toolCallId`, `toolName`, `details`, and `isError`).

## Database collections

Collections are schemaless, site-scoped document stores.

<div class="code-title">index.html</div>

```js
const todos = quick.db.collection("todos");

const created = await todos.create({
  title: "Ship the demo",
  done: false,
});

const list = await todos.list();
const one = await todos.get(created.id);
await todos.update(created.id, { done: true });
await todos.replace(created.id, { title: "Ship the demo", done: true });
await todos.delete(created.id);
```

Search accepts optional broad text `query`, Mongo-inspired `filter`, and pagination. It uses `POST /api/db/collections/{collection}/documents/search` under the hood:

```js
const matches = await todos.search({
  query: "ship",
  filter: { done: false },
  page: 1,
  pageSize: 20,
});

console.log(matches.documents);
console.log(matches.total, matches.hasMore);
```

Documents include server-authoritative Quick metadata such as `id`, `created_at`, and `updated_at`.

## Realtime subscriptions

Subscribe to collection mutations from other open pages:

<div class="code-title">index.html</div>

```js
const unsubscribe = todos.subscribe({
  onCreate: (doc) => console.log("created", doc),
  onUpdate: (doc) => console.log("updated", doc),
  onDelete: (id, doc) => console.log("deleted", id, doc),
  onError: (error) => console.error(error),
});

// Later:
unsubscribe();
```

The current implementation uses `EventSource` / Server-Sent Events under the hood. Mutations still happen through normal HTTP requests; successful writes are broadcast to matching subscribers for the same site and collection.

## Realtime channels and presence

Use `quick.realtime` for bidirectional, ephemeral WebSocket messages that should not be persisted to the database:

<div class="code-title">index.html</div>

```js
const room = quick.realtime.presence("cursors");

room.onSnapshot((members) => renderPeople(members));
room.onJoin((member) => addPerson(member));
room.onUpdate((member) => moveCursor(member));
room.onLeave((member) => removePerson(member));

await room.ready;
room.join({ x: 0.5, y: 0.5 });
room.update({ x: pointerX / innerWidth, y: pointerY / innerHeight });
```

For generic events:

```js
const channel = quick.realtime.channel("game");
channel.on("player:move", (move, message) => updatePlayer(message.meta.connection_id, move));
await channel.ready;
channel.send("player:move", { x: 10, y: 20 });
```

Realtime messages are scoped to the current Quick site and channel. They are intended for presence, cursors, game movement, typing indicators, and other transient collaboration state. Store durable state such as scores or history in `quick.db`.

## Files

Use `quick.files` for public, site-scoped uploads:

<div class="code-title">index.html</div>

```js
const uploaded = await quick.files.upload(file);

const files = await quick.files.list();
image.src = uploaded.url;

await quick.files.delete(uploaded.id);
```

Uploaded file metadata includes:

- `id`
- `name`
- `content_type`
- `size`
- `url`
- `created_at`
- `updated_at`

The returned `url` is intended to be used directly from the same Quick site.

## Sites

Quick apps can inspect deployed site metadata:

<div class="code-title">index.html</div>

```js
const sites = await quick.sites.list();
const summerfest = await quick.sites.get("summerfest");
```

This is useful for platform dashboards, launchers, and internal discovery pages.

## Errors

Failed HTTP requests throw `QuickRequestError`:

<div class="code-title">index.html</div>

```js
try {
  await todos.get("missing-id");
} catch (error) {
  if (error.name === "QuickRequestError") {
    console.error(error.status, error.body);
  }
}
```

The error includes `method`, `path`, `status`, `statusText`, and the parsed response `body` when available.
