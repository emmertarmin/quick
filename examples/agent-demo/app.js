import { createQuickClient } from "/quick.js";

const quick = createQuickClient();
const TODO_COLLECTION = "todos";
const IMPLICIT_TOOL_NAMES = ["quick_datetime_get"];
const REQUESTED_TOOL_NAMES = [
  "quick_user_get",
  "quick_documents_list",
  "quick_document_get",
  "quick_documents_search",
  "quick_document_create",
  "quick_document_update",
  "quick_document_delete",
];
const DEFAULT_INSTRUCTIONS = `You are the messenger between the user and this app's todo list.

The todo list lives in the Quick DB collection named "${TODO_COLLECTION}".
Use the document tools whenever the user asks about or asks to change todos. Read the current list before answering questions about it. Create or update documents when the user asks you to modify the list. If the user asks to delete a todo, mark it completed instead.

Todo documents should use this shape when possible:
- title: string
- completed: boolean

Be concise. Tell the user what changed after write operations.`;

const form = document.querySelector("#agent-form");
const userStatus = document.querySelector("#user-status");
const enabledToolsText = document.querySelector("#enabled-tools");
const status = document.querySelector("#status");
const transcript = document.querySelector("#transcript");
const instructionsInput = document.querySelector("#instructions");
const agentInput = document.querySelector("#agent-input");
const submitButton = form.querySelector("button[type='submit']");
const clearButton = document.querySelector("#clear-output");
const resetButton = document.querySelector("#reset-prompt");
const todoStatus = document.querySelector("#todo-status");
const todoList = document.querySelector("#todo-list");

const defaultPrompt = agentInput.value;
const conversation = [];
let enabledTools = [];
let todosCollection;

instructionsInput.value = DEFAULT_INSTRUCTIONS;

function compactJson(value) {
  return JSON.stringify(value ?? {});
}

function displayValue(value) {
  if (typeof value === "string") return value;
  return JSON.stringify(value ?? null, null, 2);
}

function truncate(value, maxLength = 220) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function textLength(value) {
  return typeof value === "string" ? value.length : compactJson(value).length;
}

function appendTextBlock(parent, text) {
  const quote = document.createElement("blockquote");
  quote.textContent = text;
  parent.append(quote);
}

function appendMetaLine(parent, label, text) {
  const line = document.createElement("p");
  line.className = "transcript-meta";

  if (label) {
    line.innerHTML = `<span></span> <code></code>`;
    line.children[0].textContent = label;
    line.children[1].textContent = text;
  } else {
    const code = document.createElement("code");
    code.textContent = text;
    line.append(code);
  }

  parent.append(line);
}

function renderableBlocks(message) {
  if (message.role === "toolResult") return [];
  return (message.content ?? []).filter((block) => block?.type !== "toolCall");
}

function hasRenderableMessageContent(message) {
  return renderableBlocks(message).some((block) => {
    if (block?.type === "text") return block.text.length > 0;
    if (block?.type === "thinking") return block.thinking.length > 0;
    return true;
  });
}

function blockElement(block) {
  const fragment = document.createDocumentFragment();

  if (block?.type === "text") {
    appendTextBlock(fragment, block.text);
  } else if (block?.type === "thinking") {
    appendMetaLine(fragment, "Thinking ·", truncate(block.thinking));
  } else if (block?.type === "image") {
    appendMetaLine(fragment, "Image ·", block.mimeType);
  } else {
    appendMetaLine(fragment, "Unknown block ·", compactJson(block));
  }

  return fragment;
}

function messageElement(message) {
  const item = document.createElement("li");
  item.className = `message ${message.role}`;

  const title = document.createElement("strong");
  title.textContent = `${message.role === "user" ? "User" : "Assistant"}:`;
  item.append(title);

  for (const block of renderableBlocks(message)) {
    item.append(blockElement(block));
  }

  return item;
}

function scrollTranscript() {
  transcript.scrollTop = transcript.scrollHeight;
}

function appendTranscriptMessage(message) {
  if (!hasRenderableMessageContent(message)) return undefined;

  const element = messageElement(message);
  transcript.append(element);
  scrollTranscript();
  return element;
}

