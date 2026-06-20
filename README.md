# Quick

Quick is an experimental, self-hosted Bun reimplementation inspired by [Shopify Quick](https://shopify.engineering/quick): a tiny internal-app platform for people who want to build, share, and iterate before the idea cools down.

Bring a folder of plain HTML, CSS, and JavaScript. Quick gives it a name, a URL, and a small set of platform APIs—identity, schemaless data, realtime updates, and files—so static prototypes can become useful internal tools without each one growing its own backend.

The motivating loop is this small:

```sh
bun add -g @emmertarmin/quick
quick config set remote https://quick.example.com

mkdir poll
cd poll
quick init
pi -p "Create a poll where we can vote when in July to hold our summerfest"
quick deploy .
```

That is the point: ask for the tool, deploy the tool, use the tool.

## Why it is exciting

- **Static-first shipping** — deploy a directory, not a stack.
- **Apps with memory** — use site-scoped collections from the browser SDK.
- **Realtime collaboration** — subscribe to collection changes for polls, chats, dashboards, and tiny shared workflows.
- **Identity included** — know who is using the app without turning every prototype into an auth project.
- **Files included** — add uploads and stable public site URLs with the SDK.
- **Agent-friendly shape** — Quick is designed for small apps generated and refined by coding agents.

For the full product story and API overview, start with [[docs/index|the Quick docs]].

## Explore the repo

- [[docs/local-development-setup|Local development setup]]
- [[docs/cli|CLI reference]]
- [[docs/sdk|Browser SDK]]
- [[docs/examples|Examples overview]]
- [[docs/examples/todo|Todo example]]
- [[docs/examples/chat|Realtime chat example]]
- [[docs/examples/gallery|Gallery and uploads example]]

## Current shape

This repo is a Bun monorepo with a Hono/Bun platform server, browser SDK, CLI, optional NGINX TLS frontend, SQLite/Drizzle persistence, OpenAuth-based auth, deploy support, and example static apps.

It is intentionally small. The ambition is not to be another application framework; it is to make the smallest useful internal app feel one command away.
