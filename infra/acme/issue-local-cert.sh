#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

QUICK_DOMAIN="${QUICK_DOMAIN:?QUICK_DOMAIN must be set in .env or the environment}"
ACME_EMAIL="${ACME_EMAIL:?ACME_EMAIL must be set in .env or the environment}"
CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN must be set in .env or the environment}"
CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-}"

mkdir -p "$ROOT_DIR/runtime/certs/acme.sh" "$ROOT_DIR/runtime/certs/nginx"

docker run --rm \
  -e "CF_Token=$CLOUDFLARE_API_TOKEN" \
  -e "CF_Account_ID=$CLOUDFLARE_ACCOUNT_ID" \
  -v "$ROOT_DIR/runtime/certs/acme.sh:/acme.sh" \
  -v "$ROOT_DIR/runtime/certs/nginx:/certs" \
  --entrypoint sh \
  neilpang/acme.sh \
  -c "acme.sh --issue --dns dns_cf --server letsencrypt --keylength ec-256 --email '$ACME_EMAIL' -d '$QUICK_DOMAIN' -d '*.$QUICK_DOMAIN' && acme.sh --install-cert --ecc -d '$QUICK_DOMAIN' --fullchain-file /certs/fullchain.pem --key-file /certs/key.pem"

printf 'Issued certs for %s into runtime/certs/nginx/\n' "$QUICK_DOMAIN"
