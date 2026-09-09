# Security and public-release notes

Atlas Wiki is designed for a trusted team sharing one workspace. Reading is public by design. Do not store private information unless public reads are disabled and a per-page or per-workspace authorization model is added.

## Deployment checklist

1. Set a unique `ADMIN_PASSWORD` of at least 12 characters and keep `.env` out of version control.
2. Serve the application behind an HTTPS reverse proxy and set `COOKIE_SECURE=true`.
3. Keep the default published address (`127.0.0.1`) when the reverse proxy runs on the same host.
4. Create one named account per person and give the minimum required role.
5. Run verified backups daily and copy them to another machine or object store.
6. Run `npm audit`, the test suite, and the type checker before every deployment.
7. Set request-size and connection-rate limits at the reverse proxy.

## Current trust boundary

- Administrators can manage accounts and permanently empty Trash.
- Editors can change content, restore page revisions, and restore Trash.
- Viewers can sign in but cannot use write APIs.
- Anonymous visitors can read all live pages and assets.
- Uploaded SVG is rejected. Other accepted files are signature/content checked, and non-image downloads use attachment disposition.

For an open-registration SaaS, migrate content to tenant-scoped PostgreSQL tables, store uploads in isolated object storage, add verified email/password reset and MFA, use a shared rate-limit store, scan uploads, add audit retention and privacy deletion workflows, and commission an independent security review.
