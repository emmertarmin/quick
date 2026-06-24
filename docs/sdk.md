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
  location.href = login.url;
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

`quick.ai.chat(...)` provides simple chat completions. The basic Shopify-style call accepts an array of messages:

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

Provider credentials stay server-side. The Quick server must be configured with AI chat enabled, a provider, a model, and the provider API key, for example:

```sh
QUICK_CHAT_ENABLED=true
QUICK_CHAT_PROVIDER=openrouter
QUICK_CHAT_MODEL=...
OPENROUTER_API_KEY=...
```

The browser app only calls `/api/ai/chat`; it never sees the provider API key.

### AI agent

`quick.ai.agent(...)` runs a single agent turn using the same server-side model configuration. It exposes only whitelisted Quick-native tools requested by name.

```js
const tools = await quick.ai.tools();

const res = await quick.ai.agent({
  instructions: "Be concise. Use the available tools first.",
  input: "Summarize this app context and current user.",
  tools: tools.tools.map((tool) => tool.name),
});

console.log(res.output);
console.log(res.toolCalls);
```

`quick.ai.agent(...)` requires an authenticated Quick session and uses `/api/ai/agent`. `quick.ai.tools()` lists the current whitelisted tools from `/api/ai/tools`.

## Database collections

Collections are schemaless, site-scoped document stores.

<div class="code-title">index.html</div>

```js
const todos = quick.db.collection("todos");

const created = await todos.create({
  title: "Ship the demo",
  done: false,
});

const all = await todos.all();
const one = await todos.get(created.id);
await todos.update(created.id, { done: true });
await todos.replace(created.id, { title: "Ship the demo", done: true });
await todos.delete(created.id);
```

Documents include Quick metadata such as `id`, `created_at`, and `updated_at`.

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

const files = await quick.files.all();
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
const sites = await quick.sites.all();
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
