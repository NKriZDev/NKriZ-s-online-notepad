#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "Missing .env. Copy .env.mac.example to .env and set SESSION_PEPPER first." >&2
  exit 1
fi

set -a
source .env
set +a

pnpm --filter @nkriz/api db:generate
pnpm --filter @nkriz/api db:migrate
exec pnpm dev
