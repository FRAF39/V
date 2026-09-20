import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { q } from "./db.js";
import { ensureProjectDir } from "./storage.js";
import { config } from "./config.js";

async function log(id,line,stream="stdout") { await q("INSERT INTO deployment_logs(deployment_id,stream,line) VALUES($1,$2,$3)",[id,stream,line.slice(0,8000)]); }
function run(cmd,args,opts={}) { return new Promise((resolve,reject)=>{ const p=spawn(cmd,args,{env:process.env,...opts}); let out="",err=""; p.stdout?.on("data",d=>out+=d); p.stderr?.on("data",d=>err+=d); const t=setTimeout(()=>{p.kill("SIGKILL");reject(new Error("Command timeout"));},config.deploymentTimeoutMs); p.on("error",reject); p.on("close",c=>{clearTimeout(t); c===0?resolve(out):reject(new Error(err||`exit ${c}`));}); }); }
async function api(url, options={}) { const r=await fetch(url,{...options,headers:{Accept:"application/json","Content-Type":"application/json",Authorization:`Bearer ${config.renderApiKey}`,...(options.headers||{})}}); const text=await r.text(); let data={}; try{data=text?JSON.parse(text):{}}catch{} if(!r.ok) throw new Error(data?.message||data?.error||text||`Render API ${r.status}`); return data; }
function repoInfo(){ const m=config.renderRepo.match(/github\.com[/:]([^/]+)\/([^/#]+?)(?:\.git)?$/i); if(!m) throw new Error("DEPLOY_GITHUB_REPO must be a GitHub repository URL"); return {owner:m[1],repo:m[2]}; }
async function github(url,options={}){ if(!config.githubToken) throw new Error("GITHUB_TOKEN is not configured"); const r=await fetch(`https://api.github.com${url}`,{...options,headers:{Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28",Authorization:`Bearer ${config.githubToken}`,...(options.headers||{})}}); const text=await r.text(); let d={}; try{d=text?JSON.parse(text):{}}catch{} if(!r.ok) throw new Error(d.message||`GitHub API ${r.status}`); return d; }
async function syncProjectToGitHub({userId,projectId,oldFiles}){
  const {owner,repo}=repoInfo(); const branch=config.renderBranch; const root=await ensureProjectDir(userId,projectId); const prefix=`projects/${projectId}`;
  const ref=await github(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`); const commit=await github(`/repos/${owner}/${repo}/git/commits/${ref.object.sha}`); const entries=[];
  async function walk(dir,rel="") { for(const e of await fs.readdir(dir,{withFileTypes:true})){ if([".git","node_modules",".priyo.Dockerfile"].includes(e.name))continue; const rp=path.posix.join(rel,e.name); const fp=path.join(dir,e.name); if(e.isDirectory()) await walk(fp,rp); else if(e.isFile()){ const buf=await fs.readFile(fp); const blob=await github(`/repos/${owner}/${repo}/git/blobs`,{method:"POST",body:JSON.stringify({content:buf.toString("base64"),encoding:"base64"})}); entries.push({path:`${prefix}/${rp}`,mode:"100644",type:"blob",sha:blob.sha}); } } }
  await walk(root);
  const tree=await github(`/repos/${owner}/${repo}/git/trees`,{method:"POST",body:JSON.stringify({base_tree:commit.tree.sha,tree:entries})});
  const newCommit=await github(`/repos/${owner}/${repo}/git/commits`,{method:"POST",body:JSON.stringify({message:`Deploy project ${projectId}`,tree:tree.sha,parents:[ref.object.sha]})});
  await github(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`,{method:"PATCH",body:JSON.stringify({sha:newCommit.sha,force:false})});
  return {repo:`https://github.com/${owner}/${repo}`,branch,prefix};
}
async function renderServiceFor({id,projectId,runtime,name,buildCommand,startCommand,existingServiceId}){
  if(!config.renderApiKey||!config.renderOwnerId||!config.renderRepo) throw new Error("Render deployment is not configured. Set RENDER_API_KEY, RENDER_OWNER_ID and DEPLOY_GITHUB_REPO.");
  const rootDir=`projects/${projectId}`;
  const isStatic=runtime==="html";
  if(existingServiceId){
    await api(`https://api.render.com/v1/services/${existingServiceId}/resume`,{method:"POST"}).catch(()=>{});
    const d=await api(`https://api.render.com/v1/services/${existingServiceId}/deploys`,{method:"POST",body:JSON.stringify({clearCache:"do_not_clear",deployMode:"build_and_deploy"})});
    const current=await api(`https://api.render.com/v1/services/${existingServiceId}`);
    return {serviceId:existingServiceId,url:current.url,deployId:d.id||d.deploy?.id};
  }
  const body={type:isStatic?"static_site":"web_service",name:`priyo-${name}-${String(projectId).slice(0,8)}`.slice(0,50),ownerId:config.renderOwnerId,repo:config.renderRepo,branch:config.renderBranch,autoDeploy:"no",rootDir};
  if(isStatic) {
    body.serviceDetails={buildCommand:buildCommand||"echo 'static site ready'",publishPath:"."};
  } else {
    const defaults = runtime === "node"
      ? {buildCommand:"npm install",startCommand:"npm start"}
      : {buildCommand:"pip install -r requirements.txt || true",startCommand:"gunicorn app:app --bind 0.0.0.0:$PORT"};
    body.serviceDetails={runtime,plan:config.renderPlan,region:config.renderRegion,envSpecificDetails:{buildCommand:buildCommand||defaults.buildCommand,startCommand:startCommand||defaults.startCommand},healthCheckPath:"/"};
  }
  const created=await api("https://api.render.com/v1/services",{method:"POST",body:JSON.stringify(body)});
  const service=created.service||created;
  if(!service.id) throw new Error("Render created the service but did not return a service ID.");
  return {serviceId:service.id,url:service.url||null};
}
export async function deploy({id,userId,projectId,runtime,buildCommand,startCommand,name}){
  await q("UPDATE deployments SET status='Building' WHERE id=$1",[id]);
  try {
    const old=(await q("SELECT path FROM project_files WHERE project_id=$1 ORDER BY path",[projectId])).rows;
    await log(id,"Preparing source for managed Render deployment");
    const synced=await syncProjectToGitHub({userId,projectId,oldFiles:old});
    await log(id,`Source synced to ${synced.repo} (${synced.branch})`);
    const previous=(await q("SELECT container_name FROM deployments WHERE project_id=$1 AND container_name IS NOT NULL ORDER BY created_at DESC LIMIT 1",[projectId])).rows[0];
    const service=await renderServiceFor({id,projectId,runtime,name,buildCommand,startCommand,existingServiceId:previous?.container_name});
    const url=service.url||`https://dashboard.render.com/web/srv-${service.serviceId||""}`;
    await q("UPDATE deployments SET status='Running',started_at=now(),url=$2,container_name=$3 WHERE id=$1",[id,url,service.serviceId||null]);
    await log(id,`Render service created: ${service.serviceId||"unknown"}`);
  } catch(e) { await q("UPDATE deployments SET status='Failed',error_message=$2 WHERE id=$1",[id,String(e.message).slice(0,2000)]); await log(id,e.stack||e.message,"stderr"); }
}
export async function stopDeployment(id){ const r=await q("SELECT container_name FROM deployments WHERE id=$1",[id]); const serviceId=r.rows[0]?.container_name; if(serviceId&&config.renderApiKey){try{await api(`https://api.render.com/v1/services/${serviceId}/suspend`,{method:"POST"});}catch{}} await q("UPDATE deployments SET status='Stopped',stopped_at=now() WHERE id=$1",[id]); await log(id,"Deployment stopped"); }
export async function deleteRemoteService(serviceId){ if(!serviceId||!config.renderApiKey)return; try{await api(`https://api.render.com/v1/services/${serviceId}`,{method:"DELETE"});}catch(e){if(!String(e.message).includes("404"))throw e;} }
export async function logsFor(id){ return (await q("SELECT stream,line,created_at FROM deployment_logs WHERE deployment_id=$1 ORDER BY id",[id])).rows; }
