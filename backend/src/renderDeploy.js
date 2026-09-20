import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { q } from "./db.js";
import { config } from "./config.js";

const GITHUB_API = "https://api.github.com";
const RENDER_API = "https://api.render.com/v1";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for Render deployment mode.`);
  return value;
}

function githubConfig() {
  const repoUrl = required("DEPLOY_GITHUB_REPO").replace(/\.git$/, "").replace(/\/$/, "");
  const m = repoUrl.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)$/i);
  if (!m) throw new Error("DEPLOY_GITHUB_REPO must look like https://github.com/OWNER/REPO");
  return { repoUrl, owner: m[1], repo: m[2], token: required("GITHUB_TOKEN"), branch: process.env.DEPLOY_GITHUB_BRANCH || "main" };
}

function renderHeaders() {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${required("RENDER_API_KEY")}`,
  };
}

async function jsonRequest(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!res.ok) {
    const message = body?.message || body?.error?.message || body?.raw || `HTTP ${res.status}`;
    throw new Error(`${res.status}: ${message}`);
  }
  return body;
}

async function githubRequest(cfg, method, apiPath, body) {
  return jsonRequest(`${GITHUB_API}${apiPath}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${cfg.token}`,
      "X-GitHub-Api-Version": "2026-03-10",
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function safeName(value) {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 38) || "project";
}

function qjson(command) {
  return JSON.stringify(command);
}

function dockerFiles(runtime, buildCommand, startCommand) {
  if (runtime === "html") {
    return {
      dockerfile: [
        "FROM nginx:1.27-alpine",
        "COPY . /usr/share/nginx/html",
        "COPY .priyo-nginx.conf /etc/nginx/conf.d/default.conf",
        "EXPOSE 10000",
        'CMD ["nginx","-g","daemon off;"]',
        "",
      ].join("\n"),
      nginx: [
        "server {",
        "  listen 10000;",
        "  server_name _;",
        "  root /usr/share/nginx/html;",
        "  index index.html;",
        "  location / { try_files $uri $uri/ /index.html; }",
        "}",
        "",
      ].join("\n"),
    };
  }

  const base = runtime === "node" ? "node:22-alpine" : "python:3.12-slim";
  const install = runtime === "node"
    ? [
        "COPY package*.json ./",
        "RUN npm ci --omit=dev || npm install --omit=dev",
      ]
    : [
        "COPY requirements.txt* ./",
        "RUN if [ -f requirements.txt ]; then pip install --no-cache-dir -r requirements.txt; fi",
      ];
  const defaultStart = runtime === "node"
    ? "npm start"
    : "python -m flask run --host=0.0.0.0 --port=${PORT:-10000}";
  const start = startCommand || defaultStart;
  const lines = [
    `FROM ${base}`,
    "WORKDIR /app",
    ...install,
  ];
  lines.push("COPY . .");
  if (buildCommand) lines.push(`RUN ${qjson(["/bin/sh", "-lc", buildCommand])}`);
  lines.push(
    "EXPOSE 10000",
    `CMD ${qjson(["/bin/sh", "-lc", start])}`,
    "",
  );
  return { dockerfile: lines.join("\n") };
}

async function walkFiles(dir) {
  const out = [];
  async function walk(current, rel = "") {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === ".github" || entry.name === ".priyo.Dockerfile" || entry.name === ".env" || entry.name.startsWith(".env.")) continue;
      const abs = path.join(current, entry.name);
      const next = rel ? path.posix.join(rel, entry.name) : entry.name;
      if (entry.isDirectory()) await walk(abs, next);
      else if (entry.isFile()) out.push({ abs, rel: next });
    }
  }
  await walk(dir);
  return out;
}

async function getFileSha(cfg, repoPath) {
  try {
    const data = await githubRequest(cfg, "GET", `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${repoPath}?ref=${encodeURIComponent(cfg.branch)}`);
    return data.sha;
  } catch (e) {
    if (String(e.message).startsWith("404:")) return null;
    throw e;
  }
}

async function putFile(cfg, repoPath, buffer, message) {
  const sha = await getFileSha(cfg, repoPath);
  const body = { message, content: buffer.toString("base64"), branch: cfg.branch };
  if (sha) body.sha = sha;
  await githubRequest(cfg, "PUT", `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${repoPath}`, body);
}

async function syncProject(cfg, work, prefix, generated) {
  const files = await walkFiles(work);
  files.push({ abs: null, rel: ".priyo.Dockerfile", buffer: Buffer.from(generated.dockerfile) });
  if (generated.nginx) files.push({ abs: null, rel: ".priyo-nginx.conf", buffer: Buffer.from(generated.nginx) });
  const message = `Deploy project ${prefix.split("/").pop()}`;
  for (const file of files) {
    const buffer = file.buffer || await fs.readFile(file.abs);
    const repoPath = `${prefix}/${file.rel}`.replace(/^\/+/, "");
    await putFile(cfg, repoPath, buffer, message);
  }
  return files.length;
}

async function listServices(ownerId) {
  const url = `${RENDER_API}/services?ownerId=${encodeURIComponent(ownerId)}&limit=100`;
  const data = await jsonRequest(url, { headers: renderHeaders() });
  return Array.isArray(data) ? data.map(x => x.service || x) : [];
}

