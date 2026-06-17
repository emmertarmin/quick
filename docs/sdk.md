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
- `quick.db`
- `quick.files`
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
