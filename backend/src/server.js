import express from "express";
import session from "express-session";
import connectPg from "connect-pg-simple";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import multer from "multer";
import httpProxy from "http-proxy";
import fs from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import { z } from "zod";
import { config } from "./config.js";
import { pool,q,migrate } from "./db.js";
import { hashPassword,verifyPassword,requireAuth,requireAdmin,accountUsable } from "./auth.js";
import { ensureProjectDir,safeRelative,directorySize } from "./storage.js";
import { deploy,stopDeployment,logsFor,deleteRemoteService } from "./deploy.js";
import { detectSource } from "./source.js";

const app=express();
const publicProxy=httpProxy.createProxyServer({changeOrigin:true});
app.set("trust proxy",1);
app.use(helmet({contentSecurityPolicy:false}));
app.use(express.json({limit:"2mb"}));
app.use(rateLimit({windowMs:15*60*1000,max:300,standardHeaders:true,legacyHeaders:false}));
const PgStore=connectPg(session);
app.use(session({
  store:new PgStore({pool,tableName:"sessions",createTableIfMissing:false}),
  secret:config.sessionSecret,resave:false,saveUninitialized:false,
  cookie:{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:1000*60*60*12}
}));
const upload=multer({dest:"/tmp/priyo-uploads",limits:{fileSize:config.uploadMaxBytes}});

