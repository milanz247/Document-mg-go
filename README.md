# Fastify Atlas Wiki

A Vue wiki served by Fastify, with password-protected editing and persistent SQLite storage.

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
- `ADMIN_PASSWORD` initializes the editing password on the first startup and must contain at least 12 characters
- `SESSION_DURATION_HOURS` defaults to `12`
- `COOKIE_SECURE` should be `true` when the application is served through HTTPS

Reading is public, while editing and every write API require an unlocked session.
The initial password is stored only as a scrypt hash in SQLite; changing
`ADMIN_PASSWORD` after the first startup does not replace the stored password.
Replace the placeholder value in `.env` with your previous password before the
first authenticated startup.
The default host keeps the server local to this computer.
