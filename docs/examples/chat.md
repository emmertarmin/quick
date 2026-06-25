# Chat example

The Chat example takes the Todo idea and makes it collaborative. It combines identity, database writes, and live collection subscriptions so multiple open browsers see updates without polling.

It lives in `examples/chat/` and uses one collection named `messages`.

## Core principle: subscribe for live updates

The app asks Quick who is signed in before allowing a message to be sent:

<div class="code-title">examples/chat/index.html</div>

```js
currentUser = await quick.identity.current();
```

Messages are stored as normal collection documents, with user metadata attached by the browser app:

<div class="code-title">examples/chat/index.html</div>

```js
await messages.create({
  body,
  user_id: currentUser.id,
  user_email: currentUser.email ?? currentUser.id,
  user_name: currentUser.name ?? null,
});
```

The interesting part is the subscription:

<div class="code-title">examples/chat/index.html</div>

```js
messages.subscribe({
  onCreate: loadMessages,
  onUpdate: loadMessages,
  onDelete: loadMessages,
  onError: (error) => console.error("Message subscription failed", error),
});
```

Under the SDK, `subscribe` currently uses `EventSource` / Server-Sent Events. Writes still use ordinary HTTP requests, but successful mutations are pushed to connected pages for the same site and collection.

## What to notice

The example deliberately refreshes the message list on each event instead of maintaining a clever local cache. That keeps the pattern easy to steal: subscribe, reload, render. It is enough for chat, live polls, shared queues, comment streams, and status boards.

Deploy it with:

```sh
quick deploy ./examples/chat chat
```