async function audit(req,action,type,id,metadata={}) { await q("INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,metadata) VALUES($1,$2,$3,$4,$5)",[req.session.user?.id,action,type,id,metadata]); }
async function currentUser(id) { return (await q("SELECT * FROM users WHERE id=$1",[id])).rows[0]; }
async function quota(userId) {
  const r=await q("SELECT storage_used_bytes FROM usage WHERE user_id=$1",[userId]);
  return Number(r.rows[0]?.storage_used_bytes||0);
}
async function refreshUsage(userId) {
  const r=await q(`SELECT COALESCE(SUM(pf.size_bytes),0) total FROM project_files pf JOIN projects p ON p.id=pf.project_id WHERE p.user_id=$1`,[userId]);
  await q(`INSERT INTO usage(user_id,storage_used_bytes) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET storage_used_bytes=$2,updated_at=now()`,[userId,Number(r.rows[0].total)]);
  return Number(r.rows[0].total);
}
async function saveTree(userId,projectId,src) {
  const dest=await ensureProjectDir(userId,projectId);
  async function walk(cur,rel="") {
    for(const e of await fs.readdir(cur,{withFileTypes:true})) {
      if(e.name===".priyo.Dockerfile") continue;
      const rp=safeRelative(path.posix.join(rel,e.name)), sp=path.join(cur,e.name), dp=path.join(dest,rp);
      if(e.isDirectory()) { await fs.mkdir(dp,{recursive:true}); await walk(sp,rp); }
      else if(e.isFile()) { const st=await fs.stat(sp); await fs.mkdir(path.dirname(dp),{recursive:true}); await fs.copyFile(sp,dp); await q(`INSERT INTO project_files(project_id,path,size_bytes) VALUES($1,$2,$3) ON CONFLICT(project_id,path) DO UPDATE SET size_bytes=$3,updated_at=now()`,[projectId,rp,st.size]); }
    }
  }
  await walk(src); await refreshUsage(userId);
}
app.get("/api/health",(req,res)=>res.json({ok:true}));
app.post("/api/auth/login",async(req,res)=>{
  const b=z.object({username:z.string().min(1).max(100),password:z.string().min(1).max(200)}).parse(req.body);
  const r=await q("SELECT * FROM users WHERE username=$1",[b.username]); const u=r.rows[0];
  if(!u || !await verifyPassword(u.password_hash,b.password) || !accountUsable(u)) return res.status(401).json({error:"Invalid credentials or expired/disabled account"});
  req.session.user={id:u.id,username:u.username,isAdmin:u.is_admin}; await audit(req,"login","user",u.id); res.json({user:req.session.user});
});
app.post("/api/auth/logout",requireAuth,(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/auth/me",async(req,res)=>{ if(!req.session.user) return res.status(401).json({error:"Not logged in"}); const u=await currentUser(req.session.user.id); if(!accountUsable(u)) return req.session.destroy(()=>res.status(401).json({error:"Account expired or disabled"})); res.json({user:{id:u.id,username:u.username,isAdmin:u.is_admin,expiresAt:u.expires_at}}); });

app.get("/api/admin/users",requireAdmin,async(req,res)=>res.json((await q("SELECT id,username,enabled,expires_at,storage_limit_bytes,max_projects,max_deployments,allow_html,allow_node,allow_python,created_at FROM users WHERE is_admin=false ORDER BY username")).rows));
app.post("/api/admin/users",requireAdmin,async(req,res)=>{
  const b=z.object({username:z.string().regex(/^[a-zA-Z0-9_-]{3,40}$/),password:z.string().min(8),expiresAt:z.string().datetime().nullable().optional(),storageLimitBytes:z.number().int().positive(),maxProjects:z.number().int().positive(),maxDeployments:z.number().int().positive(),allowHtml:z.boolean(),allowNode:z.boolean(),allowPython:z.boolean()}).parse(req.body);
  const hash=await hashPassword(b.password);
  try { const r=await q(`INSERT INTO users(username,password_hash,expires_at,storage_limit_bytes,max_projects,max_deployments,allow_html,allow_node,allow_python) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,username`,[b.username,hash,b.expiresAt||null,b.storageLimitBytes,b.maxProjects,b.maxDeployments,b.allowHtml,b.allowNode,b.allowPython]); await q("INSERT INTO usage(user_id) VALUES($1)",[r.rows[0].id]); await audit(req,"create_user","user",r.rows[0].id); res.status(201).json(r.rows[0]); } catch(e){res.status(400).json({error:e.code==="23505"?"Username already exists":e.message});}
});
app.patch("/api/admin/users/:id",requireAdmin,async(req,res)=>{
  const b=z.object({enabled:z.boolean().optional(),expiresAt:z.string().datetime().nullable().optional(),storageLimitBytes:z.number().int().positive().optional(),maxProjects:z.number().int().positive().optional(),maxDeployments:z.number().int().positive().optional(),allowHtml:z.boolean().optional(),allowNode:z.boolean().optional(),allowPython:z.boolean().optional(),password:z.string().min(8).optional()}).parse(req.body);
  const u=await currentUser(req.params.id); if(!u) return res.sendStatus(404);
  const fields=[],vals=[]; const add=(k,v)=>{fields.push(`${k}=$${vals.length+1}`);vals.push(v)};
  if(b.enabled!==undefined)add("enabled",b.enabled); if(b.expiresAt!==undefined)add("expires_at",b.expiresAt); if(b.storageLimitBytes)add("storage_limit_bytes",b.storageLimitBytes); if(b.maxProjects)add("max_projects",b.maxProjects); if(b.maxDeployments)add("max_deployments",b.maxDeployments); if(b.allowHtml!==undefined)add("allow_html",b.allowHtml); if(b.allowNode!==undefined)add("allow_node",b.allowNode); if(b.allowPython!==undefined)add("allow_python",b.allowPython); if(b.password)add("password_hash",await hashPassword(b.password));
  if(fields.length) { vals.push(req.params.id); await q(`UPDATE users SET ${fields.join(",")},updated_at=now() WHERE id=$${vals.length}` ,vals); }
  await audit(req,"update_user","user",req.params.id); res.json({ok:true});
});
app.delete("/api/admin/users/:id",requireAdmin,async(req,res)=>{await q("DELETE FROM users WHERE id=$1 AND is_admin=false",[req.params.id]);await audit(req,"delete_user","user",req.params.id);res.json({ok:true});});
app.get("/api/admin/users/:id/details",requireAdmin,async(req,res)=>{const u=await currentUser(req.params.id);const projects=(await q("SELECT * FROM projects WHERE user_id=$1 ORDER BY created_at DESC",[req.params.id])).rows;const deps=(await q("SELECT * FROM deployments WHERE user_id=$1 ORDER BY created_at DESC",[req.params.id])).rows;res.json({user:u,storageUsed:await quota(req.params.id),projects,deployments:deps});});
app.post("/api/admin/deployments/:id/stop",requireAdmin,async(req,res)=>{const r=await q("SELECT * FROM deployments WHERE id=$1",[req.params.id]);if(!r.rows[0])return res.sendStatus(404);await stopDeployment(req.params.id);await audit(req,"stop_deployment","deployment",req.params.id);res.json({ok:true});});
app.delete("/api/admin/deployments/:id",requireAdmin,async(req,res)=>{await stopDeployment(req.params.id);await q("DELETE FROM deployments WHERE id=$1",[req.params.id]);await audit(req,"delete_deployment","deployment",req.params.id);res.json({ok:true});});
app.get("/api/admin/deployments/:id/logs",requireAdmin,async(req,res)=>res.json(await logsFor(req.params.id)));

app.get("/api/dashboard",requireAuth,async(req,res)=>{const u=await currentUser(req.session.user.id);const projects=(await q("SELECT * FROM projects WHERE user_id=$1 ORDER BY created_at DESC",[u.id])).rows;const deployments=(await q("SELECT * FROM deployments WHERE user_id=$1 ORDER BY created_at DESC",[u.id])).rows;res.json({user:{username:u.username,expiresAt:u.expires_at,storageLimitBytes:u.storage_limit_bytes,maxProjects:u.max_projects,maxDeployments:u.max_deployments,allowHtml:u.allow_html,allowNode:u.allow_node,allowPython:u.allow_python},storageUsed:await quota(u.id),projects,deployments});});
app.post("/api/projects",requireAuth,async(req,res)=>{const u=await currentUser(req.session.user.id);const b=z.object({name:z.string().regex(/^[a-zA-Z0-9_-]{1,50}$/),runtime:z.enum(["html","node","python"]),buildCommand:z.string().max(500).optional(),startCommand:z.string().max(500).optional()}).parse(req.body);if((await q("SELECT count(*) FROM projects WHERE user_id=$1",[u.id])).rows[0].count>=u.max_projects)return res.status(403).json({error:"Project limit reached"});if(!({html:u.allow_html,node:u.allow_node,python:u.allow_python}[b.runtime]))return res.status(403).json({error:"Runtime not allowed"});const r=await q("INSERT INTO projects(user_id,name,runtime,build_command,start_command) VALUES($1,$2,$3,$4,$5) RETURNING *",[u.id,b.name,b.runtime,b.buildCommand||null,b.startCommand||null]);await ensureProjectDir(u.id,r.rows[0].id);await audit(req,"create_project","project",r.rows[0].id);res.status(201).json(r.rows[0]);});
app.post("/api/projects/:id/upload",requireAuth,upload.single("file"),async(req,res)=>{
  const p=(await q("SELECT p.*,u.storage_limit_bytes FROM projects p JOIN users u ON u.id=p.user_id WHERE p.id=$1 AND p.user_id=$2",[req.params.id,req.session.user.id])).rows[0];if(!p)return res.sendStatus(404);if(!req.file)return res.status(400).json({error:"File required"});const before=await quota(p.user_id);if(before+req.file.size>Number(p.storage_limit_bytes)) {await fs.unlink(req.file.path).catch(()=>{});return res.status(413).json({error:"Storage quota exceeded"});}
  const dest=await ensureProjectDir(p.user_id,p.id);
  try {
    if(req.file.originalname.toLowerCase().endsWith(".zip")){
      const zip=new AdmZip(req.file.path); const entries=zip.getEntries(); let total=0;
      for(const e of entries){ if(e.isDirectory)continue; const rel=safeRelative(e.entryName); total+=e.header.size; if(total>config.uploadMaxBytes || before+total>Number(p.storage_limit_bytes)) throw new Error("ZIP exceeds allowed size/quota"); const out=path.join(dest,rel); if(!out.startsWith(dest+path.sep))throw new Error("Unsafe ZIP path"); await fs.mkdir(path.dirname(out),{recursive:true}); await fs.writeFile(out,e.getData()); await q(`INSERT INTO project_files(project_id,path,size_bytes) VALUES($1,$2,$3) ON CONFLICT(project_id,path) DO UPDATE SET size_bytes=$3,updated_at=now()`,[p.id,rel,e.header.size]); }
    } else { const rel=safeRelative(req.body.path||req.file.originalname); const out=path.join(dest,rel); if(!out.startsWith(dest+path.sep))throw new Error("Unsafe path"); await fs.mkdir(path.dirname(out),{recursive:true}); await fs.copyFile(req.file.path,out); await q(`INSERT INTO project_files(project_id,path,size_bytes) VALUES($1,$2,$3) ON CONFLICT(project_id,path) DO UPDATE SET size_bytes=$3,updated_at=now()`,[p.id,rel,req.file.size]); }
    await refreshUsage(p.user_id); await audit(req,"upload_file","project",p.id);res.json({ok:true,storageUsed:await quota(p.user_id)});
  } catch(e){res.status(400).json({error:e.message});} finally {await fs.unlink(req.file.path).catch(()=>{});}
});
app.get("/api/projects/:id/files",requireAuth,async(req,res)=>{const p=(await q("SELECT * FROM projects WHERE id=$1 AND user_id=$2",[req.params.id,req.session.user.id])).rows[0];if(!p)return res.sendStatus(404);res.json((await q("SELECT id,path,size_bytes,updated_at FROM project_files WHERE project_id=$1 ORDER BY path",[p.id])).rows);});
app.get("/api/projects/:id/source",requireAuth,async(req,res)=>{const p=(await q("SELECT id,user_id,runtime FROM projects WHERE id=$1 AND user_id=$2",[req.params.id,req.session.user.id])).rows[0];if(!p)return res.sendStatus(404);try{res.json(await detectSource(p.user_id,p.id,p.runtime));}catch(e){res.status(400).json({error:e.message});}});
app.delete("/api/projects/:id",requireAuth,async(req,res)=>{
  const p=(await q("SELECT * FROM projects WHERE id=$1 AND user_id=$2",[req.params.id,req.session.user.id])).rows[0];
  if(!p)return res.sendStatus(404);
  const deps=(await q("SELECT id,container_name FROM deployments WHERE project_id=$1",[p.id])).rows;
  for(const d of deps){ try{await stopDeployment(d.id); await deleteRemoteService(d.container_name);}catch{} }
  const dir=await ensureProjectDir(p.user_id,p.id);
  await fs.rm(dir,{recursive:true,force:true});
  await q("DELETE FROM projects WHERE id=$1 AND user_id=$2",[p.id,p.user_id]);
  await refreshUsage(p.user_id);
  await audit(req,"delete_project","project",p.id);
  res.json({ok:true});
});
app.post("/api/projects/:id/deploy",requireAuth,async(req,res)=>{const p=(await q("SELECT p.*,u.* FROM projects p JOIN users u ON u.id=p.user_id WHERE p.id=$1 AND p.user_id=$2",[req.params.id,req.session.user.id])).rows[0];if(!p)return res.sendStatus(404);if(!accountUsable(p))return res.status(403).json({error:"Account expired or disabled"});const count=Number((await q("SELECT count(*) FROM deployments WHERE user_id=$1 AND status IN ('Queued','Building','Running')",[p.user_id])).rows[0].count);if(count>=p.max_deployments)return res.status(403).json({error:"Deployment limit reached"});const r=await q("INSERT INTO deployments(project_id,user_id,runtime,status) VALUES($1,$2,$3,'Queued') RETURNING *",[p.id,p.user_id,p.runtime]);await audit(req,"create_deployment","deployment",r.rows[0].id);deploy({id:r.rows[0].id,userId:p.user_id,projectId:p.id,runtime:p.runtime,name:p.name,buildCommand:p.build_command,startCommand:p.start_command});res.status(202).json(r.rows[0]);});
app.get("/api/deployments/:id/logs",requireAuth,async(req,res)=>{const d=(await q("SELECT * FROM deployments WHERE id=$1 AND user_id=$2",[req.params.id,req.session.user.id])).rows[0];if(!d)return res.sendStatus(404);res.json(await logsFor(d.id));});
app.post("/api/deployments/:id/stop",requireAuth,async(req,res)=>{const d=(await q("SELECT * FROM deployments WHERE id=$1 AND user_id=$2",[req.params.id,req.session.user.id])).rows[0];if(!d)return res.sendStatus(404);await stopDeployment(d.id);res.json({ok:true});});

app.use("/d/:id",async(req,res)=>{
  const id=req.params.id;
  const d=(await q("SELECT * FROM deployments WHERE id=$1 AND status='Running'",[id])).rows[0];
  if(!d) return res.status(404).send("Deployment not running");
  const target=`http://host.docker.internal:${d.host_port}`;
  req.url=req.url.replace(/^\/d\/[^/]+/,"") || "/";
  publicProxy.web(req,res,{target},e=>res.status(502).send("Deployment proxy unavailable"));
});

const dist=path.resolve("frontend/dist");
app.use(express.static(dist)); app.get("/{*splat}",(req,res)=>res.sendFile(path.join(dist,"index.html")));
await migrate();
const admin=await q("SELECT id FROM users WHERE username=$1",[config.adminUsername]);
if(!admin.rows.length) { const h=await hashPassword(config.adminPassword); const r=await q("INSERT INTO users(username,password_hash,is_admin) VALUES($1,$2,true) RETURNING id",[config.adminUsername,h]); await q("INSERT INTO usage(user_id) VALUES($1)",[r.rows[0].id]); console.log(`Created admin ${config.adminUsername}`); }
app.listen(config.port,()=>console.log(`PRIYO_CODEX HOST listening on ${config.port}`));