function replaceTranscriptMessage(element, message) {
  if (!hasRenderableMessageContent(message)) {
    element.remove();
    scrollTranscript();
    return undefined;
  }

  const next = messageElement(message);
  element.replaceWith(next);
  scrollTranscript();
  return next;
}

function appendToolEvent(toolName, args) {
  const item = document.createElement("li");
  item.className = "message event tool-event";
  transcript.append(item);
  updateToolEvent(item, { toolName, args, statusText: "Running..." });
  return item;
}

function updateToolEvent(item, { toolName, args, statusText, result, isError = false }) {
  item.replaceChildren();
  appendMetaLine(item, "", `${toolName}(${truncate(compactJson(args), 160)})`);

  if (result === undefined) {
    appendMetaLine(item, "Status ·", statusText);
    scrollTranscript();
    return;
  }

  const details = document.createElement("details");
  details.className = isError ? "tool-result error" : "tool-result";

  const summary = document.createElement("summary");
  summary.textContent = `${isError ? "Error" : "Result"} (${textLength(result)} chars)`;

  const code = document.createElement("code");
  code.textContent = displayValue(result);

  const pre = document.createElement("pre");
  pre.append(code);
  details.append(summary, pre);
  item.append(details);
  scrollTranscript();
}

function setRunning(running) {
  submitButton.disabled = running;
  clearButton.disabled = running;
  resetButton.disabled = running;
  transcript.classList.toggle("is-locked", running);
}

function renderTools(missingToolNames = []) {
  const names = [...IMPLICIT_TOOL_NAMES, ...enabledTools.map((tool) => tool.name)];
  const missing = missingToolNames.length ? ` Missing on this server: ${missingToolNames.join(", ")}.` : "";
  enabledToolsText.textContent = names.length ? `${names.join(", ")}.${missing}` : `No tools enabled.${missing}`;
}

function todoTitle(todo) {
  return typeof todo.title === "string" && todo.title.trim() ? todo.title : `Untitled todo (${todo.id})`;
}

function todoCompleted(todo) {
  return todo.completed === true || todo.done === true || todo.status === "done" || todo.status === "completed";
}

function renderTodos(todos) {
  todoList.replaceChildren(...todos.map((todo) => {
    const item = document.createElement("li");
    item.className = todoCompleted(todo) ? "todo completed" : "todo";

    const title = document.createElement("span");
    title.textContent = todoTitle(todo);

    const meta = document.createElement("small");
    meta.textContent = todo.id;

    item.append(title, meta);
    return item;
  }));

  todoStatus.textContent = todos.length ? `${todos.length} todo(s)` : "No todos yet. Ask the agent to add one.";
}

async function refreshTodos() {
  const todos = await todosCollection.list();
  todos.sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
  renderTodos(todos);
}

function conversationContext() {
  if (conversation.length === 0) return "";

  return [
    "Previous conversation context:",
    ...conversation.map((turn) => `${turn.role.toUpperCase()}: ${turn.content}`),
    "",
    "New user message:",
  ].join("\n");
}

clearButton.addEventListener("click", () => {
  transcript.replaceChildren();
  conversation.length = 0;
  status.textContent = "Chat cleared. Ask the agent to inspect or change the todo list.";
});

resetButton.addEventListener("click", () => {
  agentInput.value = defaultPrompt;
  agentInput.focus();
});

agentInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;

  if (event.shiftKey || event.ctrlKey) {
    return;
  }

  event.preventDefault();
  form.requestSubmit();
});

