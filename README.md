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
- Navigation, search, documents, and supported image assets are public and read-only. Every create, update, delete, and folder operation requires administrator authentication and CSRF protection.
- `GET /api/navigation` recursively scans `DOCS_ROOT`, includes only Markdown files, sorts folders before documents, and never follows symlink entries.
- Sidebar document labels come from Markdown filenames (without the extension), so changing a document heading does not rename its navigation entry.
- `POST /api/documents`, `PUT /api/document`, and `DELETE /api/document` create, edit, and delete `.md` files only after traversal, extension, parent-directory, and symlink checks.
- `POST /api/folders` creates one folder beneath an existing `DOCS_ROOT` directory after the same traversal and symlink-boundary checks. Empty folders remain visible in navigation.
- New documents may be created only in an existing folder. The application never creates or modifies arbitrary filesystem paths.
- Markdown raw HTML is disabled. Rendered output is sanitized with DOMPurify before it reaches `v-html`.
- Relative Markdown links use Vue Router and images are fetched through the read-only asset API.
- The editor provides heading levels, tables, links, images, ordered/bulleted/task lists, quotes, code blocks, horizontal rules, strike-through, live sanitized preview, word counts, unsaved-change protection, responsive write/preview tabs, publishing, editing, and confirmed deletion.
- Editor shortcuts include `Ctrl+B` for bold, `Ctrl+I` for italic, `Ctrl+K` for links, `Ctrl+S` to save, and `Ctrl+Alt+T` to insert a table.
- Full-text search covers titles, headings, tags, paths, and Markdown body content. Search results are ranked and include a short matching excerpt.
- Documents support up to eight normalized tags. Tags are stored in Markdown frontmatter, shown as compact technical labels, editable in the composer, and available as search-overlay filters.
- Search opens from the centered header control or with `Ctrl+Alt+S`. The command-style overlay blurs the page, supports keyboard result navigation, and keeps the document tree uncluttered.
- The Wikipedia-inspired reader and editor support complete persistent light and dark themes.
- The production Vue application is embedded in the Go executable. A release runs the API and UI from the same address; no separate Node/Vite process is required.
- Vue Router history fallback is handled by Go, so direct links and browser refreshes continue to work.

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

## Standalone release build

Only run release builds on a company-approved development machine, VM, or CI runner. The build creates native executable files and may be blocked by endpoint security on managed laptops.

```powershell
.\scripts\build-release.ps1
```

The script builds Vue directly into `backend/internal/webui/dist`, then embeds those files in `release/atlas-wiki.exe`. Starting that executable serves both the UI and API from `http://localhost:18080`.

The Markdown documents and SQLite database intentionally remain outside the executable because they must stay writable. Package a `docs` directory and configure `DOCS_ROOT` and `APP_DATA_DIR` in a `.env` file beside the deployment, or supply absolute paths through the process environment.

## Current boundary

This is a single-administrator editor, not a multi-user social network. Comments, user registration, revision history, automatic file watching, attachments, and backup scheduling remain outside the current implementation.
