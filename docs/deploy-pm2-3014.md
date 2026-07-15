# Split deployment: static frontend and PM2 backend

Production is split across two HTTPS origins:

- `https://workspace.nkriz.ir` serves only the contents of `apps/web/dist`.
- `https://workspacebackend.nkriz.ir` forwards to the Fastify API on server port `3014`.

Fastify does not serve the frontend in this configuration. Port `3019` is not needed.

## 1. Build the static frontend

The production build already reads `apps/web/.env.production`, which contains:

```dotenv
VITE_API_BASE_URL=https://workspacebackend.nkriz.ir
```

Build on the Mac or the Ubuntu server:

```sh
pnpm install --frozen-lockfile
pnpm build
```

Upload **the contents** of `apps/web/dist` to the document root configured for `workspace.nkriz.ir`. The static host must serve `index.html` at `/`, preserve the generated asset filenames, and use HTTPS.

## 2. Upload the backend project with Termius

Upload the repository to `/opt/workspace`. Do not upload local `node_modules`, `.env`, or `data` directories.

If Termius cannot write to `/opt`, upload to the SSH user's home first, then run:

```sh
sudo mkdir -p /opt/workspace
sudo cp -a ~/workspace/. /opt/workspace/
sudo chown -R "$USER":"$USER" /opt/workspace
```

## 3. Verify Node/pnpm and install PM2

Use Node.js 22.12 or newer and pnpm 10:

```sh
node --version
npm --version
sudo corepack enable
corepack prepare pnpm@10.12.4 --activate
sudo npm install --global pm2
pnpm --version
pm2 --version
```

## 4. Create the PostgreSQL owner and database

If they do not already exist:

```sh
DB_PASSWORD="$(openssl rand -hex 32)"
sudo -u postgres psql --set=db_password="$DB_PASSWORD" <<'SQL'
CREATE ROLE nkriz LOGIN PASSWORD :'db_password';
CREATE DATABASE nkriz OWNER nkriz;
SQL
printf 'Save this database password now: %s\n' "$DB_PASSWORD"
```

If the `nkriz` role or database already exists, use its existing password instead.

## 5. Configure the backend

```sh
cd /opt/workspace
cp .env.server.example .env
chmod 600 .env
openssl rand -hex 48
nano .env
```

Replace the database password and stable session pepper. Keep these split-origin settings:

```dotenv
FRONTEND_ORIGIN=https://workspace.nkriz.ir
SERVE_WEB=false
COOKIE_SECURE=true
TRUST_PROXY=true
```

`FRONTEND_ORIGIN` is used by both credentialed CORS and the write-request origin check. Do not add a trailing path.

The session pepper verifies login and recovery credentials. Back up `.env` securely; changing or losing it prevents existing credentials from being verified.

Create the encrypted blob directory:

```sh
sudo mkdir -p /var/lib/nkriz-notepad/blobs
sudo chown -R "$USER":"$USER" /var/lib/nkriz-notepad
chmod 700 /var/lib/nkriz-notepad
```

## 6. Install, migrate, build, and start the backend

```sh
cd /opt/workspace
set -a
. ./.env
set +a
pnpm install --frozen-lockfile
pnpm --filter @nkriz/api db:migrate
pnpm build
pm2 start ecosystem.config.cjs
pm2 save
```

The ecosystem file binds Fastify to `0.0.0.0:3014`. Verify it locally:

```sh
curl --fail http://127.0.0.1:3014/health
pm2 status
pm2 logs nkriz-workspace-backend --lines 100
```

Expected health response:

```json
{"ok":true,"database":"postgresql"}
```

Your existing HTTPS routing should send `workspacebackend.nkriz.ir` to port `3014`. Test the public endpoint before opening the frontend:

```sh
curl --fail https://workspacebackend.nkriz.ir/health
```

## 7. Start PM2 after reboot

```sh
pm2 startup
```

Run the exact `sudo ...` command printed by PM2, then:

```sh
pm2 save
```

## Updating later

Upload changed source files, then rebuild both outputs:

```sh
cd /opt/workspace
set -a
. ./.env
set +a
pnpm install --frozen-lockfile
pnpm --filter @nkriz/api db:migrate
pnpm build
pm2 restart ecosystem.config.cjs --update-env
curl --fail http://127.0.0.1:3014/health
```

Upload the new contents of `apps/web/dist` to the frontend host after every frontend build.

## Backup essentials

Back up PostgreSQL, encrypted blobs, and `.env` together:

```sh
mkdir -p "$HOME/nkriz-backups/$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$(find "$HOME/nkriz-backups" -mindepth 1 -maxdepth 1 -type d | sort | tail -1)"
set -a; . /opt/workspace/.env; set +a
pg_dump "$DATABASE_URL" | gzip > "$BACKUP_DIR/database.sql.gz"
tar -czf "$BACKUP_DIR/encrypted-blobs.tar.gz" -C /var/lib/nkriz-notepad blobs
cp /opt/workspace/.env "$BACKUP_DIR/server.env"
chmod 600 "$BACKUP_DIR/server.env"
```
