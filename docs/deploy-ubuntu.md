# Native Ubuntu 24 deployment

This deployment uses host-installed Node.js, PostgreSQL, Nginx, and systemd. It does not use containers.

## 1. Install services

```sh
sudo apt update
sudo apt install -y postgresql postgresql-contrib nginx certbot python3-certbot-nginx
```

Install Node 24 using your preferred maintained Node repository or version manager, then enable Corepack:

```sh
sudo corepack enable
node --version
pnpm --version
```

## 2. Create the database and service account

```sh
sudo -u postgres psql <<'SQL'
CREATE USER nkriz WITH PASSWORD 'replace-with-a-long-random-password';
CREATE DATABASE nkriz OWNER nkriz;
SQL

sudo useradd --system --home /opt/nkriz-notepad --shell /usr/sbin/nologin nkriz-app
sudo mkdir -p /opt/nkriz-notepad /var/lib/nkriz-notepad/blobs
sudo chown -R nkriz-app:nkriz-app /opt/nkriz-notepad /var/lib/nkriz-notepad
```

Copy the repository into `/opt/nkriz-notepad`, preserving ownership.

## 3. Configure and build

Create `/etc/nkriz-notepad.env` with mode `600`:

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=8787
DATA_DIR=/var/lib/nkriz-notepad
WEB_DIST_DIR=/opt/nkriz-notepad/apps/web/dist
DATABASE_URL=postgresql://nkriz:replace-with-a-long-random-password@127.0.0.1:5432/nkriz?schema=public
SESSION_PEPPER=replace-with-at-least-32-random-bytes
COOKIE_SECURE=true
TRUST_PROXY=true
MAX_FILE_BYTES=104857600
MAX_STORAGE_BYTES=10737418240
```

Generate the pepper with `openssl rand -base64 48`. Then install and build:

```sh
cd /opt/nkriz-notepad
sudo -u nkriz-app pnpm install --frozen-lockfile
sudo -u nkriz-app env DATABASE_URL='postgresql://nkriz:YOUR_PASSWORD@127.0.0.1:5432/nkriz?schema=public' pnpm --filter @nkriz/api db:migrate
sudo -u nkriz-app pnpm build
```

## 4. Run with systemd

Create `/etc/systemd/system/nkriz-notepad.service`:

```ini
[Unit]
Description=NKriZ encrypted online notepad
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=nkriz-app
Group=nkriz-app
WorkingDirectory=/opt/nkriz-notepad
EnvironmentFile=/etc/nkriz-notepad.env
ExecStartPre=/usr/bin/pnpm --filter @nkriz/api db:migrate
ExecStart=/usr/bin/node /opt/nkriz-notepad/apps/api/dist/server.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/nkriz-notepad

[Install]
WantedBy=multi-user.target
```

Adjust the Node and pnpm paths if installed elsewhere, then start the service:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now nkriz-notepad
curl --fail http://127.0.0.1:8787/health
```

## 5. HTTPS with Nginx

Create `/etc/nginx/sites-available/nkriz-notepad`:

```nginx
server {
    listen 80;
    server_name notes.example.com;

    client_max_body_size 110m;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

```sh
sudo ln -s /etc/nginx/sites-available/nkriz-notepad /etc/nginx/sites-enabled/nkriz-notepad
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d notes.example.com
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

## 6. Backups and updates

Back up PostgreSQL and encrypted blobs together:

```sh
mkdir -p backups/$(date +%Y%m%d-%H%M%S)
BACKUP_DIR=$(find backups -mindepth 1 -maxdepth 1 -type d | sort | tail -1)
PGPASSWORD='YOUR_PASSWORD' pg_dump -h 127.0.0.1 -U nkriz nkriz | gzip > "$BACKUP_DIR/database.sql.gz"
sudo tar -czf "$BACKUP_DIR/encrypted-blobs.tar.gz" -C /var/lib/nkriz-notepad blobs
```

Before updating, create a backup. Then rebuild and restart:

```sh
cd /opt/nkriz-notepad
sudo -u nkriz-app pnpm install --frozen-lockfile
sudo -u nkriz-app pnpm build
sudo systemctl restart nkriz-notepad
sudo systemctl status nkriz-notepad
```
