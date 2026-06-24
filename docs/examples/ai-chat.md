# AI Chat example

The AI Chat example demonstrates ephemeral, browser-side use of `quick.ai.chat(...)`. It keeps a short conversation in memory, sends the current history plus an editable system prompt to the Quick server, displays assistant replies, and stores nothing persistently.

It lives in `examples/ai-chat/` and uses the current authenticated Quick session.

## Core principle: call the server-side AI gateway

The app creates the normal browser client:

<div class="code-title">examples/ai-chat/index.html</div>

```js
const quick = createQuickClient();
```

Then it sends messages through the `quick.ai` namespace:

<div class="code-title">examples/ai-chat/index.html</div>

```js
history.push({ role: "user", content: userPrompt });

const res = await quick.ai.chat([
  { role: "system", content: systemPrompt },
  ...history,
]);

history.push(res.message);
```

The example deliberately avoids persistence. Refreshing the page clears the in-memory conversation.

## What to notice

The browser never receives provider credentials. The app calls Quick, Quick verifies the user's session, and the server-side AI provider configuration performs the model request.

Deploy it with:

```sh
quick deploy ./examples/ai-chat ai-chat
```
