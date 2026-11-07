"use client";
import { useCallback,useDeferredValue,useEffect,useMemo,useState } from "react";
import dynamic from "next/dynamic";
import { ArrowLeft,Loader2,RefreshCw,LayoutDashboard,ListTodo,CalendarDays,Files,Package,TriangleAlert,Users,History } from "lucide-react";
import { workspaceApi,type Project,type ProjectBoard,type BoardTask } from "@/lib/api/workspace";
import type { Coordination } from "@/lib/api/workspace-coordination";
import type { WorkOrderDetail } from "@/lib/api/workspace-logbook";
import { apiErrorText } from "@/lib/api/client";
import { Badge,Empty,dateLabel } from "./operations-ui";
import { StatusBadge } from "./shared/status-badge";
import { useVisibleRefresh } from "./use-visible-refresh";
import { workOrderLabel } from "./work-order-ui";
import { TASK_STATUSES } from "./constants";
import { AvatarGroup,Pager } from "./compact-ui";
import { filterWork,pageSlice,taskPeople,type TargetFilter } from "./compact-list";
import { WorkFilters } from "./work-filters";
import { ProjectActions } from "./project-actions";
import "./workspace-mobile.css";
import { calendarDate } from "./weekly-schedule";
const Timeline=dynamic(()=>import("./work-timeline").then(m=>m.WorkTimeline));
const WorkOrderDetailView=dynamic(()=>import("./work-order-detail").then(m=>m.WorkOrderDetail));
const WorkOrderFormFull=dynamic(()=>import("./work-order-form").then(m=>m.WorkOrderForm));
const Creator=dynamic(()=>import("./project-task-creator").then(m=>m.ProjectTaskCreator));
const Documents=dynamic(()=>import("./project-documents").then(m=>m.ProjectDocuments));
const Issues=dynamic(()=>import("./project-issues").then(m=>m.ProjectIssues));
const Materials=dynamic(()=>import("./project-material-list").then(m=>m.ProjectMaterialList));
const Team=dynamic(()=>import("./project-team").then(m=>m.ProjectTeam));
const Activity=dynamic(()=>import("./project-history").then(m=>m.ProjectHistory));
const Tools=dynamic(()=>import("./project-tools").then(m=>m.ProjectTools));
const EditProject=dynamic(()=>import("./shared/edit-project-modal").then(m=>m.EditProjectModal));
export interface WorkspaceCapabilities {manage:boolean;createWo:boolean;execute:boolean;review:boolean;publish:boolean;approve:boolean;release:boolean;verify:boolean;warehouse:boolean;purchase:boolean;archive:boolean}
const tabs=[["summary","Ringkasan",LayoutDashboard],["work","Work List",ListTodo],["timeline","Timeline",CalendarDays],["documents","Dokumen",Files],["materials","Material",Package],["blockers","Kendala",TriangleAlert],["team","Tim",Users],["history","Riwayat",History]] as const;

