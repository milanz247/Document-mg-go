# Atlas Wiki

A self-hosted collaborative knowledge base built with Vue and Fastify. Reading is public; named accounts with administrator, editor, or viewer roles control workspace access.

## Features

- Markdown pages with live preview, code highlighting, tables, task lists, tags, backlinks, and broken-link reporting
- Named team accounts with `admin`, `editor`, and `viewer` roles
- Conflict-safe editing, complete page revision history, and recoverable Trash
- Indexed SQLite FTS5 search
- Validated file uploads, CSRF protection, rate-limited sign-in, secure session cookies, and browser security headers
- Responsive navigation, favorites, pinned pages, dark mode, and local draft recovery
- Single-file production bundle, Docker health check, persistent storage, and verified live backups

## Requirements

- Node.js 22.5 or newer (the server uses Node's built-in SQLite module)
- npm

## Production

```powershell
npm.cmd install
npm.cmd run build
npm.cmd start
```

Open <http://127.0.0.1:8000/docs>.

The production application is bundled into `dist/server.cjs`. The writable
database remains separate at `data/atlas.sqlite`, so rebuilding the application
does not overwrite wiki content.

## Docker

The repository includes a multi-stage `Dockerfile`, `compose.yaml`, persistent
`data` and `backups` mounts, a health check, and a verified SQLite backup
command. See [DEPLOYMENT.md](DEPLOYMENT.md) for the complete server deployment,
backup, restore, and update procedure.

Create a local backup with:

```powershell
npm.cmd run backup
```

## Development

Run these in separate terminals:

```powershell
npm.cmd run dev:server
npm.cmd run dev:client
```

Vite proxies `/api` requests to Fastify during development.

## Configuration

Settings can be changed in `.env`:

- `HOST` defaults to `127.0.0.1`
- `PORT` defaults to `8000`
- `DATABASE_PATH` defaults to `./data/atlas.sqlite`
- `LOG_LEVEL` defaults to `warn`
- `ADMIN_USERNAME` initializes the first administrator username and defaults to `admin`
- `ADMIN_PASSWORD` initializes the first administrator password and must contain at least 12 characters; startup fails when it is missing
- `SESSION_DURATION_HOURS` defaults to `12`
- `COOKIE_SECURE` should be `true` when the application is served through HTTPS

Passwords are stored only as salted scrypt hashes. Changing `ADMIN_PASSWORD` after the first startup does not replace the database credential. Administrators can create named team accounts from **Settings**. Deleted pages can be restored there, and editors can restore earlier versions from the editor's **History** dialog.

This release remains a shared knowledge workspace rather than a multi-tenant SaaS. Organizations requiring private per-customer workspaces, offline sync, or simultaneous cursor-level co-editing should add those capabilities before offering untrusted public sign-up. See [SECURITY.md](SECURITY.md) and [ROADMAP.md](ROADMAP.md).
The default host keeps the server local to this computer.
