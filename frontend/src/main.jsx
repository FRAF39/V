import React,{useEffect,useMemo,useState} from "react";
import {createRoot} from "react-dom/client";
import "./style.css";

const api=async(u,o={})=>{const r=await fetch(u,{credentials:"include",...o});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||"Request failed");return d};

const icons={
  grid:"▦", project:"⌘", rocket:"↗", file:"▤", settings:"⚙", users:"♙", activity:"◉",
  plus:"+", search:"⌕", logout:"⇥", play:"▶", stop:"■", log:"≡", moon:"☾", sun:"☀"
};

function Login({onLogin}){
 const [username,setU]=useState(""),[password,setP]=useState(""),[err,setE]=useState(""),[busy,setB]=useState(false);
 return <main className="auth"><div className="auth-glow"/><form className="login-card" onSubmit={async e=>{e.preventDefault();setB(true);setE("");try{const d=await api("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username,password})});onLogin(d.user)}catch(x){setE(x.message)}finally{setB(false)}}}>
   <div className="brand-mark">P</div><span className="eyebrow">PRIYO CODEX</span><h1>Host your projects.<br/><span>Ship with confidence.</span></h1>
   <p className="muted">A clean, secure control panel for projects, files and deployments.</p>
   <label>Username<input autoComplete="username" placeholder="Enter username" value={username} onChange={e=>setU(e.target.value)}/></label>
   <label>Password<input autoComplete="current-password" placeholder="Enter password" type="password" value={password} onChange={e=>setP(e.target.value)}/></label>
   <button className="primary wide" disabled={busy}>{busy?"Signing in…":"Sign in"} <span>→</span></button>
   {err&&<div className="alert error">{err}</div>}
   <div className="login-foot">Protected session · Rate limited · Secure cookies</div>
 </form></main>
}

function App(){
 const [me,setMe]=useState(null);
 useEffect(()=>{api("/api/auth/me").then(x=>setMe(x.user)).catch(()=>{})},[]);
 if(!me)return <Login onLogin={setMe}/>;
 return me.isAdmin?<Admin me={me}/>:<User me={me}/>;
}

function Shell({title,active,onNavigate,me,children}){
 const [dark,setDark]=useState(()=>localStorage.theme==="dark");
 useEffect(()=>{document.documentElement.dataset.theme=dark?"dark":"light";localStorage.theme=dark?"dark":"light"},[dark]);
 const nav=[["overview",icons.grid,"Overview"],["projects",icons.project,"Projects"],["deployments",icons.rocket,"Deployments"],["files",icons.file,"File manager"],["settings",icons.settings,"Settings"]];
 return <div className="app">
   <aside className="sidebar"><div className="logo"><div className="logo-box">P</div><div><b>PRIYO</b><small>CODEX HOST</small></div></div>
    <div className="nav-label">Workspace</div>{nav.map(([id,ic,n])=><button className={active===id?"nav active":"nav"} key={id} onClick={()=>onNavigate(id)}><i>{ic}</i>{n}</button>)}
    <div className="sidebar-spacer"/>
    <button className="nav" onClick={()=>setDark(!dark)}><i>{dark?icons.sun:icons.moon}</i>{dark?"Light mode":"Dark mode"}</button>
    <div className="profile"><div className="avatar">{(me?.username||"U")[0].toUpperCase()}</div><div><b>{me?.username}</b><small>{me?.isAdmin?"Administrator":"Member"}</small></div></div>
   </aside>
   <main className="content"><header className="topbar"><div><span className="eyebrow">{me?.isAdmin?"ADMIN CONSOLE":"WORKSPACE"}</span><h2>{title}</h2></div><div className="top-actions"><span className="status-dot"/> <span className="muted">System online</span><button className="icon-btn" title="Logout" onClick={()=>api("/api/auth/logout",{method:"POST"}).then(()=>location.reload())}>{icons.logout}</button></div></header>{children}</main>
 </div>
}

function Stat({label,value,sub,accent}){return <div className={"stat "+(accent||"")}><div className="stat-top"><span>{label}</span><span className="stat-icon">✦</span></div><strong>{value}</strong>{sub&&<small>{sub}</small>}</div>}
function Empty({title,text,action}){return <div className="empty"><div className="empty-icon">✦</div><h3>{title}</h3><p>{text}</p>{action}</div>}

function User({me}){
 const [d,setD]=useState(null),[tab,setTab]=useState("overview"),[query,setQuery]=useState(""),[showCreate,setCreate]=useState(false),[selected,setSelected]=useState(null);
 const load=()=>api("/api/dashboard").then(setD).catch(()=>{});
 useEffect(load,[]);
 if(!d)return <Shell title="Loading workspace" active="overview" onNavigate={setTab} me={me}><div className="loading">Loading your workspace…</div></Shell>;
 const projects=d.projects||[], deployments=d.deployments||[];
 const filtered=projects.filter(p=>p.name.toLowerCase().includes(query.toLowerCase()));
 const running=deployments.filter(x=>x.status==="Running").length;
 const title={overview:"Overview",projects:"Projects",deployments:"Deployments",files:"File manager",settings:"Settings"}[tab];
 return <Shell title={title} active={tab} onNavigate={setTab} me={me}>
   {tab==="overview"&&<Overview d={d} projects={projects} deployments={deployments} onCreate={()=>setCreate(true)} onTab={setTab} onSelect={setSelected}/>}
   {tab==="projects"&&<Projects d={d} projects={filtered} query={query} setQuery={setQuery} onCreate={()=>setCreate(true)} onRefresh={load} onSelect={setSelected}/>}
   {tab==="deployments"&&<Deployments deployments={deployments} onRefresh={load}/>}
   {tab==="files"&&<FileManager projects={projects}/>}
   {tab==="settings"&&<Settings d={d}/>}
   {showCreate&&<CreateProject d={d} onClose={()=>setCreate(false)} onDone={()=>{setCreate(false);load();setTab("projects")}}/>}
   {selected&&<ProjectModal p={selected} onClose={()=>setSelected(null)} onRefresh={load}/>}
 </Shell>
}

function Overview({d,projects,deployments,onCreate,onTab,onSelect}){
 return <><div className="welcome"><div><span className="eyebrow">GOOD TO SEE YOU</span><h1>Welcome back, {d.user.username}.</h1><p>Manage your projects, deployments and hosting resources from one place.</p></div><button className="primary" onClick={onCreate}>+ New project</button></div>
 <div className="stats"><Stat label="Projects" value={projects.length} sub={`${d.user.maxProjects} maximum`}/><Stat label="Running" value={deployments.filter(x=>x.status==="Running").length} sub={`${d.user.maxDeployments} deployment limit`}/><Stat label="Storage used" value={`${(d.storageUsed/1048576).toFixed(1)} MB`} sub={`of ${(d.user.storageLimitBytes/1073741824).toFixed(2)} GB`}/><Stat label="Account" value={d.user.expiresAt?new Date(d.user.expiresAt).toLocaleDateString():"Active"} sub="Expiry date"/></div>
 <div className="two-col"><section className="panel"><div className="panel-head"><div><h3>Recent projects</h3><p>Your latest workspaces</p></div><button className="ghost" onClick={()=>onTab("projects")}>View all →</button></div>{projects.slice(0,4).map(p=><ProjectRow key={p.id} p={p} onSelect={()=>onSelect(p)}/>)}{!projects.length&&<Empty title="No projects yet" text="Create your first project to get started." action={<button className="primary" onClick={onCreate}>Create project</button>}/>}</section>
 <section className="panel"><div className="panel-head"><div><h3>Deployment activity</h3><p>Latest build events</p></div><button className="ghost" onClick={()=>onTab("deployments")}>View logs →</button></div>{deployments.slice(0,5).map(x=><DeployRow key={x.id} x={x}/>)}{!deployments.length&&<Empty title="Nothing deployed" text="Deploy a project when you're ready."/>}</section></div></>
}

function Projects({d,projects,query,setQuery,onCreate,onRefresh,onSelect}){
 return <><div className="page-actions"><div><p className="muted">Create, upload and deploy your applications.</p></div><div className="actions"><div className="search"><span>{icons.search}</span><input placeholder="Search projects…" value={query} onChange={e=>setQuery(e.target.value)}/></div><button className="primary" onClick={onCreate}>+ New project</button></div></div>
 <div className="project-grid">{projects.map(p=><ProjectCard key={p.id} p={p} onSelect={()=>onSelect(p)} onRefresh={onRefresh}/>)}</div>{!projects.length&&<Empty title="No matching projects" text={query?"Try a different search.":"Your projects will appear here."} action={!query&&<button className="primary" onClick={onCreate}>Create project</button>}/>}</>
}

function ProjectCard({p,onSelect,onRefresh}){
 const [file,setFile]=useState(null),[busy,setBusy]=useState(false);
 const upload=async()=>{if(!file)return;setBusy(true);try{const fd=new FormData();fd.append("file",file);fd.append("path",file.name);await api(`/api/projects/${p.id}/upload`,{method:"POST",body:fd});setFile(null);onRefresh()}catch(e){alert(e.message)}finally{setBusy(false)}};
 const deploy=async()=>{setBusy(true);try{await api(`/api/projects/${p.id}/deploy`,{method:"POST"});onRefresh()}catch(e){alert(e.message)}finally{setBusy(false)}};
 return <article className="project-card"><div className="card-top"><div className={"runtime "+p.runtime}>{p.runtime==="html"?"</>":p.runtime==="node"?"JS":"PY"}</div><button className="icon-btn" onClick={onSelect}>⋯</button></div><h3>{p.name}</h3><p>{p.runtime==="html"?"Static website":p.runtime==="node"?"Node.js application":"Python application"}</p><div className="card-meta"><span>Updated {new Date(p.updated_at).toLocaleDateString()}</span><span className="badge">{p.runtime}</span></div><div className="card-actions"><label className="upload small">Upload<input type="file" accept=".zip,.html,.css,.js,.json,.py,.txt,.md" onChange={e=>setFile(e.target.files[0])}/></label><button className="secondary" disabled={!file||busy} onClick={upload}>{busy?"…":"Upload"}</button><button className="primary" disabled={busy} onClick={deploy}>{busy?"…":"Deploy →"}</button></div></article>
}

function ProjectRow({p,onSelect}){return <button className="list-row clickable" onClick={onSelect}><div className={"runtime mini "+p.runtime}>{p.runtime==="html"?"</>":p.runtime==="node"?"JS":"PY"}</div><div><b>{p.name}</b><small>{p.runtime} · Updated {new Date(p.updated_at).toLocaleDateString()}</small></div><span>→</span></button>}
function DeployRow({x}){return <div className="list-row"><div className={"deploy-icon "+x.status.toLowerCase()}>{x.status==="Running"?"✓":x.status==="Failed"?"!":"•"}</div><div><b>{x.runtime} deployment</b><small>{x.status} · {new Date(x.created_at).toLocaleString()}</small></div><span className={"status "+x.status.toLowerCase()}>{x.status}</span></div>}

function Deployments({deployments,onRefresh}){
 const [logs,setLogs]=useState(null);
 const stop=async id=>{try{await api(`/api/deployments/${id}/stop`,{method:"POST"});onRefresh()}catch(e){alert(e.message)}};
 const viewLogs=async id=>{try{const l=await api(`/api/deployments/${id}/logs`);setLogs(l)}catch(e){alert(e.message)}};
 return <><div className="page-actions"><p className="muted">Monitor builds, inspect logs and control running deployments.</p></div><section className="panel table-panel">{!deployments.length?<Empty title="No deployments" text="Deploy a project to see its build history here."/>:<div className="table"><div className="tr th"><span>Runtime</span><span>Status</span><span>Created</span><span>URL</span><span>Actions</span></div>{deployments.map(x=><div className="tr" key={x.id}><span><b>{x.runtime}</b><small>{x.id.slice(0,8)}…</small></span><span><i className={"status-dot "+x.status.toLowerCase()}/>{x.status}</span><span>{new Date(x.created_at).toLocaleString()}</span><span className="url">{x.url||x.error_message||"—"}</span><span className="row-actions"><button className="ghost" onClick={()=>viewLogs(x.id)}>Logs</button>{x.status==="Running"&&<button className="danger-outline" onClick={()=>stop(x.id)}>Stop</button>}</span></div>)}</div>}</section>{logs&&<div className="modal-backdrop" onClick={()=>setLogs(null)}><div className="modal log-modal" onClick={e=>e.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">DEPLOYMENT LOG</span><h3>Build output</h3></div><button className="icon-btn" onClick={()=>setLogs(null)}>×</button></div><pre>{logs.map(x=>x.line).join("\n")||"No logs available."}</pre></div></div>}</>
}

function FileManager({projects}){
 const [project,setProject]=useState(projects[0]?.id||""),[files,setFiles]=useState([]),[loading,setLoading]=useState(false);
 useEffect(()=>{if(!project){setFiles([]);return}setLoading(true);api(`/api/projects/${project}/files`).then(setFiles).catch(()=>setFiles([])).finally(()=>setLoading(false))},[project]);
 return <><div className="page-actions"><div><p className="muted">Browse the files uploaded to each project.</p></div><select value={project} onChange={e=>setProject(e.target.value)}>{projects.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></div><section className="panel file-panel">{loading?<div className="loading">Loading files…</div>:!files.length?<Empty title="No files" text="Upload a ZIP or individual file from the Projects page."/>:<div className="file-list">{files.map(f=><div className="file-row" key={f.id}><span className="file-icon">▱</span><div><b>{f.path}</b><small>{(Number(f.size_bytes)/1024).toFixed(1)} KB · {new Date(f.updated_at).toLocaleString()}</small></div><span className="muted">File</span></div>)}</div>}</section></>
}

function Settings({d}){return <><div className="settings-grid"><section className="panel"><div className="panel-head"><div><h3>Account</h3><p>Current workspace limits and access.</p></div></div><div className="setting"><span>Username</span><b>{d.user.username}</b></div><div className="setting"><span>Account status</span><span className="status running">Active</span></div><div className="setting"><span>Expires</span><b>{d.user.expiresAt?new Date(d.user.expiresAt).toLocaleString():"Never"}</b></div></section><section className="panel"><div className="panel-head"><div><h3>Runtime access</h3><p>Runtimes enabled for this account.</p></div></div><div className="setting"><span>HTML / Static</span><span className={d.user.allowHtml?"toggle on":"toggle"}>{d.user.allowHtml?"Enabled":"Disabled"}</span></div><div className="setting"><span>Node.js</span><span className={d.user.allowNode?"toggle on":"toggle"}>{d.user.allowNode?"Enabled":"Disabled"}</span></div><div className="setting"><span>Python</span><span className={d.user.allowPython?"toggle on":"toggle"}>{d.user.allowPython?"Enabled":"Disabled"}</span></div></section></div></>}

function CreateProject({d,onClose,onDone}){
 const [name,setName]=useState(""),[runtime,setRuntime]=useState(d.user.allowHtml?"html":d.user.allowNode?"node":"python"),[build,setBuild]=useState(""),[start,setStart]=useState(""),[busy,setBusy]=useState(false),[err,setErr]=useState("");
 const create=async()=>{setBusy(true);setErr("");try{await api("/api/projects",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,runtime,buildCommand:build||undefined,startCommand:start||undefined})});onDone()}catch(e){setErr(e.message)}finally{setBusy(false)}};
 return <div className="modal-backdrop"><div className="modal"><div className="modal-head"><div><span className="eyebrow">NEW WORKSPACE</span><h3>Create project</h3></div><button className="icon-btn" onClick={onClose}>×</button></div><p className="muted">Start a clean project and deploy it when ready.</p><label>Project name<input placeholder="my-awesome-site" value={name} onChange={e=>setName(e.target.value)}/></label><label>Runtime<select value={runtime} onChange={e=>setRuntime(e.target.value)}><option disabled={!d.user.allowHtml} value="html">HTML / Static</option><option disabled={!d.user.allowNode} value="node">Node.js</option><option disabled={!d.user.allowPython} value="python">Python</option></select></label><details><summary>Advanced commands</summary><label>Build command<input placeholder="Optional" value={build} onChange={e=>setBuild(e.target.value)}/></label><label>Start command<input placeholder="Optional" value={start} onChange={e=>setStart(e.target.value)}/></label></details>{err&&<div className="alert error">{err}</div>}<div className="modal-actions"><button className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={!name||busy} onClick={create}>{busy?"Creating…":"Create project"}</button></div></div></div>
}

function ProjectModal({p,onClose,onRefresh}){return <div className="modal-backdrop" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">PROJECT</span><h3>{p.name}</h3></div><button className="icon-btn" onClick={onClose}>×</button></div><div className="detail-grid"><div><small>Runtime</small><b>{p.runtime}</b></div><div><small>Created</small><b>{new Date(p.created_at).toLocaleDateString()}</b></div><div><small>Build command</small><b>{p.build_command||"Default"}</b></div><div><small>Start command</small><b>{p.start_command||"Default"}</b></div></div><div className="modal-actions"><button className="secondary" onClick={onClose}>Close</button></div></div></div>}

function Admin({me}){
 const [users,setUsers]=useState([]),[tab,setTab]=useState("users"),[form,setForm]=useState({username:"",password:"",days:30,storage:1073741824,maxProjects:5,maxDeployments:3,allowHtml:true,allowNode:false,allowPython:false});
 const load=()=>api("/api/admin/users").then(setUsers);
 useEffect(load,[]);
 const create=async()=>{try{await api("/api/admin/users",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...form,storageLimitBytes:form.storage,expiresAt:new Date(Date.now()+form.days*864e5).toISOString()})});setForm({...form,username:"",password:""});load()}catch(e){alert(e.message)}};
 const toggle=async u=>{await api(`/api/admin/users/${u.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:!u.enabled})});load()};
 const reset=async u=>{const password=prompt("New password (8+ chars)");if(password)try{await api(`/api/admin/users/${u.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({password})});load()}catch(e){alert(e.message)}};
 const del=async u=>{if(confirm(`Delete ${u.username}? This cannot be undone.`)){await api(`/api/admin/users/${u.id}`,{method:"DELETE"});load()}};
 return <Shell title="Admin console" active="settings" onNavigate={()=>{}} me={me}><div className="admin-hero"><div><span className="eyebrow">CONTROL CENTER</span><h1>Manage your hosting platform.</h1><p className="muted">Users, quotas, access policies and account lifecycle.</p></div><div className="admin-metrics"><b>{users.length}</b><small>users</small></div></div>
 <div className="admin-tabs"><button className={tab==="users"?"active":""} onClick={()=>setTab("users")}>{icons.users} Users</button><button className={tab==="create"?"active":""} onClick={()=>setTab("create")}>{icons.plus} Create user</button></div>
 {tab==="create"&&<section className="panel form-panel"><h3>Create user</h3><div className="form-grid"><label>Username<input value={form.username} onChange={e=>setForm({...form,username:e.target.value})}/></label><label>Password<input type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/></label><label>Days<input type="number" min="1" value={form.days} onChange={e=>setForm({...form,days:+e.target.value})}/></label><label>Storage<select value={form.storage} onChange={e=>setForm({...form,storage:+e.target.value})}>{[104857600,524288000,1073741824,2147483648,5368709120,10737418240].map(x=><option value={x} key={x}>{x/1073741824>=1?x/1073741824+" GB":x/1048576+" MB"}</option>)}</select></label><label>Max projects<input type="number" value={form.maxProjects} onChange={e=>setForm({...form,maxProjects:+e.target.value})}/></label><label>Max deployments<input type="number" value={form.maxDeployments} onChange={e=>setForm({...form,maxDeployments:+e.target.value})}/></label></div><div className="checks"><label><input type="checkbox" checked={form.allowHtml} onChange={e=>setForm({...form,allowHtml:e.target.checked})}/> HTML</label><label><input type="checkbox" checked={form.allowNode} onChange={e=>setForm({...form,allowNode:e.target.checked})}/> Node</label><label><input type="checkbox" checked={form.allowPython} onChange={e=>setForm({...form,allowPython:e.target.checked})}/> Python</label></div><button className="primary" onClick={create}>Create user</button></section>}
 {tab==="users"&&<section className="panel table-panel"><div className="panel-head"><div><h3>User directory</h3><p>Enable, disable, reset or remove accounts.</p></div><button className="primary" onClick={()=>setTab("create")}>+ Add user</button></div><div className="table">{users.map(u=><div className="tr" key={u.id}><span><b>{u.username}</b><small>{u.is_admin?"Administrator":"Member"} · {u.enabled?"Enabled":"Disabled"}</small></span><span className={u.enabled?"status running":"status stopped"}>{u.enabled?"Active":"Disabled"}</span><span>{u.expires_at?new Date(u.expires_at).toLocaleDateString():"Never"}</span><span className="row-actions"><button className="ghost" onClick={()=>toggle(u)}>{u.enabled?"Disable":"Enable"}</button>{!u.is_admin&&<><button className="ghost" onClick={()=>reset(u)}>Reset</button><button className="danger-outline" onClick={()=>del(u)}>Delete</button></>}</span></div>)}</div></section>}
 </Shell>
}

createRoot(document.getElementById("root")).render(<App/>);
