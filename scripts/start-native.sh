#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f "${ENV_FILE:-$ROOT/.env}" ]]; then
  set -a
  source "${ENV_FILE:-$ROOT/.env}"
  set +a
fi

export NODE_ENV=production
export WEB_DIST_DIR="${WEB_DIST_DIR:-$ROOT/apps/web/dist}"

pnpm --filter @nkriz/api db:migrate
exec node apps/api/dist/server.js
