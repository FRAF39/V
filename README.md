# PRIYO_CODEX HOST — Professional Edition

A production-oriented hosting control panel for project files, source-stack detection, deployments, quotas and account management.

## What is included

- Responsive professional dashboard with light/dark mode
- Project creation, upload, deploy and **delete project** actions
- File manager with project selection and file metadata
- **Source Stack** detection from the project's real files/manifests (Node.js, Python, React, Vite, Next.js, Express, PHP, Go, Rust, Ruby, TypeScript, etc.)
- Deployment history and logs
- User quotas and runtime permissions
- Admin user management
- PostgreSQL-backed sessions and project metadata
- Render-managed deployment path; the web panel does not require a Docker daemon or `DOCKER_HOST`

## Render-managed deployment architecture

The panel runs as a normal Render web service. When a user deploys a project, the panel:

1. Reads the project's uploaded source.
2. Syncs the project into the configured GitHub repository under `projects/<project-id>/`.
3. Creates or redeploys a Render service pointing at that project directory.
4. Stores the Render service ID and public URL in the deployment record.
5. Deletes/suspends the managed Render service when the deployment/project is removed.

This avoids trying to run Docker containers inside the panel's Render web service.

## Required production environment variables

```text
DATABASE_URL
SESSION_SECRET
ADMIN_USERNAME
ADMIN_PASSWORD
PUBLIC_BASE_URL
RENDER_API_KEY
RENDER_OWNER_ID
DEPLOY_GITHUB_REPO
DEPLOY_GITHUB_BRANCH=main
GITHUB_TOKEN
RENDER_REGION=oregon
RENDER_PLAN=free
```

`RENDER_API_KEY` and `GITHUB_TOKEN` are secrets. Never commit them to GitHub. Render API requests use bearer authentication, and Render documents API keys as secret credentials. The Render API supports programmatic service creation, deploys, suspension and deletion.

Render supports native Node.js and Python runtimes as well as Docker-based services. Web services must listen on `0.0.0.0` and normally use the `PORT` environment variable.

## GitHub repository requirements

Create a repository for deployed project source and give the configured token permission to write repository contents. The panel creates a separate directory for each hosted project, so multiple projects can share the same repository while Render uses each project's `rootDir`.

## Local development

```bash
docker compose up --build
```

Open `http://localhost:8080`.

For local-only Docker deployment experiments, the included compose setup can still be used. Production deployment should use the managed Render/GitHub path above.

## Production checklist

- Use a long random `SESSION_SECRET`
- Use strong admin credentials
- Store Render and GitHub credentials only in environment variables/secrets
- Use HTTPS
- Set `PUBLIC_BASE_URL` to the real panel URL
- Configure a persistent/durable storage strategy for large user uploads if required
- Keep deployment quotas and runtime permissions enabled
