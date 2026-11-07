"use client";
import { useEffect, useState } from "react";
import { createWorkspaceApi, type Project } from "@/lib/api/workspace";
import { ApiClient } from "@/lib/api/client";
import { ProjectHub } from "./project-hub";
import { OperationsDashboard } from "./operations-dashboard";
import { MaterialsPanel } from "./materials-panel";
import { StaffingBoard } from "./staffing-board";
const api=createWorkspaceApi(new ApiClient("http://127.0.0.1:8001",false));
const permissions={manage:true,createWo:true,execute:true,review:true,publish:true,approve:true,release:true,verify:true,warehouse:true,purchase:true,archive:true};
export function ProjectPreviewApp() {
  const [projects,setProjects]=useState<Project[]>([]),[selected,setSelected]=useState("22222222-2222-4222-8222-222222222222"),[tab,setTab]=useState("project"),[error,setError]=useState("");
  const load=()=>api.listProjects().then(setProjects).catch(()=>setError("API pengujian lokal belum berjalan"));
  useEffect(()=>{void api.listProjects().then(setProjects).catch(()=>setError("API pengujian lokal belum berjalan"));},[]);
  const project=projects.find(p=>p.id===selected);
  return <main className="flex h-screen flex-col bg-bg text-text"><div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-primary-soft px-4 py-2 text-xs"><strong>Pengujian lokal · komponen Workspace utama</strong><span className="flex-1" />{[["project","Proyek"],["dashboard","Dashboard"],["staffing","Beban Kerja"],["warehouse","Gudang"]].map(([key,label])=><button key={key} onClick={()=>setTab(key)} className={`btn btn-sm ${key===tab?"btn-primary":"btn-ghost"}`}>{label}</button>)}<select aria-label="Pilih proyek pengujian" value={selected} onChange={e=>setSelected(e.target.value)} className="field-input max-w-[220px]">{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></div><div className="min-h-0 flex-1">{error&&<p className="p-5 text-red-600">{error}</p>}{tab==="project"&&project&&<ProjectHub key={project.id} project={project} api={api} permissions={permissions} userId="11111111-1111-4111-8111-111111111111" onBack={()=>setTab("dashboard")} onProjectChanged={()=>void load()} />}{tab==="dashboard"&&<OperationsDashboard api={api} />}{tab==="staffing"&&<div className="h-full overflow-auto p-5"><StaffingBoard api={api} onOpenProject={id=>{setSelected(id);setTab("project");}} /></div>}{tab==="warehouse"&&<div className="h-full overflow-auto p-5"><MaterialsPanel api={api} canWarehouse canPurchase /></div>}</div></main>;
}
