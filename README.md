# PRIYO CODEX HOST — Professional Render Hosting Panel

This edition uses a server-side Render API integration. The panel login is controlled by `ADMIN_USERNAME` and `ADMIN_PASSWORD`; it does not ask users for a Render username/password.

## Render environment variables

Required:
- `DATABASE_URL`
- `SESSION_SECRET`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `RENDER_API_KEY`
- `RENDER_OWNER_ID`
- `DEPLOY_GITHUB_REPO`

Optional:
- `DEPLOY_GITHUB_BRANCH` (default `main`)
- `GITHUB_TOKEN`
- `RENDER_REGION` (default `oregon`)
- `RENDER_PLAN` (default `free`)
- `PUBLIC_BASE_URL`

## Important deployment flow

1. A project is created in the panel.
2. Project files are stored under the project's private storage directory.
3. Deploy syncs the current project files to `projects/<project-id>/` in the configured GitHub repository.
4. The panel creates or reuses a Render service through the Render REST API.
5. The Render service builds/deploys the project from that repository path.

The panel does **not** require a Docker daemon or `DOCKER_HOST`.

## Delete behavior

Deleting a project removes its managed Render service when one exists, then removes the local project files and database records. A missing Render service (404) is treated as already deleted. Other remote deletion errors are surfaced to the UI instead of being hidden.

## Source stack

Project details scan the actual uploaded files and manifests and display detected technologies such as Node.js, Python, React, Vite, Next.js, Express, Vue, Angular, Svelte, TypeScript, PHP, Go, Rust and Ruby.
