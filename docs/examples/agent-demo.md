# Agent Demo example

The Agent Demo example demonstrates `quick.ai.agent(...)` with whitelisted tools enabled up front. It fetches the available tool list with `quick.ai.tools()`, passes every returned tool name into the agent request, and asks a question that is intentionally suited to the built-in Quick tools: current date/time, current user, and app context.

It lives in `examples/agent-demo/` and requires an authenticated Quick session.

```js
const tools = await quick.ai.tools();

const response = await quick.ai.agent({
  instructions: "Use the available tools before answering when they are relevant.",
  input: "What is the current server date and time, who am I signed in as, and what Quick site/app context am I currently running in?",
  tools: tools.tools.map((tool) => tool.name),
});
```

The page renders `response.transcript` as content blocks so you can inspect:

- user and assistant transcript messages
- text blocks
- thinking blocks, when the configured model emits any
- tool call blocks, including IDs, names, and arguments
- tool result messages, including result text, details, and error state
- raw `toolCalls`, `usage`, and full response JSON

Deploy it with:

```sh
quick deploy ./examples/agent-demo agent-demo
```
