"use client";
import { useEffect,useState } from "react";
import { Cloud,Loader2,RefreshCw } from "lucide-react";
import type { workspaceApi } from "@/lib/api/workspace";
import type { UploadDestination } from "@/lib/api/workspace-coordination";
import { apiErrorText } from "@/lib/api/client";
import { Field } from "./operations-ui";

export function ArchiveDestination({api,projectId,required=false,documentId}:{api:typeof workspaceApi;projectId:string;required?:boolean;documentId?:string}) {
  const [data,setData]=useState<UploadDestination|null>(null),[error,setError]=useState(""),[retry,setRetry]=useState(0),[selected,setSelected]=useState("");
  useEffect(()=>{let active=true;api.projectUploadDestination(projectId,documentId).then(value=>{if(active){setData(value);setError("");}}).catch(err=>{if(active)setError(apiErrorText(err,"Tujuan arsip belum dapat dimuat"));});return()=>{active=false;};},[api,projectId,documentId,retry]);
  if(error)return <p role="alert" className="text-xs text-red-600">{error}<button type="button" onClick={()=>setRetry(retry+1)} className="btn btn-ghost btn-sm ml-1"><RefreshCw className="size-3"/>Coba lagi</button></p>;
  if(!data)return <p className="flex items-center gap-2 text-xs text-text-muted"><Loader2 className="size-3 animate-spin"/>Menyiapkan tujuan arsip…</p>;
  if(!data.enabled)return null;
  const label=data.departments.find(d=>d.key===(data.default_department||selected))?.label;
  return <div className="space-y-2">{data.requires_choice&&<Field label="Divisi tujuan arsip"><select aria-label="Divisi tujuan arsip" name="archive_department" required={required} value={selected} onChange={e=>setSelected(e.target.value)} className="field-input"><option value="">Pilih divisi pengunggah</option>{data.departments.map(d=><option key={d.key} value={d.key}>{d.label}</option>)}</select></Field>}<p className="flex items-start gap-2 text-xs text-text-muted"><Cloud className="mt-0.5 size-3.5 shrink-0"/><span className="min-w-0 break-words">REIN-ARCHIVE / {label||"[Divisi]"} / {data.project_folder}</span></p></div>;
}
