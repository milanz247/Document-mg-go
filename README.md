# Atlas Wiki

Atlas Wiki is a public read-only Markdown knowledge base with a private single-administrator editor. Documents remain ordinary files under `DOCS_ROOT`; the authenticated web editor creates, updates, and deletes those files directly. SQLite contains only the administrator and sessions—never Markdown content.

## Project structure

```text
.
├── .gitignore
├── README.md
├── backend/
│   ├── .env.example
│   ├── cmd/
│   │   └── server/main.go                 # process startup and graceful shutdown
│   ├── internal/
│   │   ├── auth/                           # bcrypt admin, SQLite sessions, unlock limiter
│   │   ├── config/config.go               # DOCS_ROOT and server configuration
│   │   ├── documents/
│   │   │   ├── service.go                 # scan, read, create, update, and delete
│   │   │   ├── service_test.go
│   │   │   └── types.go                   # navigation and document API shapes
│   │   ├── filesystem/
│   │   │   ├── root.go                    # traversal and symlink-safe resolver
│   │   │   └── root_test.go
│   │   └── server/server.go               # HTTP routes, errors, and middleware
│   └── go.mod
├── frontend/
│   ├── src/
│   │   ├── api/client.ts                  # typed API client
│   │   ├── components/
│   │   │   ├── auth/UnlockEditingDialog.vue # password-only editing unlock modal
│   │   │   ├── document/DocumentToolbar.vue # location and document actions
│   │   │   ├── layout/AppHeader.vue       # sticky application header
│   │   │   ├── markdown/MarkdownRenderer.vue
│   │   │   └── navigation/
│   │   │       ├── AppSidebar.vue         # responsive navigation shell
│   │   │       └── SidebarNode.vue        # recursive folder/page node
│   │   ├── layouts/DocumentationLayout.vue
│   │   ├── pages/
│   │   │   ├── DocumentPage.vue
│   │   │   ├── EditorPage.vue             # Markdown composer and live preview
│   │   │   └── NotFoundPage.vue
│   │   ├── router/index.ts                # history routes for documents
│   │   ├── stores/
│   │   │   ├── auth.ts                    # authenticated admin state
│   │   │   ├── documents.ts               # navigation state
│   │   │   └── theme.ts                   # persistent light/dark theme
│   │   ├── styles/main.css                # Tailwind and reading typography
│   │   ├── types/documents.ts             # frontend API data shapes
│   │   ├── utils/
│   │   │   ├── markdown.ts                # safe rendering and highlighting
│   │   │   └── routes.ts                  # link and asset path transforms
│   │   ├── App.vue
│   │   ├── env.d.ts
│   │   └── main.ts
│   ├── index.html
│   ├── package.json
│   ├── package-lock.json
│   ├── postcss.config.js
│   ├── tailwind.config.js
│   ├── tsconfig.app.json
│   ├── tsconfig.json
│   ├── tsconfig.node.json
│   └── vite.config.ts                     # dev API proxy
└── docs/
    ├── index.md
    ├── DevOps/docker.md
    └── Linux/
        ├── nginx.md
        ├── systemd.md
        └── images/nginx-flow.svg
```

## Important behavior

