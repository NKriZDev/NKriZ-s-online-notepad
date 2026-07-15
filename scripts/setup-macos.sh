#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required for the native macOS setup." >&2
  exit 1
fi

brew list node@24 >/dev/null 2>&1 || brew install node@24
brew list postgresql@17 >/dev/null 2>&1 || brew install postgresql@17

export PATH="/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/postgresql@17/bin:$PATH"
corepack enable

PG_PORT="${NKRIZ_PG_PORT:-5433}"
PG_CONFIG="/opt/homebrew/var/postgresql@17/postgresql.conf"
if grep -qE '^#?port = ' "$PG_CONFIG"; then
  sed -i '' -E "s/^#?port = .*/port = $PG_PORT/" "$PG_CONFIG"
else
  printf '\nport = %s\n' "$PG_PORT" >> "$PG_CONFIG"
fi
brew services restart postgresql@17

for _ in 1 2 3 4 5 6 7 8 9 10; do
  pg_isready -h 127.0.0.1 -p "$PG_PORT" >/dev/null 2>&1 && break
  sleep 1
done
pg_isready -h 127.0.0.1 -p "$PG_PORT"
createdb -h 127.0.0.1 -p "$PG_PORT" nkriz 2>/dev/null || true
cd "$ROOT"

if [[ ! -f .env ]]; then
  cp .env.mac.example .env
  pepper="$(openssl rand -base64 48 | tr -d '\n')"
  sed -i '' "s|replace-with-at-least-32-random-bytes|$pepper|" .env
fi
sed -i '' "s|YOUR_MAC_USERNAME|$(id -un)|" .env

pnpm install
set -a
source .env
set +a
pnpm --filter @nkriz/api db:generate
pnpm --filter @nkriz/api db:migrate

echo "Native setup complete. Run: export PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/postgresql@17/bin:\$PATH && pnpm dev:native"