async function createOrUpdateService({ serviceId, name, cfg, prefix, runtime, startCommand }) {
  const ownerId = required("RENDER_OWNER_ID");
  const dockerCommand = startCommand || (runtime === "html" ? "nginx -g 'daemon off;'" : runtime === "node" ? "npm start" : "python -m flask run --host=0.0.0.0 --port=$PORT");
  const serviceDetails = {
    runtime: "docker",
    envSpecificDetails: {
      dockerCommand,
      dockerContext: prefix,
      dockerfilePath: `${prefix}/.priyo.Dockerfile`,
    },
    plan: process.env.RENDER_PROJECT_PLAN || "free",
    region: process.env.RENDER_PROJECT_REGION || "oregon",
    healthCheckPath: "/",
    numInstances: 1,
  };
  const common = {
    repo: cfg.repoUrl,
    ownerId,
    branch: cfg.branch,
    autoDeploy: "no",
    rootDir: prefix,
    serviceDetails,
  };

  if (!serviceId) {
    const created = await jsonRequest(`${RENDER_API}/services`, {
      method: "POST",
      headers: renderHeaders(),
      body: JSON.stringify({ type: "web_service", name, ...common }),
    });
    return { service: created.service || created, deployId: created.deployId };
  }

  const updated = await jsonRequest(`${RENDER_API}/services/${encodeURIComponent(serviceId)}`, {
    method: "PATCH",
    headers: renderHeaders(),
    body: JSON.stringify({ repo: cfg.repoUrl, branch: cfg.branch, rootDir: prefix, serviceDetails }),
  });
  const deploy = await jsonRequest(`${RENDER_API}/services/${encodeURIComponent(serviceId)}/deploys`, {
    method: "POST",
    headers: renderHeaders(),
    body: JSON.stringify({ clearCache: "do_not_clear" }),
  });
  return { service: updated.service || updated, deployId: deploy.id };
}

async function waitForDeploy(serviceId, deployId, timeoutMs = 15 * 60 * 1000) {
  if (!deployId) return;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const d = await jsonRequest(`${RENDER_API}/services/${encodeURIComponent(serviceId)}/deploys/${encodeURIComponent(deployId)}`, { headers: renderHeaders() });
    const status = d.status;
    if (["live"].includes(status)) return d;
    if (["build_failed", "update_failed", "canceled", "deactivated"].includes(status)) throw new Error(`Render deploy ${status}`);
    await new Promise(r => setTimeout(r, 8000));
  }
  throw new Error("Render deployment timed out while waiting for a live service.");
}

export async function deployToRender({ id, projectId, runtime, buildCommand, startCommand, userId }) {
  const cfg = githubConfig();
  const ownerId = required("RENDER_OWNER_ID");
  const work = path.resolve(process.env.DATA_DIR || "./data", "users", String(userId), "projects", String(projectId));
  const prefix = `projects/${projectId}`;
  const generated = dockerFiles(runtime, buildCommand, startCommand);
  await q("UPDATE deployments SET status='Building',container_name=NULL,host_port=NULL,image_name=NULL WHERE id=$1", [id]);
  await log(id, `Syncing project files to ${cfg.repoUrl}/${prefix}`);
  const count = await syncProject(cfg, work, prefix, generated);
  await log(id, `Uploaded ${count} files to GitHub`);

  const previous = await q(`SELECT container_name FROM deployments WHERE project_id=$1 AND container_name LIKE 'srv-%' ORDER BY created_at DESC LIMIT 1`, [projectId]);
  const serviceId = previous.rows[0]?.container_name || null;
  const name = `priyo-${safeName((await q("SELECT name FROM projects WHERE id=$1", [projectId])).rows[0]?.name || "project")}-${crypto.createHash("sha1").update(String(projectId)).digest("hex").slice(0, 8)}`.slice(0, 63);
  await log(id, serviceId ? `Updating Render service ${serviceId}` : `Creating Render service ${name}`);
  const result = await createOrUpdateService({ serviceId, name, cfg, prefix, runtime, startCommand });
  const service = result.service;
  const sid = service.id || serviceId;
  if (!sid) throw new Error("Render did not return a service ID.");
  const url = service.url || service.serviceDetails?.url || `https://${service.slug || name}.onrender.com`;
  await q("UPDATE deployments SET status='Building',container_name=$2,url=$3 WHERE id=$1", [id, sid, url]);
  await log(id, `Render deployment queued${result.deployId ? ` (${result.deployId})` : ""}`);
  await waitForDeploy(sid, result.deployId);
  await q("UPDATE deployments SET status='Running',started_at=COALESCE(started_at,now()),url=$2 WHERE id=$1", [id, url]);
  await log(id, `Render service is live: ${url}`);
  return { serviceId: sid, url };
}

export async function stopRenderService(serviceId) {
  if (!serviceId) return;
  await jsonRequest(`${RENDER_API}/services/${encodeURIComponent(serviceId)}/suspend`, { method: "POST", headers: renderHeaders() });
}

export async function log(id, line, stream = "stdout") {
  await q("INSERT INTO deployment_logs(deployment_id,stream,line) VALUES($1,$2,$3)", [id, stream, String(line).slice(0, 8000)]);
}
