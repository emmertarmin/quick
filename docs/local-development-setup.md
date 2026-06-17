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

The stack runs the server and NGINX. NGINX serves the built Astro web app from `apps/web/dist/`; if that folder has not been built yet, web pages fail instead of being generated implicitly.

For hot reloading on the real Quick origin, run Astro separately:

```sh
bun run dev:web
```

When `dev:web` is running, NGINX prefers the Astro dev server at `127.0.0.1:4321`, so `https://local.example.com/` keeps the real Quick origin/cookies/SDK while Astro hot reload works. If `dev:web` is stopped, NGINX falls back to `apps/web/dist/`.

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

Site hosts such as `https://demo.local.example.com/` are separate from the platform homepage. They are served from runtime deployment state under `runtime/sites/{site}/` and require an `index.html` at the site root. Checked-in examples under `examples/` are not live until they are deployed or seeded into `runtime/sites/`.
