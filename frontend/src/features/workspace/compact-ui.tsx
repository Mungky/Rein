"use client";
import { useEffect,useRef,useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { personInitials } from "./compact-list";

export interface Person {id?:string;name:string;avatar_url?:string|null;inactive?:boolean}
export function PersonAvatar({person,size=26}:{person:Person;size?:number}) {
  const [failed,setFailed]=useState<string|null>(null);
  const raw=person.avatar_url;
  const url=raw&&/^(https?:\/\/|data:image\/|\/(?!\/))/.test(raw)?raw:null;
  const label=person.inactive?`${person.name} (Sudah tidak bekerja)`:person.name;
  return <span title={label} role="img" aria-label={label} style={{width:size,height:size}} className={`relative inline-flex shrink-0 items-center justify-center rounded-full align-middle text-[10px] font-semibold ${person.inactive?"border-2 border-red-500 bg-red-50 text-red-700 ring-2 ring-red-500/30":"border border-bg bg-primary/10 text-primary"}`}><span className="relative flex size-full items-center justify-center overflow-hidden rounded-full">{url&&failed!==url?<Image src={url} alt="" fill sizes={`${size}px`} unoptimized className="object-cover" onError={()=>setFailed(url)}/>:personInitials(person.name)}</span>{person.inactive&&<span aria-hidden className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border border-white bg-red-600" />}</span>;
}
export function AvatarGroup({people,max=3}:{people:Person[];max?:number}) {
  return <span className="inline-flex shrink-0 items-center -space-x-1.5" title={people.map(p=>p.inactive?`${p.name} (Sudah tidak bekerja)`:p.name).join(", ")}>{people.slice(0,max).map((person,i)=><PersonAvatar key={person.id??`${person.name}-${i}`} person={person}/>)}{people.length>max&&<span role="img" aria-label={`${people.length-max} PIC lainnya: ${people.slice(max).map(p=>p.name).join(", ")}`} className="inline-flex size-[26px] items-center justify-center rounded-full border border-bg bg-bg-ctrl text-[10px] font-semibold text-text-muted">+{people.length-max}</span>}{!people.length&&<span className="text-xs text-text-muted">—</span>}</span>;
}
export function Pager({total,page,size=25,onPage,scope="daftar",small=false}:{total:number;page:number;size?:number;onPage:(page:number)=>void;scope?:string;small?:boolean}) {
  const pages=Math.max(1,Math.ceil(total/size)),index=Math.max(0,Math.min(page,pages-1));
  if(total<=size)return small?null:<p className="text-xs text-text-muted">{total.toLocaleString("id-ID")} hasil</p>;
  return <div className={`relative flex items-center justify-between gap-2 text-xs text-text-muted ${small?"":"py-2"}`}><span className={small?"sr-only sm:not-sr-only":undefined}>{small?`${index+1}/${pages}`:`${index*size+1}–${Math.min((index+1)*size,total)} dari ${total.toLocaleString("id-ID")}`}</span><div className="flex items-center gap-1"><button type="button" aria-label={`Halaman sebelumnya ${scope}`} disabled={!index} onClick={()=>onPage(index-1)} className="btn btn-ghost btn-icon min-h-11 min-w-11 sm:min-h-7 sm:min-w-7"><ChevronLeft className="size-3.5"/></button><button type="button" aria-label={`Halaman berikutnya ${scope}`} disabled={index>=pages-1} onClick={()=>onPage(index+1)} className="btn btn-ghost btn-icon min-h-11 min-w-11 sm:min-h-7 sm:min-w-7"><ChevronRight className="size-3.5"/></button></div></div>;
}
export function CompactModal({title,onClose,children,wide=false}:{title:string;onClose:()=>void;children:React.ReactNode;wide?:boolean}) {
  const previous=useRef<HTMLElement|null>(typeof document!=="undefined"?document.activeElement as HTMLElement:null);
  useEffect(()=>()=>previous.current?.focus(),[]);
  return <div className="modal-backdrop workspace-dialog" onKeyDown={e=>{if(e.key==="Escape")onClose();if(e.key==="Tab"){const items=[...e.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex="0"]')].filter(el=>el.offsetParent!==null);const first=items[0],last=items[items.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}}} onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><section role="dialog" aria-modal="true" aria-label={title} className={`modal-panel flex max-h-[90dvh] w-full flex-col ${wide?"max-w-3xl":"max-w-xl"}`}><header className="flex shrink-0 items-center justify-between gap-3 border-b border-border-soft px-4 py-3"><h3 className="text-sm font-semibold">{title}</h3><button autoFocus aria-label={`Tutup ${title}`} type="button" onClick={onClose} className="btn btn-ghost btn-icon min-h-11 min-w-11 sm:min-h-7 sm:min-w-7"><X className="size-4"/></button></header><div className="overflow-y-auto p-4">{children}</div></section></div>;
}
