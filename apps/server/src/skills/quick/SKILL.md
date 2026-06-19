---
name: quick
description: Build, initialize, and deploy Quick static browser apps using the Quick SDK and CLI. Use when working in a Quick project, creating internal static apps, using quick.db, quick.files, quick.realtime, quick.identity, or deploying with quick deploy.
---

# Quick

Quick: static-first internal app platform. A folder of HTML/CSS/JS/assets becomes a site. Shared platform APIs replace per-app infra.

Build browser-only apps. No custom backend, server process, cron, migrations, separate auth, or client secrets. Use plain web files + `/quick.js`. Platform handles auth, identity, persistence, files, realtime.

## Defaults

- Start simple: `index.html`, `app.js`, `style.css`.
- Deploy root must contain `index.html`.
- Project metadata in `.quick.json`:

```json
{ "project": "my-project" }
```

- Use `quick init` to create/update `.quick.json` and install/update this skill.

## SDK

```js
import { createQuickClient } from "/quick.js";
const quick = createQuickClient();
```

Base SDK features:

- Auth/session: `quick.auth.session()`, `quick.auth.login()`, `quick.auth.logout()`.
- Identity: `quick.identity.current()`.
- DB: `quick.db.collection(name)` with `all/create/get/replace/update/delete/subscribe`.
- Files: `quick.files.upload(file)`, `quick.files.all()`, `quick.files.delete(id)`.
- Realtime: `quick.realtime.channel(name)` for events; `quick.realtime.presence(name)` for presence/cursors.
- Sites: `quick.sites.all()`, `quick.sites.get(site)`.

Use DB for durable state. Use `collection.subscribe(...)` for DB-driven UI updates across users/tabs. Use realtime for ephemeral state: cursors, typing, game moves, live presence.

## CLI

- `quick config set remote {{ QUICK_ORIGIN }}`
- `quick auth login`
- `quick auth status`
- `quick init`
- `quick deploy . <project>`

Deploy overwrite may require typing the project/site name.

## Examples / docs

- SDK reference: {{ QUICK_ORIGIN }}/docs/sdk/
- CLI reference: {{ QUICK_ORIGIN }}/docs/cli/
- Examples overview: {{ QUICK_ORIGIN }}/docs/examples/
- Todo / DB: {{ QUICK_ORIGIN }}/docs/examples/todo/
- Chat / identity + DB subscribe: {{ QUICK_ORIGIN }}/docs/examples/chat/
- Gallery / files: {{ QUICK_ORIGIN }}/docs/examples/gallery/
- API UI: {{ QUICK_ORIGIN }}/api/ui
