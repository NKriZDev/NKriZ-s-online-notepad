# NKriZ's Online Notepad

A desktop-first, self-hosted notepad and encrypted file vault. Notes, filenames, folders, tags, secrets, settings, and file keys are encrypted in the browser before synchronization. The Fastify/Prisma API stores opaque ciphertext in PostgreSQL and encrypted file chunks on the host filesystem.

## Included

- Single-owner first-run setup with permanent signup lockout
- Argon2id + HKDF password derivation and AES-256-GCM encryption
- Owner-held recovery key and password rotation without server decryption
- Offline encrypted IndexedDB cache, queued writes, and reconnect sync
- Optimistic revisions with automatic conflict-copy preservation
- Nested folders, tags, colors, favorites, recents, trash, search, and tabs
- Plain text, Markdown source/preview/split, and CodeMirror code editing
- Simple Secret and Password Manager views over one encrypted record format
- Password generation, TOTP, JWT inspection, expiry fields, and clipboard clearing
- Chunked encrypted file uploads, local previews, and SHA-256 verification
- PostgreSQL with automatic Prisma migrations, available through Docker or a native install

## Docker quick start

Docker runs the application and PostgreSQL together. It keeps the database and encrypted file blobs in named volumes, generates a stable server-side authentication pepper on first boot, applies migrations automatically, and exposes the complete app on port 8787.

```sh
docker compose up --build -d
docker compose logs -f app
```

Open [http://localhost:8787](http://localhost:8787). Once the log shows that the server is listening, create the single owner account in the browser.

Useful lifecycle commands:

```sh
docker compose stop              # Stop without removing anything
docker compose start             # Start the existing installation
docker compose down              # Recreate containers later; data is preserved
docker compose down -v           # Permanently delete the database and encrypted files
```

The defaults are ready for a local machine. To change the published port or database credentials without affecting the native `.env`, create a Docker-specific environment file before the first start:

```sh
cp .env.docker.example .env.docker
docker compose --env-file .env.docker up --build -d
```

Use `--env-file .env.docker` with later Compose commands for that installation. If this is exposed through an HTTPS reverse proxy, set `DOCKER_COOKIE_SECURE=true` and `DOCKER_TRUST_PROXY=true`. The PostgreSQL port is intentionally not published to the host.

Back up both named volumes together: `nkriz-notepad_postgres_data` contains database records, while `nkriz-notepad_app_data` contains encrypted file chunks and the automatically generated authentication pepper. Losing the pepper while retaining the database prevents existing credentials from being verified.

## Native macOS setup

Docker is optional. The existing native development and production workflows remain available.

The setup script installs keg-isolated Node 24 and PostgreSQL 17 through Homebrew, starts PostgreSQL 17 on port 5433 as a macOS service, creates the `nkriz` database, generates a local session pepper, installs packages, and applies Prisma migrations. Port 5433 deliberately avoids modifying an existing PostgreSQL installation on the usual port.

```sh
./scripts/setup-macos.sh
export PATH="/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/postgresql@17/bin:$PATH"
pnpm dev:native
```

Open [http://localhost:5173](http://localhost:5173). Vite serves the interface and proxies `/api` to the native Fastify process on port 8787.

For manual setup:

```sh
brew install node@24 postgresql@17
export PATH="/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/postgresql@17/bin:$PATH"
sed -i '' -E 's/^#?port = .*/port = 5433/' /opt/homebrew/var/postgresql@17/postgresql.conf
brew services restart postgresql@17
createdb -h 127.0.0.1 -p 5433 nkriz
cp .env.mac.example .env
# Replace YOUR_MAC_USERNAME and SESSION_PEPPER in .env.
corepack enable
pnpm install
pnpm dev:native
```

## Native production-style run

Fastify serves the built React application itself, so no separate web server is required for local testing.

```sh
pnpm build
pnpm start
```

Open [http://127.0.0.1:8787](http://127.0.0.1:8787).

## Validation

```sh
pnpm typecheck
pnpm test
pnpm build
DATABASE_URL="postgresql://$USER@127.0.0.1:5433/nkriz?schema=public" pnpm --filter @nkriz/api exec prisma validate
```

Tests cover cryptographic record binding, wrong-key rejection, recovery-key parsing, JWT/TOTP helpers, opaque server authentication, and the Prisma zero-knowledge storage boundary.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and pull-request expectations. Please report vulnerabilities privately using the process in [SECURITY.md](SECURITY.md); do not open a public issue for security-sensitive reports.

## Data and threat model

- The browser sends a derived authentication credential, never the password or vault wrapping key.
- The API can observe the owner username, ciphertext sizes, record IDs, revisions, timing, and file sizes. It cannot read content or filenames.
- Decrypted vault state and search data exist only in browser memory while unlocked. IndexedDB stores ciphertext.
- The recovery key is not escrowed. Losing both password and recovery key makes the vault unrecoverable.
- Clipboard clearing is best-effort because browsers and operating systems do not guarantee clipboard ownership.
- TLS is mandatory outside local development. See [Ubuntu deployment](docs/deploy-ubuntu.md).

## Repository layout

- `apps/web` — React/Vite PWA and crypto worker
- `apps/api` — Fastify API, Prisma schema, and PostgreSQL migration
- `scripts` — native macOS and Docker launch helpers
- `Dockerfile` and `compose.yaml` — optional containerized app and PostgreSQL stack
- `docs/deploy-ubuntu.md` — native Ubuntu 24 deployment with systemd
