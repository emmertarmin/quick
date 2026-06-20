# Local development setup

## 1. Pick a local domain

Use a dedicated subdomain for the local Quick stack, for example:

- platform: `local.example.com`
- sites: `*.local.example.com`

In your DNS provider, create records for both names pointing at your dev machine. For purely local browser use, pointing them at `127.0.0.1` is fine if your DNS provider allows it.

## 2. Configure environment

Copy `.env.example` to `.env` and set:

<div class="code-title">.env</div>

```sh
QUICK_DOMAIN=local.example.com

CLOUDFLARE_API_TOKEN=...
ACME_EMAIL=you@example.com
```

`QUICK_SCHEME` defaults to `https`, cookie scope is derived from `QUICK_DOMAIN`, and NGINX wildcard matching uses `*.${QUICK_DOMAIN}`. If acme.sh needs Cloudflare account disambiguation, you can optionally set `CLOUDFLARE_ACCOUNT_ID`.

## 3. Issue the wildcard certificate

The built-in certificate script uses Let's Encrypt DNS-01 via Cloudflare:

```sh
bun run cert:issue
```

It writes NGINX-mounted files to:

<div class="code-title">runtime/certs/nginx/</div>

```sh
runtime/certs/nginx/fullchain.pem
runtime/certs/nginx/key.pem
```

## 4. Start the stack

```sh
bun install
bun run build
bun run dev
```

The stack runs the server and NGINX. The Bun server owns Quick routing: it derives the site from the request host, serves `/api/*`, `/quick.js`, the platform web build, and deployed site files from `runtime/sites/`. NGINX only terminates local TLS and forwards wildcard traffic to Bun.

The platform homepage is served from the built Astro web app in `apps/web/dist/`; if that folder has not been built yet, web pages fail instead of being generated implicitly.

For hot reloading on the real Quick origin, run Astro separately:

```sh
bun run dev:web
```

When `dev:web` is running, the Bun server proxies platform web requests to the Astro dev server at `127.0.0.1:4321`, so `https://local.example.com/` keeps the real Quick origin/cookies/SDK while Astro hot reload works. If `dev:web` is stopped, Bun falls back to `apps/web/dist/`.

The server dev script uses `bun --watch` intentionally. It fully restarts the Bun process on changes, which drops live WebSocket clients and in-memory realtime state, but avoids `bun --hot` module replacement edge cases around `Bun.serve`/WebSocket lifecycle during local Quick routing development.

Or recreate after config/cert changes:

```sh
docker compose up -d --force-recreate server nginx
```

## 5. Smoke test

```sh
curl https://local.example.com/api/health
```

Expected response:

<div class="code-title">response.json</div>

```json
{ "status": "ok" }
```

The web homepage at `https://local.example.com/` is served from Astro's static output in `apps/web/dist/`. It uses the browser Quick SDK (`/quick.js`) for login/logout/session display and for listing deployed runtime sites. Documentation markdown from `docs/` is rendered at `https://local.example.com/docs/`.

Site hosts such as `https://demo.local.example.com/` are separate from the platform homepage. Bun maps the hostname to the site name (`demo`) and serves runtime deployment state under `runtime/sites/{site}/`; each site requires an `index.html` at the site root. Checked-in examples under `examples/` are not live until they are deployed or seeded into `runtime/sites/`.
