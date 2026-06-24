# Quick examples

The examples are small on purpose. Each one is a plain static site that imports `/quick.js`, then reaches for one platform capability. Together they sketch the Quick philosophy: keep the app local and readable, push the boring infrastructure into the platform, and deploy the folder when it works.

```sh
quick deploy ./examples/todo todo
quick deploy ./examples/chat chat
quick deploy ./examples/gallery gallery
quick deploy ./examples/realtime realtime
quick deploy ./examples/ai-chat ai-chat
```

## The collection theme

Quick examples are not templates for large frameworks. They are little pressure tests for platform primitives:

- [Todo](./todo/) shows basic database handling with `quick.db.collection(...)`.
- [Chat](./chat/) adds identity and `collection.subscribe(...)` for live updates over SSE.
- [Gallery](./gallery/) demonstrates `quick.files` for uploads, file metadata, public URLs, and deletion.
- Realtime demonstrates `quick.realtime.presence(...)` for live presence and viewport-relative cursors.
- [AI Chat](./ai-chat/) demonstrates ephemeral, authenticated `quick.ai.chat(...)` calls through the server-side AI gateway.

Read them as recipes. Copy the smallest useful piece, change the collection name, and let the next app grow from there.

## Shared pattern

Every example starts the same way:

<div class="code-title">index.html</div>

```html
<script type="module">
  import { createQuickClient } from "/quick.js";

  const quick = createQuickClient();
</script>
```

That import is the hinge. Before it, you have a static page. After it, the page can remember things, react to other users, know who is signed in, store files, and call server-side AI chat.