export function ProjectHub({project,api=workspaceApi,permissions:p,userId,onBack,onProjectChanged}:{project:Project;api?:typeof workspaceApi;permissions:WorkspaceCapabilities;userId?:string;onBack:()=>void;onProjectChanged:()=>void}) {
  const [board,setBoard]=useState<ProjectBoard|null>(null),[data,setData]=useState<Coordination|null>(null),[tab,setTab]=useState("summary"),[taskId,setTaskId]=useState<string|null>(null),[error,setError]=useState(""),[editing,setEditing]=useState(false),[toolsOpen,setToolsOpen]=useState(false);
  const [creatingWo,setCreatingWo]=useState(false),[editingWoTask,setEditingWoTask]=useState<{detail?:WorkOrderDetail;taskId:string}|null>(null);
  const [editingWoDetail,setEditingWoDetail]=useState<WorkOrderDetail|null>(null);
  const [loadingEditWo,setLoadingEditWo]=useState(false);
  const [query,setQuery]=useState(""),[status,setStatus]=useState(""),[pic,setPic]=useState(""),[target,setTarget]=useState<TargetFilter>(""),[page,setPage]=useState(0);
  const search=useDeferredValue(query),readOnly=!!project.archived_at,today=calendarDate(new Date().toISOString())!;
  const load=useCallback(async()=>{try{const [nextBoard,nextData]=await Promise.all([api.getBoard(project.id),api.coordination(project.id)]);setBoard(nextBoard);setData(nextData);setError("");}catch(err){setError(apiErrorText(err,"Proyek belum dapat dimuat"));}},[api,project.id]);
  useEffect(()=>{let active=true;void Promise.resolve().then(()=>{if(active)void load();});return()=>{active=false;};},[load]);
  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    const section=params.get("tab"),wo=params.get("wo"),action=params.get("wo_action");
    void Promise.resolve().then(()=>{
      if(section&&tabs.some(([key])=>key===section))setTab(section);
      if(action==="new")setCreatingWo(true);
      else if(action==="edit"&&wo){setEditingWoTask({taskId:wo});}
      else if(wo)setTaskId(wo);
    });
  },[project.id]);
  useEffect(()=>{
    if(!editingWoTask) return;
    let active=true;
    void Promise.resolve().then(()=>{if(active)setLoadingEditWo(true);});
    api.workOrderDetail(editingWoTask.taskId)
      .then(d=>{if(active){setEditingWoDetail(d);setLoadingEditWo(false);}})
      .catch(err=>{if(active){setError(apiErrorText(err,"WO tidak dapat dimuat"));setLoadingEditWo(false);setEditingWoTask(null);}});
    return()=>{active=false;};
  },[api,editingWoTask]);
  useVisibleRefresh(load,!taskId&&!editing&&!creatingWo&&!editingWoTask);
  const tasks=useMemo(()=>board?.tasks??[],[board]),activeTask=tasks.find(task=>task.id===taskId);
  const filtered=useMemo(()=>filterWork(tasks,search,pic,target,today,status),[tasks,search,pic,target,today,status]);
  const slice=pageSlice(filtered,page);
  const changed=()=>{void load();};
  function taskTable(items:BoardTask[]) {
    return <div className="overflow-x-auto rounded-lg border border-border bg-bg"><table data-mobile-table="work" className="w-full min-w-[540px] text-left text-xs"><thead className="bg-bg-ctrl/60 text-text-muted"><tr>{["Work Order","PIC","Status","Target"].map(label=><th key={label} className="px-3 py-2 font-medium">{label}</th>)}</tr></thead><tbody>{items.map(task=><tr key={task.id} className="border-t border-border-soft hover:bg-bg-hover"><td data-label="" className="max-w-[600px] px-3 py-1.5"><button title={workOrderLabel(task)} onClick={()=>setTaskId(task.id)} className="min-h-11 w-full text-left font-medium hover:text-primary sm:min-h-7"><span className="line-clamp-1">{workOrderLabel(task)}</span></button></td><td data-label="PIC" className="w-24 px-3 py-1.5"><AvatarGroup people={taskPeople(task)}/></td><td data-label="Status" className="w-28 whitespace-nowrap px-3 py-1.5"><StatusBadge status={task.status}/></td><td data-label="Target" className={`w-32 whitespace-nowrap px-3 py-1.5 ${task.deadline&&task.deadline<today&&!["done","cancelled"].includes(task.status)?"text-red-600":"text-text-muted"}`}>{task.deadline?dateLabel(task.deadline):"—"}</td></tr>)}</tbody></table>{!items.length&&<Empty>Tidak ada WO yang sesuai.</Empty>}</div>;
  }
  return <div className="workspace-surface flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-bg"><header className="grid shrink-0 grid-cols-[36px_minmax(0,1fr)] items-center gap-2 border-b border-border-soft px-3 py-2.5 sm:flex sm:gap-3 sm:px-4"><button aria-label="Kembali ke daftar proyek" className="btn btn-ghost btn-icon min-h-11 min-w-9 sm:min-h-7 sm:min-w-7" onClick={onBack}><ArrowLeft className="size-4"/></button><div className="min-w-0 flex-1"><div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5"><h1 className="truncate text-base font-semibold">{project.name}</h1><span className="text-[11px] text-primary">{project.rpo_number??"RPO belum diisi"}</span>{project.status==="completed"&&<Badge tone="good">Selesai</Badge>}{readOnly&&<Badge>Arsip</Badge>}</div><p className="mt-0.5 truncate text-[11px] text-text-muted">{project.client_name} · {dateLabel(project.start_date)} – {dateLabel(project.deadline)}</p></div><div className="col-span-2 flex items-center justify-end gap-1 sm:ml-auto">{p.createWo&&!readOnly&&<Creator api={api} projectId={project.id} canManagePhases={p.manage} onOpenCreate={()=>setCreatingWo(true)} onCreated={()=>{setTab("work");changed();}}/>}<ProjectActions label project={project} api={api} manage={p.manage} archive={p.archive} onEdit={()=>setEditing(true)} onChanged={action=>{onProjectChanged();if(["archive","restore","delete"].includes(action))onBack();}}/><button aria-label="Muat ulang proyek" title="Muat ulang" className="btn btn-ghost btn-icon min-h-11 min-w-9 sm:min-h-7 sm:min-w-7" onClick={changed}><RefreshCw className="size-3.5"/></button></div></header>
    <label className="flex shrink-0 items-center gap-3 border-b border-border-soft px-3 py-2 sm:hidden"><span className="text-xs text-text-muted">Halaman</span><select aria-label="Halaman proyek" className="field-input min-h-11 min-w-0 flex-1" value={tab} onChange={e=>setTab(e.target.value)}>{tabs.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><nav aria-label="Bagian proyek" className="hidden sm:flex shrink-0 gap-4 overflow-x-auto border-b border-border-soft px-3 sm:px-4">{tabs.map(([key,label,Icon])=><button key={key} aria-current={tab===key?"page":undefined} onClick={()=>setTab(key)} className={`flex min-h-11 shrink-0 items-center gap-1.5 border-b-2 text-xs font-medium sm:min-h-9 ${tab===key?"border-primary text-primary":"border-transparent text-text-muted hover:text-text"}`}><Icon aria-hidden className="size-3.5"/>{label}</button>)}</nav>
    <div className="min-h-0 flex-1 overflow-y-auto bg-bg-ctrl/20 p-3 sm:p-4">{error&&<div role="alert" className="mb-3 rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}<button onClick={changed} className="ml-2 underline">Coba lagi</button></div>}{(!board||!data)&&!error&&<Loader2 className="mx-auto my-10 size-5 animate-spin text-primary"/>}{board&&data&&<>
      {tab==="summary"&&<div className="space-y-4"><div className="flex flex-wrap gap-2">{TASK_STATUSES.map(key=><button key={key} onClick={()=>{setStatus(key);setQuery("");setPic("");setTarget("");setPage(0);setTab("work");}} className="flex items-center gap-3 rounded-lg border border-border bg-bg px-3 py-2 hover:border-primary/40"><StatusBadge status={key}/><span className="text-sm font-semibold tabular-nums">{tasks.filter(task=>(task.status==="overdue"?"todo":task.status)===key).length}</span></button>)}</div><div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_220px]"><section className="min-w-0 space-y-2"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Pekerjaan aktif</h2><button className="btn btn-ghost btn-sm text-primary" onClick={()=>{setStatus("");setQuery("");setPic("");setTarget("");setPage(0);setTab("work");}}>Semua WO</button></div>{taskTable(tasks.filter(task=>!["done","cancelled"].includes(task.status)).slice(0,8))}</section><aside className="space-y-2"><h2 className="py-2 text-sm font-semibold">Proyek</h2>{[["Kendala aktif",data.issues.filter(issue=>issue.kind==="blocker"&&issue.status!=="verified").length,"blockers"],["Dokumen",data.documents.filter(doc=>doc.current).length,"documents"],["Anggota tim",data.members.length,"team"]].map(([label,count,section])=><button key={label} onClick={()=>setTab(String(section))} className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-border bg-bg px-3 py-2 text-xs hover:border-primary/40"><span className="text-text-muted">{label}</span><span className="font-semibold tabular-nums">{count}</span></button>)}</aside></div></div>}
      {tab==="work"&&<section className="space-y-3"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Work List <span className="ml-1 text-xs font-normal text-text-muted">{filtered.length.toLocaleString("id-ID")} WO</span></h2></div><WorkFilters tasks={tasks} query={query} pic={pic} target={target} status={status} onQuery={value=>{setQuery(value);setPage(0);}} onPic={value=>{setPic(value);setPage(0);}} onTarget={value=>{setTarget(value);setPage(0);}} onStatus={value=>{setStatus(value);setPage(0);}}/>{taskTable(slice.items)}<Pager total={filtered.length} page={slice.page} onPage={setPage} scope="work list"/></section>}
      {tab==="timeline"&&<Timeline tasks={tasks} data={data} api={api} onOpen={setTaskId} onChanged={load}/>}
      {tab==="documents"&&<Documents api={api} projectId={project.id} data={data} tasks={tasks} userId={readOnly?undefined:userId} canPublish={p.publish&&!readOnly} onOpenTask={setTaskId} onChanged={changed}/>}
      {tab==="materials"&&<Materials api={api} projectId={project.id} tasks={tasks} revision={board.version} canPurchase={p.purchase} canWarehouse={p.warehouse} canManage={p.manage} userId={userId} readOnly={readOnly} onOpenTask={setTaskId} onChanged={changed}/>}
      {tab==="blockers"&&<Issues api={api} projectId={project.id} data={data} tasks={tasks} kind="blocker" userId={userId} canVerify={p.verify} readOnly={readOnly} onOpenTask={setTaskId} onChanged={changed}/>}
      {tab==="team"&&<Team api={api} projectId={project.id} data={data} canManage={p.manage&&!readOnly} onChanged={changed} onOpenTask={setTaskId}/>}
      {tab==="history"&&<div className="space-y-3"><Activity api={api} projectId={project.id} revision={board.version} onOpenTask={setTaskId}/><details className="rounded-lg border border-border bg-bg" onToggle={event=>setToolsOpen(event.currentTarget.open)}><summary className="cursor-pointer px-3 py-2 text-xs font-medium">Alat proyek & laporan</summary>{toolsOpen&&<Tools api={api} projectId={project.id} operationalMode canManage={p.manage&&!readOnly} onChanged={changed}/>}</details></div>}
    </>}</div>{activeTask&&<WorkOrderDetailView key={activeTask.id} api={api} taskId={activeTask.id} onEdit={()=>{setTaskId(null);setEditingWoTask({taskId:activeTask.id});}} onNavigate={section=>{setTaskId(null);setTab(section);changed();}} onChanged={changed} onClose={()=>{setTaskId(null);changed();}}/>}{editing&&<EditProject api={api} project={project} onClose={()=>setEditing(false)} onUpdated={()=>{setEditing(false);onProjectChanged();}}/>}
    {creatingWo&&<div className="fixed inset-0 z-[110] bg-bg"><WorkOrderFormFull api={api} projectId={project.id} projectName={project.name} fullPage onClose={()=>setCreatingWo(false)} onSaved={()=>{setCreatingWo(false);setTab("work");changed();}}/></div>}
    {editingWoTask&&loadingEditWo&&<div className="fixed inset-0 z-[110] flex items-center justify-center bg-bg"><Loader2 className="size-6 animate-spin text-primary" /></div>}
    {editingWoTask&&editingWoDetail&&<div className="fixed inset-0 z-[110] bg-bg"><WorkOrderFormFull api={api} projectId={project.id} projectName={project.name} existing={editingWoDetail} fullPage onClose={()=>setEditingWoTask(null)} onSaved={()=>{setEditingWoTask(null);changed();}}/></div>}
  </div>;
}
