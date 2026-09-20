import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
const ROOT = path.resolve(process.env.DATA_DIR || "./data");
export async function ensureProjectDir(userId, projectId) {
  const p = path.join(ROOT, "users", userId, "projects", projectId);
  await fs.mkdir(p,{recursive:true});
  return p;
}
export function safeRelative(input) {
  const p = input.replaceAll("\\","/").replace(/^\/+/,"");
  if (!p || p.split("/").some(x=>x===".." || x==="." && p.includes(".."))) throw new Error("Invalid path");
  if (p.includes("\0") || /^[A-Za-z]:/.test(p)) throw new Error("Invalid path");
  return p;
}
export async function directorySize(dir) {
  let total=0;
  async function walk(p) {
    for (const e of await fs.readdir(p,{withFileTypes:true})) {
      const x=path.join(p,e.name);
      if (e.isDirectory()) await walk(x); else if (e.isFile()) total+=(await fs.stat(x)).size;
    }
  }
  try { await walk(dir); } catch {}
  return total;
}
export function tempName(ext="") { return path.join("/tmp", crypto.randomUUID()+ext); }
export { ROOT };
