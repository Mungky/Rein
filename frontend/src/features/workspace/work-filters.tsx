"use client";
import { useMemo, useState } from "react";
import { Search,SlidersHorizontal } from "lucide-react";
import type { BoardTask } from "@/lib/api/workspace";
import { taskPeople, type TargetFilter } from "./compact-list";
import { STATUS_LABEL, TASK_STATUSES } from "./constants";
import { workOrderLabel } from "./work-order-ui";

export function WorkOrderSelect({tasks,name="task",defaultValue="",allowNone=true}:{tasks:BoardTask[];name?:string;defaultValue?:string;allowNone?:boolean}) {
  const [query,setQuery]=useState(""),[value,setValue]=useState(defaultValue||(!allowNone?tasks[0]?.id??"":""));
  const matches=tasks.filter(task=>workOrderLabel(task).toLowerCase().includes(query.trim().toLowerCase()));
  const options=matches.slice(0,50),selected=tasks.find(task=>task.id===value);
  if(selected&&!options.some(task=>task.id===selected.id))options.unshift(selected);
  return <span className="block space-y-1">{tasks.length>30&&<input aria-label="Cari pilihan Work Order" value={query} onChange={e=>setQuery(e.target.value)} className="field-input min-h-8 py-1 text-xs" placeholder="Cari nomor / pekerjaan…"/>}<select aria-label="Work Order" name={name} value={value} onChange={e=>setValue(e.target.value)} className="field-input min-h-9 py-1.5 text-xs">{allowNone&&<option value="">Seluruh proyek / belum di-assign</option>}{options.map(task=><option key={task.id} value={task.id}>{workOrderLabel(task)}</option>)}</select>{matches.length>50&&<span className="block text-xs font-normal text-text-muted">Ketik untuk mencari dari {tasks.length.toLocaleString("id-ID")} WO.</span>}</span>;
}

export function WorkFilters({tasks,query,pic,target,status,onQuery,onPic,onTarget,onStatus}:{tasks:BoardTask[];query:string;pic:string;target:TargetFilter;status?:string;onQuery:(value:string)=>void;onPic:(value:string)=>void;onTarget:(value:TargetFilter)=>void;onStatus?:(value:string)=>void}) {
  const [showFilters,setShowFilters]=useState(false);
  const activeFilters=[pic,target,status].filter(Boolean).length;
  const people=useMemo(()=>[...new Map(tasks.flatMap(taskPeople).map(person=>[person.id,person])).values()].sort((a,b)=>a.name.localeCompare(b.name)),[tasks]);
  return <div className="flex flex-wrap items-center gap-2"><label className="relative min-w-0 flex-1 sm:max-w-sm"><Search aria-hidden className="absolute left-2.5 top-3 size-3.5 text-text-muted sm:top-2.5"/><input aria-label="Cari WO" value={query} onChange={e=>onQuery(e.target.value)} placeholder="Cari WO, pekerjaan, komponen…" className="field-input min-h-11 py-2 pl-8 text-sm sm:min-h-8 sm:py-1.5"/></label><button type="button" aria-expanded={showFilters} onClick={()=>setShowFilters(!showFilters)} className="btn btn-default min-h-11 sm:hidden"><SlidersHorizontal className="size-4"/>Filter{activeFilters?` (${activeFilters})`:""}</button><div className={`${showFilters?"grid":"hidden"} w-full grid-cols-2 gap-2 sm:contents`}>{onStatus&&<select aria-label="Filter status WO" value={status??""} onChange={e=>onStatus(e.target.value)} className="field-input min-h-11 w-auto py-2 text-xs sm:min-h-8 sm:py-1.5"><option value="">Semua status</option>{TASK_STATUSES.map(key=><option key={key} value={key}>{STATUS_LABEL[key]}</option>)}</select>}<select aria-label="Filter PIC WO" value={pic} onChange={e=>onPic(e.target.value)} className="field-input min-h-11 w-auto max-w-[190px] py-2 text-xs sm:min-h-8 sm:py-1.5"><option value="">Semua PIC</option>{people.map(person=><option key={person.id} value={person.id}>{person.name}</option>)}</select><select aria-label="Filter target WO" value={target} onChange={e=>onTarget(e.target.value as TargetFilter)} className="field-input min-h-11 w-auto py-2 text-xs sm:min-h-8 sm:py-1.5"><option value="">Semua target</option><option value="late">Lewat target</option><option value="week">Minggu ini</option><option value="month">Bulan ini</option><option value="unscheduled">Belum dijadwalkan</option></select></div></div>;
}