- The editing secret is created from `ADMIN_PASSWORD` on first startup and is stored only as a bcrypt hash.
- Editing unlock uses expiring server-side SQLite sessions and an HttpOnly, SameSite=Strict cookie. Mutations require a per-session CSRF header, and repeated failed password attempts are rate-limited.
- Navigation, search, documents, link insights, and supported assets are public and read-only. Every create, update, delete, move, upload, and folder operation requires administrator authentication and CSRF protection.
- `GET /api/navigation` recursively scans `DOCS_ROOT`, includes only Markdown files, sorts folders before documents, and never follows symlink entries.
- Sidebar document labels come from Markdown filenames (without the extension), so changing a document heading does not rename its navigation entry.
- `POST /api/documents`, `PUT /api/document`, and `DELETE /api/document` create, edit, and delete `.md` files only after traversal, extension, parent-directory, and symlink checks.
- `POST /api/folders` creates one folder beneath an existing `DOCS_ROOT` directory after the same traversal and symlink-boundary checks. Empty folders remain visible in navigation.
- `DELETE /api/folder` removes authenticated administrator-selected folders only when they are completely empty. Folders containing Markdown, other files, or nested folders are never deleted.
- `POST /api/move` safely renames or moves documents and folders while keeping every target beneath `DOCS_ROOT`; existing destinations are never overwritten.
- `POST /api/assets/upload` stores approved files up to 10 MiB in an `assets` folder beside the current document and returns the Markdown to insert. The editor supports file selection and drag-and-drop.
- New documents may be created only in an existing folder. The application never creates or modifies arbitrary filesystem paths.
- Markdown raw HTML is disabled. Rendered output is sanitized with DOMPurify before it reaches `v-html`.
- Relative Markdown links use Vue Router and images are fetched through the read-only asset API.
- The editor provides heading levels, tables, links, uploads, ordered/bulleted/task lists, quotes, code blocks, horizontal rules, strike-through, live sanitized preview, word counts, browser autosave/recovery, responsive write/preview tabs, publishing, editing, and confirmed deletion.
- Editor shortcuts include `Ctrl+B` for bold, `Ctrl+I` for italic, `Ctrl+K` for links, `Ctrl+S` to save, and `Ctrl+Alt+T` to insert a table.
- Full-text search covers titles, headings, tags, paths, and Markdown body content. Search results are ranked and include a short matching excerpt.
- Documents support up to eight normalized tags. Tags are stored in Markdown frontmatter, shown as compact technical labels, editable in the composer, and available as search-overlay filters.
- Search opens from the centered header control or with `Ctrl+Alt+S`. The command-style overlay blurs the page, supports keyboard result navigation, and keeps the document tree uncluttered.
- `Ctrl+K` opens a command palette outside text fields for page navigation, search, editing, and create actions. Inside the Markdown editor, `Ctrl+K` remains the insert-link shortcut.
- The reader builds a right-side table of contents from headings and reports backlinks and missing local Markdown/asset references.
- Favorites and custom pins are private browser preferences stored in local storage. Pinned items appear before alphabetical items, and saved paths follow successful move/rename operations.
- The Wikipedia-inspired reader and editor support complete persistent light and dark themes.
- The production Vue application is embedded in the Go executable. A release runs the API and UI from the same address; no separate Node/Vite process is required.
- Vue Router history fallback is handled by Go, so direct links and browser refreshes continue to work.
- When `index.md` is absent, `/docs` shows a compact local welcome screen and library counts instead of a 404 response.

## Run the backend

Prerequisite: Go 1.24 or newer.

From the repository root:

```powershell
cd backend
$env:ADMIN_PASSWORD = "choose-a-password-with-12-or-more-characters"
go run ./cmd/server
```

On the first run, Atlas creates `../data/atlas.db` and stores the administrator password hash. On later runs, `ADMIN_PASSWORD` may be omitted. Local `.env` values are loaded automatically, but existing process environment variables take precedence.

The API listens on `http://localhost:18080`. Check it with:

```powershell
Invoke-RestMethod http://localhost:18080/api/health
```

For HTTPS deployment, set `COOKIE_SECURE=true`. It must remain `false` for local HTTP development.

## Run the frontend

Prerequisite: Node.js 22.12 or newer and npm.

In a second terminal, from the repository root:

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` to the Go server, so no development CORS configuration is necessary.

## Create and edit documents

Readers can open `http://localhost:5173/docs` without signing in. Clicking **Edit** opens a password-only security modal; the correct administrator password unlocks that document's editor and all management controls for the session. Without an unlocked session, create, update, delete, and folder requests are rejected. Once editing is unlocked, use **New page** to open the composer, enter a path inside an existing folder such as `Networking/dns.md`, write Markdown, check the live preview, and publish. Every save is immediately written to the corresponding filesystem file.

The filesystem remains interoperable. You may still add a document manually:

Create a Markdown file anywhere under `docs`, for example:

```powershell
New-Item -ItemType Directory -Force docs/Networking
Set-Content docs/Networking/dns.md "# DNS`n`nA new filesystem-backed page."
```

Use the refresh icon or reload the browser after external filesystem changes. Web-editor mutations refresh navigation automatically.

Create folders with the folder-plus action in the application header or the **New folder** control beside the new-document path. Folder paths are relative to `DOCS_ROOT`, for example `Engineering/Runbooks`, and the immediate parent must already exist.

## Document metadata and tags

Tags remain portable because they are stored at the beginning of each Markdown file rather than only in SQLite:

```markdown
---
title: Database Recovery Runbook
tags:
  - postgresql
  - disaster-recovery
---

# Recovery procedure

Restore the latest verified backup.
```

