---
name: quick
description: Build, initialize, and deploy Quick static browser apps using the Quick SDK and CLI. Use when working in a Quick site, creating internal static apps, using quick.db, quick.files, quick.realtime, quick.identity, quick.ai, or deploying with quick deploy.
---

# Quick

Quick: static-first internal app platform. A folder of HTML/CSS/JS/assets becomes a site. Shared platform APIs replace per-app infra.

Build browser-only apps. No custom backend, server process, cron, migrations, separate auth, AI provider secrets, or client secrets. Use plain web files + `/quick.js`. Platform handles auth, identity, persistence, files, realtime, and server-side AI calls.

## Defaults

- Start simple: `index.html`, `app.js`, `style.css`.
- Deploy root must contain `index.html`.
- Site metadata in `.quick.json`. `quick init` creates only `$schema` and `site` by default:

```json
{
  "$schema": "{{ QUICK_ORIGIN }}/api/schemas/quick.schema.json",
  "site": "my-site"
}
```

- Add explicit repo defaults only when useful, e.g. `remote`, `deploy.input`, `deploy.confirmOverwrite`, and `thumbnail.capture` settings. The JSON schema is available at `{{ QUICK_ORIGIN }}/api/schemas/quick.schema.json`.
- Use `quick init` to create/update `.quick.json` and install/update this skill.

## SDK

```js
import { createQuickClient } from "/quick.js";
const quick = createQuickClient();
```

Base SDK features:

- Auth/session: `quick.auth.session()`, `quick.auth.login()`, `quick.auth.logout()`.
- Identity: `quick.identity.current()`.
- DB: `quick.db.collection(name)` with `list/create/get/replace/update/delete/search/subscribe`.
- Files: `quick.files.upload(file)`, `quick.files.list()`, `quick.files.delete(id)`.
- Realtime: `quick.realtime.channel(name)` for events; `quick.realtime.presence(name)` for presence/cursors.
- Sites: `quick.sites.list()`, `quick.sites.get(site)`.
- AI: `quick.ai.chat(...)`, `quick.ai.agent(...)`, `quick.ai.tools()`.

Use DB for durable state. Use `collection.subscribe(...)` for DB-driven UI updates across users/tabs. Use realtime for ephemeral state: cursors, typing, game moves, live presence.

## AI SDK

Use `quick.ai` for authenticated browser calls to server-side AI. The browser never receives provider credentials. If the user is not signed in, AI requests fail with `401 Authentication required`; gate AI UI with `quick.auth.session()` or `quick.identity.current()`.

### Chat

For simple non-streaming chat completions, pass either an array of messages or `{ messages }`:

```js
const res = await quick.ai.chat([
  { role: "system", content: "Be concise." },
  { role: "user", content: "Summarize my tasks." },
]);

console.log(res.text);
console.log(res.message); // { role: "assistant", content: "..." }
console.log(res.usage); // optional token/cost details
```

### Agent + tools

`quick.ai.agent(...)` runs one agent turn. Request optional whitelisted Quick-native tools by name; server-side defaults are still available even when `tools` is omitted. `quick.ai.tools()` returns the runtime tool list with labels, descriptions, and JSON-schema-like `parameters`.

```js
const available = await quick.ai.tools();

const res = await quick.ai.agent({
  instructions: "Use available tools first when relevant. Be concise.",
  input: "What app am I in, who am I, and what data is available?",
  tools: available.tools.map((tool) => tool.name),
});

console.log(res.output);
console.log(res.toolCalls); // optional executed tool calls
console.log(res.transcript); // optional user/assistant/toolResult blocks
```

Built-in agent tools include current date/time, current user, current app context, current-site DB document reads/writes/search, uploaded file listing, current-site metadata, and cross-site discovery. Site-scoped tools require the current Quick app/site context. `quick_documents_search` supports broad text search plus a Mongo-inspired `filter` with dot paths and operators such as `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$exists`, `$regex`, `$and`, and `$or`.

## CLI

- `quick config set remote {{ QUICK_ORIGIN }}`
- `quick auth login`
- `quick auth status`
- `quick init` or `quick init <path>`
- `quick deploy` (uses `deploy.input` + `site` from `.quick.json`), `quick deploy .`, or `quick deploy . <site>`
- `quick stats <site>` (use `--json` for machine-readable site stats)
- `quick thumbnail capture` (uses `site` and thumbnail defaults from `.quick.json`) or `quick thumbnail capture <site>`
- `quick thumbnail upload <site> <file>` to upload a prepared thumbnail image
- `quick purge <site>` to permanently delete a site after interactive confirmation
- `quick ai tools` to list available Quick AI agent tools for the configured remote
- `quick ai tools --json` for machine-readable tool metadata
- `quick ai tools --remote https://quick.example.com` to inspect a specific server

`bun cli ai -h` / `bun cli ai tools -h` show local development help for the same AI commands (`bun cli` is this repo's script wrapper around the Quick CLI).

Deploy overwrite may require typing the site name unless `deploy.confirmOverwrite` is explicitly set for this repo.

## Examples / docs

- SDK reference: {{ QUICK_ORIGIN }}/docs/sdk/
- CLI reference: {{ QUICK_ORIGIN }}/docs/cli/
- Examples overview: {{ QUICK_ORIGIN }}/docs/examples/
- Todo / DB: {{ QUICK_ORIGIN }}/docs/examples/todo/
- Chat / identity + DB subscribe: {{ QUICK_ORIGIN }}/docs/examples/chat/
- Gallery / files: {{ QUICK_ORIGIN }}/docs/examples/gallery/
- Realtime / presence: {{ QUICK_ORIGIN }}/docs/examples/realtime/
- AI chat: {{ QUICK_ORIGIN }}/docs/examples/ai-chat/
- Agent demo / AI tools: {{ QUICK_ORIGIN }}/docs/examples/agent-demo/
- API UI: {{ QUICK_ORIGIN }}/api/ui
