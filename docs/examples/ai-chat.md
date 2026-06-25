# AI Chat example

The AI Chat example demonstrates ephemeral, browser-side use of `quick.ai.chatStream(...)`. It keeps a short conversation in memory, streams assistant replies token by token, sends the current history plus an editable system prompt to the Quick server, and stores nothing persistently.

It lives in `examples/ai-chat/` and uses the current authenticated Quick session.

## Core principle: call the server-side AI gateway

The app creates the normal browser client:

<div class="code-title">examples/ai-chat/index.html</div>

```js
const quick = createQuickClient();
```

Then it streams messages through the `quick.ai` namespace. The user message is appended to the in-memory `history`, an empty assistant message is added as a placeholder, and `delta` events accumulate into it as they arrive:

<div class="code-title">examples/ai-chat/index.html</div>

```js
const messages = systemPrompt
  ? [{ role: "system", content: systemPrompt }, ...history]
  : [...history];

const assistantMessage = { role: "assistant", content: "" };
history.push(assistantMessage);

for await (const event of quick.ai.chatStream(messages)) {
  if (event.type === "delta") {
    assistantMessage.content += event.delta;
    renderConversation();
    continue;
  }

  if (event.type === "done") {
    assistantMessage.content = event.message.content;
    continue;
  }

  if (event.type === "error") {
    throw new Error(event.error);
  }
}
```

The system prompt is only included when the textarea is non-empty, so you can experiment with and without one.

The example deliberately avoids persistence. Refreshing the page clears the in-memory conversation.

## What to notice

The browser never receives provider credentials. The app calls Quick, Quick verifies the user's session, and the server-side AI provider configuration performs the streamed model request.

If a request fails partway through, the example removes both the placeholder assistant message and the user message it was answering, so the in-memory history stays consistent.

Deploy it with:

```sh
quick deploy ./examples/ai-chat ai-chat
```