The `title` field is optional; the first level-one heading or filename is used when it is omitted. Tag names are normalized to lowercase slugs, duplicates are removed, and each document can contain up to eight tags of 32 characters each. Existing unrelated frontmatter fields are preserved when tags are edited through the web UI.

## Production deployment

Atlas Wiki is deployed as one executable containing both the Go API and the compiled Vue UI. The following items deliberately remain outside the executable:

- `docs/` contains the writable Markdown documents and uploaded assets.
- `data/atlas.db` contains the administrator password hash and active sessions.
- `.env` contains deployment-specific paths and security settings.

Do not manually edit files such as `backend/internal/webui/dist/assets/index-*.js`. They are generated by the frontend build and embedded automatically when the Go executable is compiled.

### 1. Build a Windows release

Only build on a company-approved development machine, VM, or CI runner. Native executable creation may be blocked by endpoint-security software on managed laptops.

Prerequisites:

- Go 1.24 or newer.
- Node.js 22.12 or newer and npm.
- A clean checkout containing both `frontend/` and `backend/`.

From the repository root, run:

```powershell
.\scripts\build-release.ps1
```

The script performs these operations in order:

1. Runs `npm ci` inside `frontend/`.
2. Builds Vue into `backend/internal/webui/dist`.
3. Compiles Go after the new UI exists, allowing `go:embed` to include it.
4. Creates `release/atlas-wiki.exe`.

Optionally record a checksum before uploading the release:

```powershell
Get-FileHash .\release\atlas-wiki.exe -Algorithm SHA256
```

### 2. Build a Linux release

On an approved Linux build machine or CI runner:

```bash
mkdir -p release
(cd frontend && npm ci && npm run build)
(cd backend && go build -trimpath -ldflags="-s -w" -o ../release/atlas-wiki ./cmd/server)
sha256sum release/atlas-wiki
```

Do not compile Go before the Vue build. Otherwise, the executable will contain the previous embedded UI.

### 3. Prepare the production directory

A Windows deployment can use:

```text
C:\Apps\AtlasWiki\
|-- atlas-wiki.exe
|-- .env
|-- docs\
`-- data\
```

A Linux deployment can use:

```text
/opt/atlas-wiki/
|-- atlas-wiki
|-- .env
|-- docs/
`-- data/
```

Copy only the new executable when updating an existing installation. Do not replace the production `.env`, `docs/`, or `data/` directories with release artifacts.

The operating-system account running Atlas Wiki needs:

- read and execute access to the executable;
- read/write/create/rename access to `docs/` because the web editor changes documents and assets;
- read/write/create access to `data/` because SQLite writes the authentication database and WAL files;
- read-only access to `.env`.

### 4. Create the production `.env`

Place `.env` beside the executable and start the process with that directory as its working directory:

```dotenv
DOCS_ROOT=./docs
APP_DATA_DIR=./data
SERVER_ADDRESS=127.0.0.1:18080
ADMIN_PASSWORD=replace-with-a-unique-password-of-at-least-12-characters
SESSION_DURATION=12h
COOKIE_SECURE=true
```

Production notes:

- `ADMIN_PASSWORD` is used only when `data/atlas.db` has no administrator yet. Later changes to this environment value do not replace the password already stored in SQLite. Store the password in the organization's password manager; after the first successful startup, it may be removed from `.env` because subsequent unlocks use the bcrypt hash in SQLite.
- Keep `.env`, `data/`, and private documentation out of Git. The repository `.gitignore` already excludes `.env` and `data/`.
- Use `COOKIE_SECURE=true` when users access the site through HTTPS. Secure cookies will not work through plain HTTP.
- Binding to `127.0.0.1:18080` keeps the application private behind a reverse proxy. Do not expose port `18080` publicly in this configuration.
- If the executable is intentionally served directly over a trusted local HTTP network, use `COOKIE_SECURE=false` and an appropriate `SERVER_ADDRESS`, but this is not the recommended Internet-facing production setup.

### 5. Validate the executable before installing it as a service

Windows:

```powershell
Set-Location C:\Apps\AtlasWiki
.\atlas-wiki.exe
```

Linux:

```bash
cd /opt/atlas-wiki
./atlas-wiki
```

From another terminal on the same server, verify the health endpoint:

```powershell
Invoke-RestMethod http://127.0.0.1:18080/api/health
```

The expected response contains `status: ok`. Stop the foreground validation process before configuring the permanent service.

### 6. Run continuously as a service

On Windows Server, use an organization-approved Windows service wrapper or process supervisor. Configure it with:

