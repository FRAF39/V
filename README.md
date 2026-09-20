# PRIYO CODEX HOST

A Render-ready hosting control panel for HTML/static, Node.js and Python projects.

## Important: Render deployment architecture

The panel itself can run on Render, but a Render web service does not provide a Docker daemon to application code. The old deployment path tried to run `docker build` and `docker run` from inside the panel and therefore failed with the `DOCKER_HOST` executor error.

This version defaults to a safer **Render API deployment mode in production**. Uploaded project files are synchronized into a configured GitHub repository, and the panel creates/updates a dedicated Render web service whose Docker build context is that project directory. Render performs the actual build and container execution.

Render supports Docker services from a Dockerfile and exposes a REST API for creating/updating services and triggering deploys. See the official docs:
- https://render.com/docs/web-services
- https://render.com/docs/docker
- https://render.com/docs/api
- https://api-docs.render.com/reference/create-service

GitHub's Contents API is used to create/update project files in the configured repository. `.github`, `.env`, and Git metadata are deliberately excluded from uploads.

## Required Render environment variables

Set these on the **PRIYO CODEX HOST** Render service:

- `DEPLOYMENT_PROVIDER=render`
- `RENDER_API_KEY` — a Render API key
- `RENDER_OWNER_ID` — your Render workspace/team ID, usually starts with `tea-`
- `DEPLOY_GITHUB_REPO` — repository URL, for example `https://github.com/yourname/priyo-hosting-projects`
- `DEPLOY_GITHUB_BRANCH=main`
- `GITHUB_TOKEN` — a GitHub token with Contents write permission for that repository

The Render workspace must have access to the GitHub repository used for child services. Keep both API tokens as Render secrets and never commit them to Git.

## What happens when a user clicks Deploy

1. The panel reads the uploaded project files.
2. The panel adds a generated `.priyo.Dockerfile` (and an nginx config for HTML projects) under `projects/<project-id>/` in the configured GitHub repo.
3. The panel creates or updates a Render web service for that project.
4. Render builds and runs the project.
5. The deployment URL shown in the panel points to the Render child service.

## Local development

Local development can still use the Docker executor:

```bash
docker compose up --build
```

Set `DEPLOYMENT_PROVIDER=docker` locally if you want to use the original local Docker path.

## Security notes

Do not expose a privileged Docker socket from a public Render web service. If you choose a separate Docker executor instead of Render API mode, keep it isolated and authenticated.
