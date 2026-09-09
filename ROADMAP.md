# Atlas Wiki roadmap

The current release is a production-oriented shared workspace. It intentionally remains a modular monolith so a small team can operate it safely.

## Included now

- Named accounts and administrator/editor/viewer roles
- Server autosave, local draft recovery, stale-edit conflict detection, revisions, restore, and Trash
- Markdown editing, files, tags, indexed search, backlinks, folders, favorites, and pinned pages
- Legacy database migration, Docker deployment, security headers, upload validation, and verified backups

## Before open public registration

- Tenant-scoped workspaces with notebook membership and page-level sharing policy
- PostgreSQL migrations and object storage for uploads
- Email verification, password-reset tokens, optional MFA, account lockout, and abuse controls
- Shared rate limits/session storage for multiple API instances
- Malware scanning, storage quotas, audit-event retention, privacy export/deletion, terms, and moderation workflows
- Metrics, tracing, error reporting, restore drills, and an independent security review

## OneNote-class experience

- Structured block editor with notebooks, sections, pages, and subpages
- WebSocket collaboration using a CRDT such as Yjs
- Offline-first PWA storage, reconnect merging, and sync status
- Comments, mentions, notifications, templates, reminders, and granular share links
- Drawing/ink, OCR, audio notes, mobile applications, importers, and export to PDF/Markdown

These items should not be added as disconnected features. Tenant isolation and durable identity come before sharing; revisioned structured content comes before CRDT collaboration; object storage and quotas come before large media or audio.
