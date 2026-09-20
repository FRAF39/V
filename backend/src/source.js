import fs from "node:fs/promises";
import path from "node:path";
import { ensureProjectDir } from "./storage.js";

const ignored = new Set(["node_modules", ".git", ".next", "dist", "build", "__pycache__", ".venv", "venv"]);

async function exists(p){ try { await fs.access(p); return true; } catch { return false; } }
async function readJson(p){ try { return JSON.parse(await fs.readFile(p,"utf8")); } catch { return null; } }

export async function detectSource(userId, projectId, runtime) {
  const root = await ensureProjectDir(userId, projectId);
  const files = [];
  async function walk(dir, rel="") {
    for (const e of await fs.readdir(dir,{withFileTypes:true})) {
      if (ignored.has(e.name) || e.name === ".priyo.Dockerfile") continue;
      const rp = path.posix.join(rel,e.name);
      if (e.isDirectory()) await walk(path.join(dir,e.name),rp);
      else if (e.isFile()) files.push(rp);
    }
  }
  await walk(root);

  const packageJson = await readJson(path.join(root,"package.json"));
  const req = await exists(path.join(root,"requirements.txt"));
  const pyproject = await exists(path.join(root,"pyproject.toml"));
  const composer = await readJson(path.join(root,"composer.json"));
  const detected = new Set();
  const evidence = [];

  if (runtime === "html" || files.some(f => /\.(html?|css|js)$/i.test(f))) detected.add("HTML/CSS/JavaScript");
  if (packageJson) {
    detected.add("Node.js"); evidence.push("package.json");
    const deps = {...(packageJson.dependencies||{}),...(packageJson.devDependencies||{})};
    const checks = [["React","react"],["Vite","vite"],["Next.js","next"],["Express","express"],["Fastify","fastify"],["Vue","vue"],["Angular","@angular/core"],["Svelte","svelte"],["Tailwind CSS","tailwindcss"],["TypeScript","typescript"]];
    for (const [label,key] of checks) if (deps[key]) detected.add(label);
  }
  if (req || pyproject || files.some(f=>/\.py$/i.test(f))) { detected.add("Python"); if(req)evidence.push("requirements.txt"); if(pyproject)evidence.push("pyproject.toml"); }
  if (composer) { detected.add("PHP"); evidence.push("composer.json"); }
  if (files.some(f=>/\.ts$/i.test(f))) detected.add("TypeScript");
  if (files.some(f=>/\.php$/i.test(f))) detected.add("PHP");
  if (files.some(f=>/\.go$/i.test(f))) detected.add("Go");
  if (files.some(f=>/\.rs$/i.test(f))) detected.add("Rust");
  if (files.some(f=>/\.rb$/i.test(f))) detected.add("Ruby");

  const entryCandidates = ["index.html","package.json","server.js","app.js","main.py","app.py","manage.py","pyproject.toml","requirements.txt","composer.json"];
  const entryPoints = entryCandidates.filter(x=>files.includes(x));
  return { runtime, technologies:[...detected], evidence:[...new Set(evidence)], fileCount:files.length, entryPoints, files:files.slice(0,500) };
}
