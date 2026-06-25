# Agent Demo example

The Agent Demo example is a small agentic chat that manages a todo list. It runs `quick.ai.agentStream(...)` with an explicit, whitelisted set of Quick-native tools so the agent can read and write a site-scoped `todos` collection on the user's behalf.

It lives in `examples/agent-demo/` and requires an authenticated Quick session.

## Whitelisting tools by name

Requested tools are passed as a plain array of tool-name strings. The example keeps this list as a constant so it is obvious which capabilities the agent is allowed to use:

<div class="code-title">examples/agent-demo/app.js</div>

```js
const REQUESTED_TOOL_NAMES = [
  "quick_user_get",
  "quick_documents_list",
  "quick_document_get",
  "quick_documents_search",
  "quick_document_create",
  "quick_document_update",
  "quick_document_delete",
];
```

`quick.ai.tools()` lists everything the server currently exposes. The example intersects that list with its whitelist so it can render friendly labels and warn about anything missing on the connected server, but only the whitelisted names are ever sent:

<div class="code-title">examples/agent-demo/app.js</div>

```js
const availableTools = (await quick.ai.tools()).tools;
const availableToolsByName = new Map(availableTools.map((tool) => [tool.name, tool]));

const enabledTools = REQUESTED_TOOL_NAMES
  .map((name) => availableToolsByName.get(name))
  .filter(Boolean);

const enabledToolNames = new Set(enabledTools.map((tool) => tool.name));
const missingToolNames = REQUESTED_TOOL_NAMES.filter((name) => !enabledToolNames.has(name));
```

The server always adds its default tools on top of whatever is requested. The example tracks `quick_datetime_get` (the current server-local date/time tool) separately as an implicit tool so the UI reflects that it is available even though the app never lists it explicitly:

<div class="code-title">examples/agent-demo/app.js</div>

```js
const IMPLICIT_TOOL_NAMES = ["quick_datetime_get"];
```

## Running an agent turn

Each submission streams a single agent turn. The whitelisted tool names are passed straight through as `tools`, and earlier turns are replayed as plain text context so the conversation feels continuous:

<div class="code-title">examples/agent-demo/app.js</div>

```js
for await (const event of quick.ai.agentStream({
  input: `${conversationContext()}${input}`,
  instructions,
  tools: enabledTools.map((tool) => tool.name),
})) {
  // handle streamed transcript and tool events
}
```

The `instructions` come from an editable textarea seeded with a default that tells the agent the todo list lives in the `todos` collection, to read before answering, and to mark todos completed instead of deleting them. Quick prepends its own minimal system prompt (the current date) to whatever `instructions` you provide.

## Rendering the stream

The page consumes `quick.ai.agentStream(...)` events incrementally rather than waiting for a final response:

- `message_start` / `message_update` / `message_end` build and update assistant transcript messages as text and thinking blocks arrive.
- `tool_start` / `tool_update` / `tool_end` render each tool call inline, including its arguments, a running status, and the final result or error.
- `error` aborts the turn and surfaces the message.
- `done` carries the final `QuickAiAgentResponse` (`output`, `message`, `usage`, `toolCalls`, `transcript`).

After each `done`, the example refreshes the todo panel directly from `quick.db.collection("todos")`, so writes performed by the agent's tools show up immediately alongside the chat.

## What to notice

The browser never receives provider credentials, and it never gains tool access it did not ask for. The app sends a fixed list of tool names, Quick verifies the user's session, and the server-side agent runs the whitelisted Quick-native tools against the current site/app context.

Deploy it with:

```sh
quick deploy ./examples/agent-demo agent-demo
```
