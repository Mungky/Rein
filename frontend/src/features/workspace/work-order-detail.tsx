"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { AlertTriangle, Clock, Loader2, Paperclip, Pencil, RefreshCw, UploadCloud, X } from "lucide-react";
import { workspaceApi } from "@/lib/api/workspace";
import type { WorkOrderDetail as Detail, WorkOrderFile } from "@/lib/api/workspace-logbook";
import { apiErrorText } from "@/lib/api/client";
import { ActionForm, dateLabel, duration, Empty, Field, textValue } from "./operations-ui";
import { WorkOrderForm, getFileIcon, todayLocal } from "./work-order-form";
import { StatusBadge } from "./shared/status-badge";
import { AvatarGroup } from "./compact-ui";
import { workOrderLabel, materialStatuses, formatFileSize } from "./work-order-ui";
import { WorkOrderStatus } from "./work-order-status";

function WorkOrderLogForm({
  api,
  taskId,
  onSaved,
}: {
  api: typeof workspaceApi;
  taskId: string;
  onSaved: () => Promise<void> | void;
}) {
  const [logFiles, setLogFiles] = useState<File[]>([]);
  const [isIssue, setIsIssue] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function appendLogFiles(newFiles: File[]) {
    setLogFiles((prev) => {
      const keys = new Set(prev.map((f) => `${f.name}-${f.size}-${f.lastModified}`));
      const unique = newFiles.filter(
        (f) => !keys.has(`${f.name}-${f.size}-${f.lastModified}`) && f.size > 0
      );
      return [...prev, ...unique];
    });
  }

  return (
    <div className="rounded-xl border border-border bg-bg p-4 shadow-xs">
      <ActionForm
        reset
        submitLabel="Simpan update harian"
        className="space-y-4"
        onSubmit={async (f) => {
          await api.addWorkLog(
            taskId,
            {
              request_id: textValue(f, "__request_id"),
              work_date: textValue(f, "date"),
              body: textValue(f, "body"),
              minutes: Math.round(Number(f.get("hours") || 0) * 60),
              is_issue: isIssue,
            },
            logFiles
          );
          setLogFiles([]);
          setIsIssue(false);
          await onSaved();
        }}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Tanggal pekerjaan">
            <input
              type="date"
              name="date"
              required
              defaultValue={todayLocal()}
              max={todayLocal()}
              className="field-input text-xs"
            />
          </Field>
          <Field label="Durasi kerja (opsional)">
            <div className="relative">
              <Clock className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />
              <input
                type="number"
                name="hours"
                defaultValue=""
                min={0}
                max={24}
                step={0.5}
                placeholder="0 jam (contoh: 2.5)"
                className="field-input pl-9 text-xs"
              />
            </div>
          </Field>
        </div>

        <Field label="Update pekerjaan hari ini">
          <textarea
            name="body"
            required
            maxLength={10000}
            rows={4}
            className="field-input resize-y py-2.5 text-xs leading-relaxed"
            placeholder="Hari ini mengerjakan apa? Sampai mana hasilnya? Jelaskan progres atau kendala…"
          />
        </Field>

        <button
          type="button"
          role="switch"
          aria-checked={isIssue}
          onClick={() => setIsIssue(!isIssue)}
          className={`flex w-full items-center justify-between gap-3 rounded-xl border p-3.5 text-left transition-all ${
            isIssue
              ? "border-amber-500/60 bg-amber-500/10 shadow-xs ring-1 ring-amber-500/30"
              : "border-border bg-bg-ctrl/30 hover:border-amber-500/40 hover:bg-amber-500/5"
          }`}
        >
          <div className="flex items-start gap-3">
            <div
              className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
                isIssue ? "bg-amber-500 text-white" : "bg-amber-500/15 text-amber-600"
              }`}
            >
              <AlertTriangle className="size-4" />
            </div>
            <div>
              <p className="text-xs font-semibold text-text">
                Tandai sebagai kendala pekerjaan
              </p>
              <p className="mt-0.5 text-[11px] text-text-muted">
                Aktifkan jika pekerjaan terhambat material, gambar, atau masalah teknis lain.
              </p>
            </div>
          </div>
          <div
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 ease-in-out ${
              isIssue ? "bg-amber-500" : "bg-border"
            }`}
          >
            <span
              className={`inline-block size-4 transform rounded-full bg-white shadow-sm transition duration-200 ease-in-out ${
                isIssue ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </div>
        </button>

        <div className="space-y-2">
          <label className="block text-xs font-medium text-text">
            Dokumentasi / lampiran (opsional)
          </label>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              if (e.dataTransfer.files) appendLogFiles(Array.from(e.dataTransfer.files));
            }}
            className={`relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-3.5 text-center transition-colors ${
              isDragging
                ? "border-primary bg-primary/5"
                : "border-border bg-bg-ctrl/20 hover:border-primary/40"
            }`}
          >
            <UploadCloud className="mb-1 size-6 text-text-muted" />
            <p className="text-xs text-text">
              Tarik foto/file ke sini, atau{" "}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="font-semibold text-primary hover:underline"
              >
                pilih berkas
              </button>
            </p>
            <p className="mt-0.5 text-[11px] text-text-muted">
              Mendukung banyak berkas foto & dokumen sekaligus
            </p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="sr-only"
              onChange={(e) => {
                if (e.target.files) appendLogFiles(Array.from(e.target.files));
                e.target.value = "";
              }}
            />
          </div>

          {logFiles.length > 0 && (
            <div className="mt-2 space-y-1.5">
              <div className="flex items-center justify-between px-1 text-xs text-text-muted">
                <span>{logFiles.length} berkas siap diunggah</span>
                <button
                  type="button"
                  onClick={() => setLogFiles([])}
                  className="text-[11px] text-red-600 hover:underline"
                >
                  Hapus semua
                </button>
              </div>
              <ul className="max-h-36 overflow-y-auto divide-y divide-border-soft rounded-lg border border-border bg-bg p-1">
                {logFiles.map((file, idx) => (
                  <li
                    key={`${file.name}-${file.size}-${idx}`}
                    className="flex items-center justify-between gap-2 rounded-md p-1.5 text-xs hover:bg-bg-hover"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {getFileIcon(file.name, "size-4 shrink-0 text-primary")}
                      <span className="truncate font-medium text-text" title={file.name}>
                        {file.name}
                      </span>
                      <span className="shrink-0 text-[10px] text-text-muted">
                        {formatFileSize(file.size)}
                      </span>
                    </div>
                    <button
                      type="button"
                      aria-label={`Batalkan file ${file.name}`}
                      onClick={() => setLogFiles((prev) => prev.filter((_, i) => i !== idx))}
                      className="btn btn-ghost btn-icon btn-xs text-text-muted hover:text-red-600"
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </ActionForm>
    </div>
  );
}

export function WorkOrderDetail({api=workspaceApi,taskId,onClose,onChanged,onNavigate,onEdit}: {api?:typeof workspaceApi;taskId:string;onClose:()=>void;onChanged?:()=>void;onNavigate?:(section:string)=>void;onEdit?:()=>void}) {
  const [data,setData]=useState<Detail|null>(null),[error,setError]=useState("");
  const [editing,setEditing]=useState(false),[offset,setOffset]=useState(0);
  const [preview,setPreview]=useState<{url:string;name:string}|null>(null);
  const closeButton=useRef<HTMLButtonElement>(null);
  const load=useCallback(async(page=0)=>{const result=await api.workOrderDetail(taskId,page);setData(result);setError("");},[api,taskId]);
  useEffect(()=>{let active=true;api.workOrderDetail(taskId,offset).then(result=>{if(active){setData(result);setError("");}}).catch(err=>{if(active)setError(apiErrorText(err,"WO belum dapat dimuat"));});return()=>{active=false;};},[api,taskId,offset]);
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;closeButton.current?.focus();return()=>previous?.focus();},[]);
  useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview.url);},[preview]);
  function openSection(section:string){if(onNavigate)onNavigate(section);else window.location.assign(`/workspace?project=${data?.project_id}&tab=${section}`);}
  async function openFile(file:WorkOrderFile) {
    try{const {blob}=(file.document_id?await api.downloadProjectDocument(file.document_id):await api.downloadAttachment(file.id));const url=URL.createObjectURL(blob);
      if(file.content_type.startsWith("image/"))setPreview({url,name:file.name});
      else{const a=document.createElement("a");a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    }catch(err){setError(apiErrorText(err,"Lampiran belum dapat dibuka"));}
  }
  const files=(items:WorkOrderFile[])=> <div className="flex flex-wrap gap-2">{items.map(file=><button key={file.id} onClick={()=>void openFile(file)} className="inline-flex max-w-full items-center gap-2 rounded-lg border border-border bg-bg px-3 py-2 text-left text-xs hover:bg-bg-hover"><Paperclip className="size-3.5 shrink-0 text-primary" /><span className="min-w-0 truncate">{file.name}{file.kind&&<span className="mt-1 block text-[10px] text-text-muted">{file.kind} · {file.status==="approved"?"Disetujui":file.status==="rejected"?"Ditolak":"Terlampir"}</span>}</span><span className="shrink-0 text-[10px] text-text-muted">{Math.max(1,Math.round(file.bytes/1024))} KB</span></button>)}</div>;
  const active=data?.task.status==="in_progress",done=data?.task.status==="done"||data?.task.status==="cancelled";
  const canExecute=!!data?.can_execute&&!data.archived;
  return <div className="fixed inset-0 z-50 flex justify-end" onKeyDown={e=>{if(e.key==="Escape"){if(preview)setPreview(null);else if(!editing)onClose();}}}>
    <button tabIndex={-1} aria-label="Tutup detail WO" onClick={onClose} className="absolute inset-0 bg-black/30" />
    <aside role="dialog" aria-modal="true" aria-labelledby="work-order-title" className="relative flex h-full w-full max-w-[700px] flex-col bg-bg text-text shadow-xl">
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border-soft px-4 py-3"><div className="min-w-0"><p className="text-xs text-text-muted">{data?.rpo_number} · {data?.project_name??"Work Order"}</p><h2 id="work-order-title" className="mt-1 break-words text-lg font-bold">{data?workOrderLabel(data.task):"Memuat WO…"}</h2></div><button aria-label="Muat ulang WO" onClick={()=>void load(offset).catch(err=>setError(apiErrorText(err,"WO belum dapat dimuat")))} className="btn btn-ghost btn-icon btn-sm"><RefreshCw className="size-4" /></button><button ref={closeButton} aria-label="Tutup WO" onClick={onClose} className="btn btn-ghost btn-icon btn-sm"><X className="size-4" /></button></header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-bg-ctrl/20 p-4">
        {error&&<div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}<button onClick={()=>void load(offset).catch(err=>setError(apiErrorText(err,"WO belum dapat dimuat")))} className="ml-2 underline">Muat ulang</button></div>}
        {!data&&!error&&<Loader2 className="mx-auto my-10 size-6 animate-spin text-primary" />}
        {data&&<>
          <div className="flex flex-wrap items-center justify-between gap-3"><StatusBadge status={data.task.status} />{data.can_edit&&!data.archived&&!done&&<button onClick={()=>onEdit?onEdit():setEditing(true)} className="btn btn-default btn-sm"><Pencil className="size-3" />Ubah WO</button>}</div>
          <dl className="grid grid-cols-2 gap-3 rounded-lg bg-bg-ctrl/60 p-3"><div><dt className="text-xs text-text-muted">PIC pekerjaan</dt><dd className="mt-1 flex flex-wrap items-center gap-2 text-sm font-semibold"><AvatarGroup people={data.assignees?.length?data.assignees:[{name:data.task.assigned_name??"PIC belum ditetapkan"}]}/><span className="text-xs font-medium">{data.assignees?.length?data.assignees.map(a=>a.name).join(", "):(data.task.assigned_name??"PIC belum ditetapkan")}</span>{data.assignees?.some(a=>a.inactive)&&<span className="inline-flex items-center rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-600">Sudah tidak bekerja</span>}</dd></div><div><dt className="text-xs text-text-muted">Jadwal</dt><dd className="mt-1 text-sm leading-relaxed">{dateLabel(data.start_date)} — {dateLabel(data.end_date)}</dd></div></dl>
          <section><h3 className="mb-2 text-sm font-semibold">Deskripsi pekerjaan</h3><p className="whitespace-pre-wrap text-sm leading-relaxed">{data.task.description||"Belum ada deskripsi pekerjaan."}</p></section>
          {!!data.attachments.length&&<section><h3 className="mb-3 text-sm font-semibold">Lampiran pekerjaan</h3>{files(data.attachments)}</section>}
          <WorkOrderStatus data={data} onChange={async(status,note)=>{await api.setWorkOrderStatus(taskId,{status,note,expected_updated_at:data.task.updated_at!});await load(offset);onChanged?.();}} />
          <section className="space-y-3 border-t border-border-soft pt-3"><div className="flex items-start justify-between gap-4"><div><h3 className="text-sm font-semibold">Logbook harian</h3></div>{data.logged_minutes>0&&<span className="shrink-0 rounded-lg bg-bg-ctrl px-3 py-2 text-xs">{duration(data.logged_minutes)} tercatat</span>}</div>
            {active&&canExecute&&<WorkOrderLogForm api={api} taskId={taskId} onSaved={async()=>{setOffset(0);await load(0);onChanged?.();}} />}
            {!data.log_total&&<Empty>{done?"Belum ada logbook pada WO lama ini.":active?"Belum ada update. Catat pekerjaan pertama di form di atas.":"Logbook dapat diisi setelah pekerjaan dimulai."}</Empty>}
            <div className="space-y-4">{data.logs.map(log=><article key={log.id} className="space-y-3 rounded-lg border border-border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">{dateLabel(log.work_date)}</p>{log.minutes>0&&<span className="text-xs text-text-muted">{duration(log.minutes)}</span>}</div><p className="flex flex-wrap items-center gap-1.5 text-xs text-text-muted"><span>{log.author_name}</span>{log.author_inactive&&<span className="inline-flex items-center rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-600">Sudah tidak bekerja</span>}<span>· dicatat {dateLabel(log.created_at)}</span></p><p className="whitespace-pre-wrap text-sm leading-relaxed">{log.body}</p>{log.issue_id&&<button className="badge badge-amber" onClick={()=>openSection("blockers")}>Kendala · {log.issue_status==="verified"?"Terverifikasi":log.issue_status==="resolved"?"Menunggu verifikasi":"Terbuka"}</button>}{!!log.attachments.length&&files(log.attachments)}</article>)}</div>
            {data.log_total>30&&<div className="flex items-center justify-between gap-3 text-xs"><button disabled={!offset} className="btn btn-default btn-sm" onClick={()=>setOffset(Math.max(0,offset-30))}>Lebih baru</button><span>{offset+1}–{Math.min(offset+30,data.log_total)} dari {data.log_total} catatan</span><button disabled={offset+30>=data.log_total} className="btn btn-default btn-sm" onClick={()=>setOffset(offset+30)}>Lebih lama</button></div>}
          </section>
          <section className="space-y-4 rounded-xl border border-border bg-bg p-4"><div className="flex flex-wrap gap-2">{[["documents","Dokumen proyek"],["materials","Material terkait"],["blockers","Kendala terkait"],["team","Tim / PIC"]].map(([key,label])=><button key={key} className="btn btn-default btn-sm" onClick={()=>openSection(key)}>{label}</button>)}</div>{!!data.materials?.length&&<div><h3 className="mb-2 text-sm font-semibold">Material WO</h3>{data.materials.map(item=><div key={item.id} className="flex flex-wrap justify-between gap-2 border-t border-border-soft py-3 text-xs"><span className="font-medium">{item.name}{item.specification?` · ${item.specification}`:""}</span><span>{item.quantity} {item.unit} · {materialStatuses[item.status]??item.status}</span>{item.notes&&<p className="w-full text-text-muted">{item.notes}</p>}</div>)}</div>}{!!data.issues?.length&&<div><h3 className="mb-2 text-sm font-semibold">Kendala WO</h3>{data.issues.map(issue=><button key={issue.id} className="block min-h-10 text-left text-xs text-primary" onClick={()=>openSection("blockers")}>{issue.title} · {issue.status==="verified"?"Terverifikasi":issue.status==="resolved"?"Menunggu verifikasi":"Terbuka"}</button>)}</div>}</section>
          {(data.previous_reports.length>0||data.previous_notes.length>0)&&<details className="rounded-lg border border-border p-4"><summary className="cursor-pointer text-xs text-text-muted">Catatan dan laporan sebelumnya</summary><div className="mt-4 space-y-4">{[...data.previous_notes,...data.previous_reports].map(note=><article key={note.id} className="border-l-2 border-border pl-3"><p className="text-xs text-text-muted">{note.author_name} · {dateLabel(note.created_at)}</p><p className="mt-1 whitespace-pre-wrap text-sm">{note.body}</p>{"photos" in note&&note.photos.map((url,i)=><a key={url} href={url} target="_blank" rel="noreferrer" className="mt-2 mr-3 inline-block text-xs text-primary">Dokumentasi {i+1}</a>)}</article>)}</div></details>}
        </>}
      </div>
    </aside>
    {editing&&data&&<WorkOrderForm api={api} projectId={data.project_id} existing={data} fullPage={false} onClose={()=>setEditing(false)} onSaved={()=>{setEditing(false);void load(offset);onChanged?.();}} />}
    {preview&&<div role="dialog" aria-modal="true" aria-label="Dokumentasi pekerjaan" className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/90 p-5"><button aria-label="Tutup dokumentasi" onClick={()=>setPreview(null)} className="absolute right-5 top-5 rounded bg-white p-2 text-black"><X className="size-5" /></button><Image unoptimized src={preview.url} alt={preview.name} width={1200} height={900} className="max-h-[80dvh] w-auto max-w-full object-contain" /><p className="mt-4 text-sm text-white">{preview.name}</p></div>}
  </div>;
}