- executable: `C:\Apps\AtlasWiki\atlas-wiki.exe`;
- startup/working directory: `C:\Apps\AtlasWiki`;
- automatic restart after failure;
- a dedicated low-privilege service account with write access only to `docs\` and `data\`;
- stdout and stderr redirected to the organization's log location.

Do not register the executable directly with `sc.exe`; this executable is a normal console process and does not implement the native Windows Service Control Manager protocol.

For Linux, create `/etc/systemd/system/atlas-wiki.service`:

```ini
[Unit]
Description=Atlas Wiki documentation service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=atlaswiki
Group=atlaswiki
WorkingDirectory=/opt/atlas-wiki
ExecStart=/opt/atlas-wiki/atlas-wiki
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/atlas-wiki/docs /opt/atlas-wiki/data

[Install]
WantedBy=multi-user.target
```

Then reload systemd and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now atlas-wiki
sudo systemctl status atlas-wiki
journalctl -u atlas-wiki -f
```

### 7. Add HTTPS and a reverse proxy

Terminate HTTPS at the organization's load balancer, ingress controller, IIS, Nginx, Apache, or another approved reverse proxy. The proxy must:

- forward requests to `http://127.0.0.1:18080`;
- preserve the original `Host` header;
- pass the original client/protocol headers required by the surrounding infrastructure;
- allow request bodies of at least 11 MiB for the 10 MiB application upload limit;
- serve a valid HTTPS certificate;
- expose only ports `80` and `443` through the public firewall.

A minimal Nginx location block is:

```nginx
client_max_body_size 11m;

location / {
    proxy_pass http://127.0.0.1:18080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

TLS certificate paths and the outer `server` block depend on the production environment and should follow the organization's standard HTTPS configuration.

### 8. Upload and manage documents

The recommended method is to unlock editing in the web UI and use **New folder**, **New page**, edit, move/rename, and upload actions. These operations enforce the application's path and file-type protections.

For a bulk import, copy the existing folder hierarchy into the configured production `docs/` directory. Every page must use the `.md` extension. Keep relative images and files beside the relevant document or inside its `assets/` directory.

Windows example:

```powershell
robocopy .\docs C:\Apps\AtlasWiki\docs /E
```

Linux example:

```bash
rsync -av ./docs/ deploy-user@wiki-server:/opt/atlas-wiki/docs/
```

Back up the destination before allowing a bulk copy to overwrite same-named files. A documentation-only change does not require rebuilding or restarting Atlas Wiki. Reload the page or use the application refresh control after external filesystem changes.

### 9. Deploy an application update

Use this order to avoid losing production content:

1. Build a new executable on the approved build machine or CI runner.
2. Verify its SHA-256 checksum after transfer.
3. Back up `.env`, `docs/`, and `data/`.
4. Stop the Atlas Wiki service.
5. Replace only `atlas-wiki.exe` or `atlas-wiki`.
6. Start the service.
7. Check `/api/health`, open `/docs`, test search, and confirm that editing can be unlocked.
8. Keep the previous executable until the release has been verified.

If the new release fails, stop the service, restore the previous executable, and start the service again. Normally, `docs/` and `data/` should not be rolled back with the executable unless the release specifically changed their format.

### 10. Back up production data

Back up both `docs/` and `data/`. Stop the service before making a filesystem copy of `data/` so the SQLite database and its WAL files form a consistent set. The documentation remains ordinary Markdown and can also be mirrored to a private, access-controlled Git repository if company policy permits.

### 11. Push source code to GitHub

Review changes before committing. Avoid `git add .` when production or private documents exist in the working tree.

```powershell
git status
git add README.md backend frontend scripts
git commit -m "Add document management and production deployment features"
git push origin main
```

Only add `docs/` separately when those documents are intentionally allowed in the GitHub repository. Never commit `.env`, database files, administrator passwords, or production backups.

### Production checklist

- The health endpoint returns `status: ok`.
- `/docs` loads through the public HTTPS address.
- `COOKIE_SECURE=true` is enabled for HTTPS.
- Port `18080` is reachable only from the reverse proxy or local host.
- The service account can modify only the required `docs/` and `data/` directories.
- `.env`, `data/`, and private documents are not publicly committed.
- Automated backups cover both Markdown content and SQLite data.
- A previous executable is available for rollback.

## Current boundary

This is a single-administrator editor, not a multi-user social network. Comments, user registration, revision history, automatic file watching, and backup scheduling remain outside the current implementation.