agentInput.addEventListener("keydown", (event) => {
  if (event.key !== "j" || !event.ctrlKey) return;

  event.preventDefault();
  const start = agentInput.selectionStart;
  const end = agentInput.selectionEnd;
  agentInput.setRangeText("\n", start, end, "end");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const input = agentInput.value.trim();
  const instructions = instructionsInput.value.trim();
  if (!input) return;

  setRunning(true);
  status.textContent = "Running agent turn...";
  agentInput.value = "";

  try {
    appendTranscriptMessage({ role: "user", content: [{ type: "text", text: input }] });

    let currentMessageElement;
    let response;
    let streamedMessages = 1;
    const toolEventElements = new Map();

    for await (const event of quick.ai.agentStream({
      input: `${conversationContext()}${input}`,
      instructions,
      tools: enabledTools.map((tool) => tool.name),
    })) {
      if (event.type === "message_start") {
        if (event.message.role !== "user") {
          currentMessageElement = appendTranscriptMessage(event.message);
          if (currentMessageElement) streamedMessages += 1;
        }
        continue;
      }

      if (event.type === "message_update") {
        if (event.message.role !== "user") {
          const hadElement = Boolean(currentMessageElement);
          currentMessageElement = currentMessageElement
            ? replaceTranscriptMessage(currentMessageElement, event.message)
            : appendTranscriptMessage(event.message);
          if (!hadElement && currentMessageElement) streamedMessages += 1;
        }
        continue;
      }

      if (event.type === "message_end") {
        if (event.message.role !== "user") {
          const hadElement = Boolean(currentMessageElement);
          currentMessageElement = currentMessageElement
            ? replaceTranscriptMessage(currentMessageElement, event.message)
            : appendTranscriptMessage(event.message);
          if (!hadElement && currentMessageElement) streamedMessages += 1;
          currentMessageElement = undefined;
        }
        continue;
      }

      if (event.type === "tool_start") {
        toolEventElements.set(event.toolCallId, {
          args: event.args,
          element: appendToolEvent(event.toolName, event.args),
          toolName: event.toolName,
        });
        status.textContent = `Running ${event.toolName}...`;
        continue;
      }

      if (event.type === "tool_update") {
        const toolEvent = toolEventElements.get(event.toolCallId) ?? {
          args: event.args,
          element: appendToolEvent(event.toolName, event.args),
          toolName: event.toolName,
        };
        toolEventElements.set(event.toolCallId, toolEvent);
        updateToolEvent(toolEvent.element, {
          args: toolEvent.args,
          statusText: `Receiving result (${textLength(event.partialResult)} chars)...`,
          toolName: toolEvent.toolName,
        });
        continue;
      }

      if (event.type === "tool_end") {
        const toolEvent = toolEventElements.get(event.toolCallId) ?? {
          args: event.args,
          element: appendToolEvent(event.toolName, event.args),
          toolName: event.toolName,
        };
        toolEventElements.set(event.toolCallId, toolEvent);
        updateToolEvent(toolEvent.element, {
          args: toolEvent.args,
          isError: event.isError,
          result: event.result,
          toolName: toolEvent.toolName,
        });
        continue;
      }

      if (event.type === "error") {
        throw new Error(event.error);
      }

      if (event.type === "done") {
        response = event;
      }
    }

    if (!response) {
      throw new Error("Agent stream ended without a final response");
    }

    conversation.push({ role: "user", content: input });
    conversation.push({ role: "assistant", content: response.output });
    status.textContent = `Agent finished. Rendered ${streamedMessages} streamed transcript message(s).`;
    await refreshTodos();
  } catch (error) {
    console.error(error);
    status.textContent = error instanceof Error ? error.message : String(error);
    agentInput.value = input;
  } finally {
    setRunning(false);
    agentInput.focus();
  }
});

async function main() {
  const session = await quick.auth.session();

  if (!session.authenticated) {
    userStatus.textContent = "You are not signed in.";
    status.textContent = "Quick AI agent requires an authenticated Quick session.";
    const login = await quick.auth.login({ returnTo: location.href });
    const link = document.createElement("a");
    link.href = login.authorizationUrl;
    link.textContent = "Sign in to try it";
    status.append(" ", link);
    enabledToolsText.textContent = "Sign in to load tools.";
    todoStatus.textContent = "Sign in to load todos.";
    return;
  }

  userStatus.textContent = `Signed in as ${session.user.email ?? session.user.id}`;

  const availableTools = (await quick.ai.tools()).tools;
  const availableToolsByName = new Map(availableTools.map((tool) => [tool.name, tool]));
  enabledTools = REQUESTED_TOOL_NAMES.map((name) => availableToolsByName.get(name)).filter(Boolean);
  const enabledToolNames = new Set(enabledTools.map((tool) => tool.name));
  const missingToolNames = REQUESTED_TOOL_NAMES.filter((name) => !enabledToolNames.has(name));
  renderTools(missingToolNames);

  todosCollection = quick.db.collection(TODO_COLLECTION);
  await refreshTodos();
  form.hidden = false;
  status.textContent = "Ready. Ask the agent to add, list, complete, or update todos.";
}

await main();
