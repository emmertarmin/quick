# Realtime example

The Realtime example demonstrates ephemeral collaboration with `quick.realtime.presence(...)`. It tracks who is connected to a shared presence room and broadcasts viewport-relative cursor positions so other users can see live cursors without storing anything durably.

It lives in `examples/realtime/` and uses one presence channel named `cursors`.

## Core principle: presence for ephemeral state

The app creates a normal Quick client and joins a realtime presence room:

<div class="code-title">examples/realtime/index.html</div>

```js
const quick = createQuickClient();
const room = quick.realtime.presence("cursors");
```

Pointer positions are represented as relative `x/y` values so they map cleanly across different viewport sizes:

<div class="code-title">examples/realtime/index.html</div>

```js
pointer = {
  x: clientX / Math.max(1, window.innerWidth),
  y: clientY / Math.max(1, window.innerHeight),
};

room.update(pointer);
```

The page reacts to the presence lifecycle:

<div class="code-title">examples/realtime/index.html</div>

```js
room.onSnapshot((snapshot) => {
  members.clear();
  for (const member of snapshot) upsertMember(member);
});
room.onJoin(upsertMember);
room.onUpdate(upsertMember);
room.onLeave(removeMember);
```

And it joins once the connection is ready:

<div class="code-title">examples/realtime/index.html</div>

```js
room.ready.then(() => {
  room.join(pointer);
});
```

## What to notice

Presence is for transient collaboration: cursors, selection state, typing indicators, active viewers, and game-like live interactions. Do not use it as durable storage; use `quick.db.collection(...)` when the state must survive reconnects or page refreshes.

Deploy it with:

```sh
quick deploy ./examples/realtime realtime
```
