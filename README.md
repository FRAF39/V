# PRIYO CODEX HOST — Professional Render Edition

A professional hosting control panel designed to run as a Render Web Service.

## Authentication

The panel has one primary administrator identity configured by:

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`

On startup the administrator account is created or synchronized to these values. Users created from the admin console remain separate member accounts.

The panel never asks for a Render dashboard username/password. Render API access is server-side only through `RENDER_API_KEY` and `RENDER_OWNER_ID`.

## Render deployment

Configure:

```env
DATABASE_URL=...
SESSION_SECRET=...
ADMIN_USERNAME=admin
ADMIN_PASSWORD=use-a-long-random-password
RENDER_API_KEY=...
RENDER_OWNER_ID=...
DEPLOY_GITHUB_REPO=https://github.com/OWNER/REPOSITORY
DEPLOY_GITHUB_BRANCH=main
GITHUB_TOKEN=...
RENDER_REGION=oregon
RENDER_PLAN=free
```

Render API keys are secrets and must not be committed to source control.

## Features

- Admin-first panel authentication
- Project creation, upload, source-stack detection and deployment
- Source technology/evidence detection from project manifests and files
- Project deletion with remote Render service cleanup
- Deployment stop/delete/logs
- Storage and project quotas
- Member account management
- Render connection status without exposing credentials
- PostgreSQL-backed sessions and data
- Security headers, rate limiting and Argon2 password hashing
