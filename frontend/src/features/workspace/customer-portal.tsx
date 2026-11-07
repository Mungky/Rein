"use client";
import { useEffect, useState } from "react";
import { StatusBadge } from "./shared/status-badge";

interface PortalData {
  name: string; customer: string | null; deadline: string | null; status: string; progress: number;
  tasks: { id: string; name: string; deadline: string | null; status: string }[];
  milestones: { id: string; name: string; deadline: string | null; reached_at: string | null }[];
  updates: { id: string; health: string; summary: string; created_at: string }[];
  comments: { id: string; task_id: string; body: string; created_at: string }[];
  attachments: { id: string; task_id: string; name: string }[];
}

export function CustomerPortal({ token, apiBase }: { token: string; apiBase: string }) {
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    fetch(`${apiBase}/api/project-portal/${encodeURIComponent(token)}`, { cache: "no-store", referrerPolicy: "no-referrer" })
      .then(async (response) => { if (!response.ok) throw new Error("Tautan tidak berlaku, telah dicabut, atau kedaluwarsa."); return await response.json() as PortalData; })
      .then((result) => { if (active) setData(result); }).catch(() => { if (active) setError("Tautan tidak berlaku atau portal belum dapat dijangkau. Hubungi pengelola proyek."); });
    return () => { active = false; };
  }, [token, apiBase]);
  async function download(id: string, name: string) {
    try {
      const response = await fetch(`${apiBase}/api/project-portal/${encodeURIComponent(token)}/attachments/${id}`, { cache: "no-store", referrerPolicy: "no-referrer" });
      if (!response.ok) throw new Error();
      const url = URL.createObjectURL(await response.blob()); const link = document.createElement("a"); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError("Lampiran tidak tersedia atau akses telah berakhir."); }
  }
  return <main className="min-h-screen bg-bg-ctrl px-4 py-8 text-text"><div className="mx-auto max-w-5xl space-y-6">
    <header className="flex items-center justify-between border-b border-border pb-4"><span className="font-bold text-primary">REIN · Portal Proyek</span><span className="text-xs text-text-muted">Informasi pelanggan</span></header>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">{error}</p>}
    {!data && !error && <p>Memuat perkembangan proyek…</p>}
    {data && <>
      <section className="rounded-2xl border border-border bg-bg p-6"><p className="text-sm text-text-muted">{data.customer}</p><h1 className="mt-1 text-2xl font-bold">{data.name}</h1><div className="mt-3 flex items-center gap-3 text-sm"><StatusBadge status={data.status} /><span>Target: {data.deadline ?? "Belum ditetapkan"}</span></div><div className="mt-5 h-2 overflow-hidden rounded-full bg-bg-ctrl"><div className="h-full rounded-full bg-primary" style={{ width: `${data.progress}%` }} /></div><p className="mt-2 text-xs text-text-muted">{data.progress}% dari pekerjaan yang dibagikan telah selesai.</p></section>
      <section className="space-y-3"><h2 className="font-semibold">Perkembangan proyek</h2>{data.updates.map((update) => <article key={update.id} className="rounded-xl border border-border bg-bg p-5"><p className="whitespace-pre-wrap text-sm">{update.summary}</p><p className="mt-3 text-xs text-text-muted">{new Date(update.created_at).toLocaleString("id-ID")}</p></article>)}{data.updates.length === 0 && <p className="text-sm text-text-muted">Belum ada pembaruan yang dibagikan.</p>}</section>
      <section className="grid gap-3 md:grid-cols-3">{data.milestones.map((milestone) => <div key={milestone.id} className="rounded-xl border border-border bg-bg p-4"><h2 className="text-sm font-semibold">{milestone.name}</h2><p className="mt-2 text-xs text-text-muted">{milestone.deadline ?? "Tanpa tanggal"} · {milestone.reached_at ? "Tercapai" : "Berjalan"}</p></div>)}</section>
      <section className="space-y-3"><h2 className="font-semibold">Pekerjaan yang dibagikan</h2>{data.tasks.map((task) => <article key={task.id} className="space-y-3 rounded-xl border border-border bg-bg p-5"><div className="flex flex-wrap items-center gap-3"><h3 className="flex-1 font-semibold">{task.name}</h3><StatusBadge status={task.status} /><span className="text-xs text-text-muted">{task.deadline ?? "Tanpa deadline"}</span></div>{data.comments.filter((comment) => comment.task_id === task.id).map((comment) => <p key={comment.id} className="whitespace-pre-wrap rounded-lg bg-bg-ctrl p-3 text-sm">{comment.body}</p>)}{data.attachments.filter((file) => file.task_id === task.id).map((file) => <button key={file.id} onClick={() => void download(file.id, file.name)} className="btn btn-default btn-sm">Unduh {file.name}</button>)}</article>)}{data.tasks.length === 0 && <p className="rounded-xl bg-bg p-6 text-sm text-text-muted">Pengelola belum membagikan pekerjaan ke portal ini.</p>}</section>
    </>}
  </div></main>;
}
