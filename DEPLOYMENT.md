# Docker deployment

Atlas Wiki stores all documents, folders, uploaded assets, the editing password
hash, and sessions in one SQLite database. There is no separate Markdown
`docs` directory in this version.

## Persistent paths

| Host path | Container path | Purpose |
| --- | --- | --- |
| `./data` | `/app/data` | Live `atlas.sqlite` database and SQLite WAL files |
| `./backups` | `/app/backups` | Verified point-in-time SQLite backup files |

These are bind mounts, so rebuilding, updating, or deleting the application
container does not delete the wiki data. Docker bind mounts expose host
directories directly inside the container.

## First deployment

Install Docker Engine with the Compose plugin on the server, copy this project
to a directory such as `/opt/atlas-wiki`, and then run:

```bash
cd /opt/atlas-wiki
mkdir -p data backups
sudo chown -R 1000:1000 data backups
```

Edit `.env` before the first start. At minimum, replace the placeholder with a
private password of at least 12 characters:

```dotenv
ADMIN_PASSWORD=use-a-long-private-password-here
COOKIE_SECURE=false
```

Then build and start the container:

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 atlas-wiki
```

The default published address is `127.0.0.1:8000`, suitable for an HTTPS
reverse proxy on the same server. To expose the port directly, add these values
to `.env` and restart the Compose project:

```dotenv
PUBLISH_ADDRESS=0.0.0.0
PUBLISH_PORT=8000
```

Direct public exposure is not recommended. Prefer Caddy, Nginx, or another
reverse proxy with HTTPS. When HTTPS is active, set `COOKIE_SECURE=true`.

## Create a safe backup

Do not copy only `data/atlas.sqlite` while the application is running. SQLite
uses WAL mode, so recently committed data may still be in the `-wal` file.
Instead run:

```bash
docker compose exec -T atlas-wiki node scripts/backup.mjs
ls -lh backups
```

The command uses `VACUUM INTO` to create a consistent live snapshot and then
runs `PRAGMA integrity_check`. The resulting file appears on the host as:

```text
backups/atlas_YYYY-MM-DD_HH-MM-SS.sss.sqlite
```

An example daily cron entry at 02:15 is:

```cron
15 2 * * * cd /opt/atlas-wiki && /usr/bin/docker compose exec -T atlas-wiki node scripts/backup.mjs >> /var/log/atlas-wiki-backup.log 2>&1
```

Copy the generated files to a second machine or object-storage service. A
backup stored only on the same server does not protect against disk failure.

## Restore a backup

Create one final verified backup first, stop the application, and replace the
database while it is offline:

```bash
cd /opt/atlas-wiki
docker compose exec -T atlas-wiki node scripts/backup.mjs
docker compose down
cp backups/atlas_YYYY-MM-DD_HH-MM-SS.sss.sqlite data/atlas.sqlite
rm -f data/atlas.sqlite-wal data/atlas.sqlite-shm
sudo chown -R 1000:1000 data backups
docker compose up -d
```

Use the exact backup filename produced by the backup command. Check `/docs`,
search, and editing after the restore.

## Update the application

Back up first, then rebuild the image. The mounted database remains unchanged:

```bash
docker compose exec -T atlas-wiki node scripts/backup.mjs
docker compose build --pull
docker compose up -d
docker compose ps
```

Never run `docker compose down -v` as part of a data migration without checking
the active storage configuration. This Compose file uses bind mounts, but `-v`
can remove other named volumes added later.
