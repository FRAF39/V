import pg from "pg";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
const { Pool } = pg;
export const pool = new Pool({ connectionString: config.databaseUrl, max: 10, ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false });
export const q = (text, params=[]) => pool.query(text, params);
export async function migrate() {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");
  const files = (await fs.readdir(dir)).filter(x=>x.endsWith(".sql")).sort();
  for (const f of files) await q(await fs.readFile(path.join(dir,f),"utf8"));
}
