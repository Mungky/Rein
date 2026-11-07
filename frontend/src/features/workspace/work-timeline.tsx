"use client";
import { useMemo, useState, useDeferredValue } from "react";
import { createPortal } from "react-dom";
import { DndContext, DragOverlay, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { CalendarDays, ChevronLeft, ChevronRight, Columns3, GripVertical, X } from "lucide-react";
import { workspaceApi, type BoardTask, type TaskStatus } from "@/lib/api/workspace";
import type { Coordination } from "@/lib/api/workspace-coordination";
import { apiErrorText } from "@/lib/api/client";
import { STATUS_LABEL, TASK_STATUSES } from "./constants";
import { StatusBadge } from "./shared/status-badge";
import { ActionForm, Empty, Field, textValue } from "./operations-ui";
import { addDays, calendarDate, shortDate } from "./weekly-schedule";
import { timelineRange, type TimelineScale } from "./timeline-range";
import { AvatarGroup, Pager } from "./compact-ui";
import { compactTarget, filterWork, pageSlice, taskPeople, type TargetFilter } from "./compact-list";
import { WorkFilters } from "./work-filters";
import { workOrderLabel } from "./work-order-ui";

interface Props { tasks:BoardTask[]; data:Coordination; api?:typeof workspaceApi; onOpen:(id:string)=>void; onChanged:()=>Promise<void> }
export function WorkTimeline({tasks,data,api=workspaceApi,onOpen,onChanged}:Props) {
  const [mode,setMode]=useState<"kanban"|"bar">("kanban"),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const [activeId,setActiveId]=useState<string|null>(null);
  const activeTask=tasks.find(task=>task.id===activeId);
  const [cancel,setCancel]=useState<BoardTask|null>(null),[message,setMessage]=useState("");
  const sensors=useSensors(useSensor(PointerSensor));
  const [mobileStatus,setMobileStatus]=useState<TaskStatus>("todo");
  const [query,setQuery]=useState(""),[pic,setPic]=useState(""),[target,setTarget]=useState<TargetFilter>("");
  const search=useDeferredValue(query),today=calendarDate(new Date().toISOString())!;
  const filtered=useMemo(()=>filterWork(tasks,search,pic,target,today),[tasks,search,pic,target,today]);
  async function update(task:BoardTask,status:TaskStatus,note="") {
    if(busy)return;
    if(!task.updated_at||!task.allowed_statuses?.includes(status)){setError("Perubahan status ini belum tersedia. Buka WO untuk melihat tindakan sesuai role Anda.");return;}
    if(status==="cancelled"&&!note){setCancel(task);return;}
    setBusy(true);setError("");setMessage("");
    try{await api.setWorkOrderStatus(task.id,{status,note,expected_updated_at:task.updated_at});await onChanged();setMessage(`${workOrderLabel(task)} masuk ${STATUS_LABEL[status]}.`);setCancel(null);}
    catch(err){setError(apiErrorText(err,"Status belum tersimpan"));await onChanged();throw err;}
    finally{setBusy(false);}
  }
  function drop(event:DragEndEvent) {
    setActiveId(null);
    const task=tasks.find(t=>t.id===event.active.id),target=String(event.over?.id??"") as TaskStatus;
    if(task&&TASK_STATUSES.some(s=>s===target)&&(task.status==="overdue"?"todo":task.status)!==target)void update(task,target).catch(()=>{});
  }
  return <section className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">Timeline <span className="ml-1 text-xs font-normal text-text-muted">{filtered.length.toLocaleString("id-ID")} WO</span></h2><div className="inline-flex gap-1 rounded-lg border border-border p-0.5">{([["bar","Bar waktu",CalendarDays],["kanban","Kanban",Columns3]] as const).map(([key,label,Icon])=><button key={key} aria-pressed={mode===key} onClick={()=>setMode(key)} className={`btn btn-sm min-h-11 sm:min-h-7 ${mode===key?"btn-primary":"btn-ghost"}`}><Icon className="size-3.5"/>{label}</button>)}</div></div>
    <WorkFilters tasks={tasks} query={query} pic={pic} target={target} onQuery={setQuery} onPic={setPic} onTarget={setTarget}/>
    {error&&<p role="alert" className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}
    {(busy||message)&&<p role="status" className="text-xs text-primary">{busy?"Menyimpan status…":message}</p>}
    {mode==="kanban"&&<nav aria-label="Status Kanban mobile" className="flex gap-2 overflow-x-auto pb-1 sm:hidden">{TASK_STATUSES.map(status=><button key={status} type="button" aria-pressed={mobileStatus===status} onClick={()=>setMobileStatus(status)} className={`btn btn-sm min-h-11 shrink-0 ${mobileStatus===status?"btn-primary":"btn-default"}`}>{STATUS_LABEL[status]}<span className="ml-1 tabular-nums">{filtered.filter(t=>(t.status==="overdue"?"todo":t.status)===status).length}</span></button>)}</nav>}
    {mode==="bar"?<TimeBars tasks={filtered} data={data} onOpen={onOpen}/>:<DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={event=>setActiveId(String(event.active.id))} onDragCancel={()=>setActiveId(null)} onDragEnd={drop} accessibility={{screenReaderInstructions:{draggable:"Geser pegangan kartu untuk mengubah status. Dengan keyboard buka WO untuk memperbarui status."}}}><div role="region" aria-label="Kanban berdasarkan status pekerjaan" tabIndex={0} className="overflow-x-auto pb-1"><div className="flex min-w-0 gap-3 sm:min-w-[1140px]">{TASK_STATUSES.map(status=><StatusColumn key={`${status}:${search}:${pic}:${target}`} status={status} mobileVisible={mobileStatus===status} tasks={filtered.filter(t=>(t.status==="overdue"?"todo":t.status)===status)} busy={busy} onOpen={onOpen}/>)}</div></div>{typeof document!=="undefined"&&createPortal(<DragOverlay dropAnimation={null}>{activeTask&&<div className="pointer-events-none rounded-lg border border-primary bg-bg p-2.5 shadow-lg"><p className="line-clamp-2 text-[13px] font-medium leading-5">{workOrderLabel(activeTask)}</p><div className="mt-2 flex items-center justify-between gap-2"><span className="text-xs text-text-muted">{activeTask.deadline?compactTarget(activeTask.deadline):"—"}</span><AvatarGroup people={taskPeople(activeTask)}/></div></div>}</DragOverlay>,document.body)}</DndContext>}
    {cancel&&<div className="modal-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="cancel-wo-title" className="modal-panel w-full max-w-md p-5"><div className="flex items-start justify-between gap-3"><h3 id="cancel-wo-title" className="text-base font-bold">Batalkan {workOrderLabel(cancel)}</h3><button className="btn btn-ghost btn-icon" aria-label="Tutup pembatalan" onClick={()=>setCancel(null)}><X className="size-4" /></button></div><p className="my-4 text-sm text-text-muted">Riwayat dan lampiran tetap tersimpan. Alasan pembatalan akan terlihat oleh tim.</p><ActionForm submitLabel="Konfirmasi pembatalan" onSubmit={f=>update(cancel,"cancelled",textValue(f,"note"))}><Field label="Alasan pembatalan"><textarea name="note" required maxLength={2000} className="field-input" rows={3}/></Field></ActionForm></section></div>}
  </section>;
}

function StatusColumn({status,tasks,busy,onOpen,mobileVisible}:{status:TaskStatus;tasks:BoardTask[];busy:boolean;onOpen:(id:string)=>void;mobileVisible:boolean}) {
  const [page,setPage]=useState(0),slice=pageSlice(tasks,page,20);
  const {setNodeRef,isOver}=useDroppable({id:status});
  return <section ref={setNodeRef} aria-label={STATUS_LABEL[status]} className={`${mobileVisible?"block":"hidden sm:block"} min-w-0 flex-1 rounded-lg border p-2 sm:min-w-[220px] ${isOver?"border-primary bg-primary/10":"border-border-soft bg-bg-ctrl/50"}`}><header className="mb-2 flex items-center justify-between gap-2 px-1 py-1"><span className="flex items-center gap-2"><StatusBadge status={status}/><span className="text-xs tabular-nums text-text-muted">{tasks.length.toLocaleString("id-ID")}</span></span><Pager small scope={STATUS_LABEL[status]} total={tasks.length} page={slice.page} size={20} onPage={setPage}/></header><div className="min-h-32 space-y-2 pr-0.5 sm:max-h-[calc(100dvh-330px)] sm:overflow-y-auto">{slice.items.map(task=><JobCard key={task.id} task={task} busy={busy} onOpen={onOpen}/>)}{!tasks.length&&<p className="py-6 text-center text-xs text-text-muted">Belum ada WO</p>}</div></section>;
}
function JobCard({task,busy,onOpen}:{task:BoardTask;busy:boolean;onOpen:(id:string)=>void}) {
  const allowed=task.allowed_statuses??[];
  const {setNodeRef,attributes,listeners,isDragging}=useDraggable({id:task.id,disabled:busy||!allowed.length});
  return <article ref={setNodeRef} style={{opacity:isDragging?0.3:1}} className={`group rounded-lg border border-border bg-bg p-2.5 ${isDragging?"opacity-70":""}`}><div className="flex items-start gap-1"><button title={workOrderLabel(task)} onClick={()=>onOpen(task.id)} className="min-h-11 min-w-0 flex-1 text-left text-[13px] font-medium leading-5 hover:text-primary sm:min-h-8"><span className="line-clamp-2">{workOrderLabel(task)}</span></button>{!!allowed.length&&<button {...attributes} {...listeners} aria-label={`Geser ${workOrderLabel(task)}`} className="hidden min-h-11 min-w-8 touch-none sm:flex items-center justify-center rounded text-text-muted hover:bg-bg-hover sm:min-h-6 sm:min-w-5"><GripVertical className="size-3.5"/></button>}</div><div className="mt-2 flex items-center justify-between gap-2"><span className="inline-flex items-center gap-1 text-xs text-text-muted" title={task.deadline?`Target ${shortDate(task.deadline)}`:"Belum dijadwalkan"}><CalendarDays aria-hidden className="size-3"/>{task.deadline?compactTarget(task.deadline):"—"}</span><AvatarGroup people={taskPeople(task)}/></div></article>;
}

function TimeBars({tasks,data,onOpen}:Pick<Props,"tasks"|"data"|"onOpen">) {
  const [page,setPage]=useState(0);
  const [scale,setScale]=useState<TimelineScale>("month"),[anchor,setAnchor]=useState(calendarDate(new Date().toISOString())!);
  const controls=useMemo(()=>new Map(data.controls.map(control=>[control.task_id,control])),[data.controls]);
  const rows=useMemo(()=>tasks.map(task=>{
    const control=controls.get(task.id);
    const end=calendarDate(control?.planned_end??task.deadline);
    const start=calendarDate(control?.planned_start)??(end?addDays(end,-Math.max(0,(task.estimated_days??1)-1)):null);
    return {task,start,end};
  }).filter((row):row is {task:BoardTask;start:string;end:string}=>!!row.start&&!!row.end).sort((a,b)=>a.start.localeCompare(b.start)),[tasks,controls]);
  if(!rows.length)return <Empty>Isi tanggal mulai dan selesai di WO untuk menampilkan bar waktu.</Empty>;
  const range=timelineRange(scale,anchor,rows),min=range.start,max=range.end;
  const visible=rows.filter(row=>row.end>=min&&row.start<=max),slice=pageSlice(visible,page);
  function navigate(delta:number){if(scale==="week")setAnchor(addDays(anchor,delta*7));else {const value=new Date(`${anchor.slice(0,7)}-01T00:00:00Z`);value.setUTCMonth(value.getUTCMonth()+delta);setAnchor(value.toISOString().slice(0,10));}}
  const day=(value:string)=>Date.parse(`${value}T00:00:00Z`)/86400000;
  const length=Math.max(1,day(max)-day(min)+1),step=Math.max(1,Math.ceil(length/8));
  const ticks=Array.from({length:Math.ceil(length/step)},(_,i)=>i*step);
  return <div className="space-y-2"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-medium">{shortDate(min)} {min.slice(0,4)} – {shortDate(max)} {max.slice(0,4)}</p><div className="flex flex-wrap items-center gap-2"><select aria-label="Skala waktu" value={scale} onChange={e=>{setScale(e.target.value as TimelineScale);setPage(0);}} className="field-input min-h-8 w-auto py-1 text-xs"><option value="week">Minggu</option><option value="month">Bulan</option><option value="all">Seluruh jadwal</option></select>{scale!=="all"&&<><button aria-label="Rentang sebelumnya" className="btn btn-default btn-icon min-h-10" onClick={()=>navigate(-1)}><ChevronLeft className="size-4"/></button><button className="btn btn-default min-h-10" onClick={()=>setAnchor(calendarDate(new Date().toISOString())!)}>Hari ini</button><button aria-label="Rentang berikutnya" className="btn btn-default btn-icon min-h-10" onClick={()=>navigate(1)}><ChevronRight className="size-4"/></button></>}</div></div>{!visible.length&&<div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-bg p-4 text-sm"><p className="text-text-muted">Tidak ada jadwal pada rentang ini.</p><button className="btn btn-default btn-sm" onClick={()=>setScale("all")}>Lihat seluruh jadwal</button></div>}<div className="overflow-x-auto rounded-xl border border-border bg-bg" role="region" aria-label="Bar timeline berdasarkan tanggal" tabIndex={0}><div className="min-w-[850px]"><div className="grid grid-cols-[230px_1fr] border-b border-border bg-bg-ctrl/50"><p className="sticky left-0 z-10 bg-bg px-3 py-2 text-xs font-semibold text-text-muted">Work Order / PIC</p><div className="relative h-9">{ticks.map(tick=><span key={tick} style={{left:`${tick/length*100}%`}} className="absolute top-2 whitespace-nowrap px-1 text-[11px] text-text-muted">{shortDate(addDays(min,tick))}</span>)}</div></div>{slice.items.map(({task,start,end})=><div key={task.id} className="grid grid-cols-[230px_1fr] border-b border-border-soft last:border-0"><button title={workOrderLabel(task)} className="sticky left-0 z-10 flex min-h-11 items-center justify-between gap-2 bg-bg px-3 py-2 text-left hover:bg-bg-hover" onClick={()=>onOpen(task.id)}><span className="line-clamp-1 min-w-0 flex-1 text-xs font-medium">{workOrderLabel(task)}</span><AvatarGroup people={taskPeople(task)} max={2}/></button><div className="relative min-h-11">{ticks.map(tick=><span key={tick} style={{left:`${tick/length*100}%`}} className="absolute inset-y-0 border-l border-border-soft"/>)}<button onClick={()=>onOpen(task.id)} aria-label={`${workOrderLabel(task)}, ${shortDate(start)} sampai ${shortDate(end)}, ${STATUS_LABEL[task.status]}`} title={`${shortDate(start)} – ${shortDate(end)} · ${STATUS_LABEL[task.status]}`} style={{left:`${(day(start<min?min:start)-day(min))/length*100}%`,width:`${(day(end>max?max:end)-day(start<min?min:start)+1)/length*100}%`}} className={`absolute top-2.5 flex h-6 min-w-3 items-center overflow-hidden rounded border px-1.5 text-left text-[10px] font-semibold ${task.status==="done"?"border-green-400/50 bg-green-100 text-green-800":task.status==="cancelled"?"border-red-300 bg-red-50 text-red-700":task.status==="pending_review"?"border-amber-300 bg-amber-50 text-amber-800":"border-primary/30 bg-primary/15 text-primary"}`}><span className="truncate">{STATUS_LABEL[task.status]}</span></button></div></div>)}</div></div><Pager total={visible.length} page={slice.page} onPage={setPage} scope="bar timeline"/>{tasks.length>rows.length&&<p className="text-xs text-text-muted">{tasks.length-rows.length} WO belum dijadwalkan.</p>}</div>;
}
