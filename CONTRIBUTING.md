# Contributing

Thanks for helping improve NKriZ's Online Notepad. Because this application handles encrypted notes, credentials, and files, changes should preserve the zero-knowledge storage boundary and avoid introducing plaintext server-side data.

## Development setup

Use Node.js 24 and pnpm 10.12.4. The repository's `.nvmrc` and `packageManager` field pin these versions.

```sh
corepack enable
pnpm install --frozen-lockfile
```

For the complete Docker stack:

```sh
docker compose up --build -d
docker compose logs -f app
```

For native macOS development, follow the setup section in `README.md`. Native Ubuntu deployment instructions are in `docs/deploy-ubuntu.md`.

## Before opening a pull request

Run the same checks as CI:

```sh
pnpm typecheck
pnpm test
pnpm build
docker build -t nkriz-notepad:local .
```

When a change affects storage, authentication, cryptography, uploads, cookies, proxy handling, or origin checks, add focused tests and describe the security impact in the pull request.

## Repository hygiene

- Never commit `.env` files, database dumps, `data/`, recovery keys, passwords, session peppers, or decrypted vault content.
- Keep generated `dist/`, coverage, and dependency directories out of commits.
- Update documentation and environment examples when configuration changes.
- Keep migrations forward-only and safe for existing installations.

## Security reports

Do not open public issues for vulnerabilities or suspected exposure of sensitive data. Follow `SECURITY.md` instead.
