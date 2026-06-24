# Quick

Quick is a tiny platform for building useful web apps at the speed of a thought. Drop a folder of HTML, CSS, and JavaScript onto Quick, give it a name, and it becomes a live site with platform APIs for identity, persistence, realtime updates, files, and AI chat.

```sh
bun add -g @emmertarmin/quick
quick config set remote https://quick.example.com

mkdir poll
cd poll
quick init
pi -p "Create a poll where we can vote when in July to hold our summerfest"
quick deploy .
```

That is the shape of the dream: start with an empty folder, ask an agent for a small internal app, and ship it before the meeting moves on.

## What Quick gives you

### Static apps that feel like products

No framework ceremony. No per-app backend. No deployment pipeline to babysit. A Quick site is just files, served by name:

```sh
quick deploy ./dist summerfest
```

Under the hood, Quick publishes your folder into a site-scoped runtime and routes `summerfest.quick.example.com` to it. Overwrites are guarded, deploy metadata is tracked, and the CLI knows who last touched a site.

### A browser SDK at `/quick.js`

Every deployed app can import the same platform surface:

<div class="code-title">index.html</div>

```js
import { createQuickClient } from "/quick.js";

const quick = createQuickClient();
```

From there, static pages can reach shared platform capabilities without smuggling secrets into the browser or inventing infrastructure for every experiment.

### Identity without building auth

Need to know who clicked the button?

<div class="code-title">index.html</div>

```js
const me = await quick.identity.current();
```

Quick handles the login boundary and lets your app ask for the current user. Enough to make tools personal, collaborative, and accountable—without turning your weekend prototype into an auth project.

### Schemaless collections

Reach for a collection when your app needs memory:

<div class="code-title">index.html</div>

```js
const votes = quick.db.collection("votes");
await votes.create({ month: "July", day: 19 });
```

Documents are site-scoped, JSON-shaped, and intentionally low-friction. Perfect for polls, queues, dashboards, guestbooks, tiny CRMs, and all the strange internal tools nobody plans but everyone needs.

### Realtime by default

When one person votes, everyone else can see it:

<div class="code-title">index.html</div>

```js
const unsubscribe = votes.subscribe({
  onCreate: (doc) => renderVote(doc),
  onUpdate: (doc) => refreshVote(doc),
  onDelete: (id) => removeVote(id),
});
```

Quick's collection subscriptions keep simple collaborative apps simple. You write the state changes; Quick fans them out to open pages.

### Server-side AI chat

Give a static app a simple assistant call without shipping provider secrets to the browser:

<div class="code-title">index.html</div>

```js
const res = await quick.ai.chat([{ role: "user", content: "Summarize my tasks" }]);
```

Quick checks the user's session and forwards the request through the server-side AI provider configuration. Current support is simple non-streaming chat.

### Public site files

Give your app uploads with one call:

<div class="code-title">index.html</div>

```js
const uploaded = await quick.files.upload(file);
image.src = uploaded.url;
```

Quick stores file metadata next to your app data and returns stable URLs that work naturally in the browser. Image boards, lightweight galleries, attachment flows, and asset dropboxes suddenly fit in a static app.

### Agent-ready scaffolding

`quick init` is the doorway for AI-assisted app creation: seed the project with the conventions and docs an agent needs, then ask for the app in human words. The more Quick APIs the platform exposes, the more capable those generated apps become.

### The bigger ecosystem

The inspiration is Shopify's Quick: static hosting plus a fixed set of platform APIs—database, files, AI, identity, warehouse data, and collaboration primitives—so people can compose tools instead of provisioning services.

This implementation already has the core loop: CLI config and auth, deploys, browser identity, database collections, realtime subscriptions, file uploads, and server-side AI chat calls. The tantalizing frontier is what comes next: richer collaboration channels, warehouse-backed dashboards, and reusable mini-libraries shared from site to site.

## Dive deeper

- [SDK](./sdk/)
- [Server](./server/)
- [CLI](./cli/)
- [Examples](./examples/)
