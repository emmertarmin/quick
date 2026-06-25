# Todo example

The Todo example is the first stop because it proves the most important idea: a static page can keep durable state without owning a backend.

It lives in `examples/todo/` and uses one collection named `todos`.

## Core principle: basic database handling

The app creates a Quick client, opens a collection, and treats documents as ordinary JSON objects.

<div class="code-title">examples/todo/index.html</div>

```js
const quick = createQuickClient();
const todos = quick.db.collection("todos");
```

Creating a todo is just a document insert:

<div class="code-title">examples/todo/index.html</div>

```js
await todos.create({
  title,
  done: false,
});
```

Toggling is a partial update:

<div class="code-title">examples/todo/index.html</div>

```js
await todos.update(todo.id, {
  done: !todo.done,
});
```

And rendering begins by reading all documents back:

<div class="code-title">examples/todo/index.html</div>

```js
const allTodos = await todos.list();
```

## What to notice

There is no schema file, migration, REST handler, or app-specific server. The page owns the UI and calls Quick for persistence. That makes this example a good seed for checklists, voting options, lightweight trackers, and tiny admin tools.

Deploy it with:

```sh
quick deploy ./examples/todo todo
```
