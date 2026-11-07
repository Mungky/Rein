"use client";
import { useEffect,useState } from "react";
import dynamic from "next/dynamic";
import { Plus,Loader2,Search } from "lucide-react";
import { PageGuard } from "@/components/guards/page-guard";
import { useAuth } from "@/hooks/use-auth";
import { workspaceApi } from "@/lib/api/workspace";
import { useWorkspaceStore } from "@/features/workspace/store";
import { ViewToggle } from "@/features/workspace/shared/view-toggle";
import { ProgressBar } from "@/features/workspace/shared/progress-bar";
import { StatusBadge } from "@/features/workspace/shared/status-badge";
import { useWorkspaceCapabilities } from "@/features/workspace/workspace-capabilities";
import { dateLabel,Empty } from "@/features/workspace/operations-ui";
import { ProjectActions } from "@/features/workspace/project-actions";
import { filterProjects,type ProjectCollection } from "@/features/workspace/project-lifecycle";
import { pageSlice } from "@/features/workspace/compact-list";
import { Pager } from "@/features/workspace/compact-ui";
import "@/features/workspace/workspace-mobile.css";
const Hub=dynamic(()=>import("@/features/workspace/project-hub").then(m=>m.ProjectHub));
const Calendar=dynamic(()=>import("@/features/workspace/calendar/calendar-view").then(m=>m.CalendarView));
const Create=dynamic(()=>import("@/features/workspace/shared/create-project-modal").then(m=>m.CreateProjectModal));
const Staffing=dynamic(()=>import("@/features/workspace/staffing-board").then(m=>m.StaffingBoard));
const Materials=dynamic(()=>import("@/features/workspace/materials-panel").then(m=>m.MaterialsPanel));
export default function WorkspacePage(){return <PageGuard permission="workspace:view"><Workspace/></PageGuard>;}
function Workspace(){
  const {profile,role,loading:authLoading}=useAuth(),p=useWorkspaceCapabilities(role),store=useWorkspaceStore();
  const [section,setSection]=useState("projects"),[collection,setCollection]=useState<ProjectCollection>("active"),[q,setQ]=useState(""),[page,setPage]=useState(0),[ready,setReady]=useState(false);
  const {loadProjects,selectProject}=store,profileId=profile?.id,archived=collection==="archived";
  const selected=store.projects.find(project=>project.id===store.selectedProjectId);
  const reload=()=>{void loadProjects(archived);};
  useEffect(()=>{const params=new URLSearchParams(window.location.search);void Promise.resolve().then(()=>{const value=params.get("collection");if(value==="archived"||value==="completed")setCollection(value);selectProject(params.get("project"));setReady(true);});},[selectProject]);
  useEffect(()=>{if(!ready||authLoading||!profileId)return;void loadProjects(archived);},[ready,authLoading,profileId,archived,loadProjects]);
  function open(id:string|null){store.selectProject(id);const params=new URLSearchParams();if(id)params.set("project",id);if(collection!=="active")params.set("collection",collection);window.history.replaceState(null,"",`/workspace${params.size?`?${params}`:""}`);setSection("projects");}
  function chooseCollection(value:ProjectCollection){setCollection(value);setPage(0);store.setView("list");const params=new URLSearchParams();if(value!=="active")params.set("collection",value);window.history.replaceState(null,"",`/workspace${params.size?`?${params}`:""}`);}
  if(!ready)return <Loader2 className="m-auto size-5 animate-spin text-primary"/>;
  if(selected)return <Hub key={selected.id} project={selected} permissions={p} userId={profile?.id} onBack={()=>{open(null);reload();}} onProjectChanged={reload}/>;
  const projects=filterProjects(store.projects,collection,q),slice=pageSlice(projects,page);
  return <div className="workspace-surface flex h-full min-h-0 min-w-0 flex-col overflow-hidden"><header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-soft px-3 py-2 sm:px-4"><h1 className="mr-auto text-sm font-bold sm:mr-1">Proyek</h1>{p.manage&&section==="projects"&&!archived&&<button onClick={()=>{void store.loadTemplates();store.setShowCreate(true);}} className="btn btn-primary btn-sm min-h-11 sm:order-last sm:ml-auto sm:min-h-8"><Plus className="size-3.5"/>Proyek Baru</button>}<nav aria-label="Area proyek" className="flex w-full gap-1 sm:w-auto">{[["projects","Proyek"],["staffing","Beban Kerja"],["warehouse","Gudang"]].map(([key,label])=><button key={key} aria-current={section===key?"page":undefined} className={`btn btn-sm min-h-11 flex-1 sm:min-h-8 sm:flex-none ${section===key?"btn-primary":"btn-ghost"}`} onClick={()=>setSection(key)}>{label}</button>)}</nav></header>
    {store.error&&<div role="alert" className="border-b border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{store.error}<button className="ml-3 underline" onClick={reload}>Coba lagi</button></div>}
    {section==="projects"&&<><div className="shrink-0 space-y-2 border-b border-border-soft px-3 py-2 sm:px-4"><nav aria-label="Status daftar proyek" className="flex gap-1 rounded-lg bg-bg-ctrl p-1 sm:w-fit">{([["active","Aktif"],["completed","Selesai"],["archived","Arsip"]] as const).map(([key,label])=><button key={key} aria-pressed={collection===key} onClick={()=>chooseCollection(key)} className={`btn btn-sm min-h-11 flex-1 sm:min-h-8 sm:flex-none ${collection===key?"border border-border bg-bg text-primary shadow-sm":"btn-ghost"}`}>{label}</button>)}</nav><div className="flex items-center gap-2"><label className="relative min-w-0 flex-1 sm:max-w-sm"><Search aria-hidden className="absolute left-3 top-3.5 size-3.5 text-text-muted sm:top-2.5"/><input aria-label="Cari proyek" value={q} onChange={e=>{setQ(e.target.value);setPage(0);}} placeholder="Cari RPO, proyek, klien…" className="field-input min-h-11 pl-9 sm:min-h-9"/></label>{!archived&&<ViewToggle value={store.view==="kanban"?"list":store.view} onChange={store.setView}/>}</div></div><div className="min-h-0 flex-1 overflow-auto">{store.loading?<Loader2 className="mx-auto my-14 size-6 animate-spin text-primary"/>:store.view==="calendar"&&!archived?<Calendar collection={collection} query={q} onBack={()=>{}}/>:!projects.length?<div className="p-6"><Empty>{archived?"Belum ada proyek di arsip.":collection==="completed"?"Belum ada proyek selesai. Pilih Kelola proyek → Tandai selesai ketika seluruh pekerjaan tuntas.":"Tidak ada proyek aktif yang sesuai."}</Empty></div>:<div className="divide-y divide-border-soft">{slice.items.map(project=><div key={project.id} className="flex items-center gap-1 pr-2 hover:bg-bg-hover sm:pr-3"><button onClick={()=>open(project.id)} className="flex min-w-0 flex-1 items-center gap-4 px-3 py-3 text-left sm:px-4"><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="max-w-28 truncate rounded bg-primary-soft px-1.5 py-0.5 font-mono text-[11px] font-bold text-primary" title={project.rpo_number??"Lengkapi RPO"}>{project.rpo_number??"Lengkapi RPO"}</span><StatusBadge status={project.status}/></div><h2 className="mt-1 truncate text-sm font-semibold">{project.name}</h2><p className="mb-2 mt-0.5 truncate text-xs text-text-muted">{project.client_name??"Klien belum diisi"}</p><ProgressBar value={project.progress}/><p className="mt-1.5 text-xs text-text-muted sm:hidden">Target {dateLabel(project.deadline)}</p></div><div className="hidden shrink-0 text-right text-xs text-text-muted sm:block"><p>{dateLabel(project.start_date)}</p><p className="mt-1">s/d {dateLabel(project.deadline)}</p></div></button><ProjectActions project={project} manage={p.manage} archive={p.archive} onChanged={reload}/></div>)}<div className="px-3 sm:px-4"><Pager total={slice.total} page={slice.page} onPage={setPage} scope="proyek"/></div></div>}</div></>}
    {section==="staffing"&&<div className="min-h-0 flex-1 overflow-auto p-3 sm:p-4"><Staffing api={workspaceApi} onOpenProject={open}/></div>}
    {section==="warehouse"&&<div className="min-h-0 flex-1 overflow-auto p-3 sm:p-4"><Materials api={workspaceApi} canPurchase={p.purchase} canWarehouse={p.warehouse}/></div>}
    {store.showCreate&&<Create templates={store.templates} onClose={()=>store.setShowCreate(false)} onCreated={()=>{store.setShowCreate(false);chooseCollection("active");void loadProjects(false);}}/>}
  </div>;
}
