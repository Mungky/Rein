"use client";

import { useCallback, useEffect, useState } from "react";
import { workspaceApi, type Task } from "@/lib/api/workspace";
import type { TaskDetails, TimeEntry } from "@/lib/api/workspace-project";
import { apiErrorText } from "@/lib/api/client";
import { Loader2 } from "lucide-react";

const field = "w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm";
const dateLabel = (value: string) => new Date(value).toLocaleString("id-ID");

export function TaskProjectPanel({ api = workspaceApi, task, canManage, onChanged }: {
  api?: typeof workspaceApi; task: Task; canManage: boolean; onChanged?: () => void;
}) {
  const [data, setData] = useState<TaskDetails | null>(null);
  const [tab, setTab] = useState("planning");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editTime, setEditTime] = useState<TimeEntry | null>(null);
  const [timeRequest, setTimeRequest] = useState(() => crypto.randomUUID());
  const load = useCallback(async () => { const result = await api.taskDetails(task.id); setData(result); }, [api, task.id]);
  useEffect(() => {
    let active = true;
    api.taskDetails(task.id).then((result) => { if (active) setData(result); })
      .catch((err) => { if (active) setError(apiErrorText(err, "Detail Project belum tersedia")); });
    return () => { active = false; };
  }, [api, task.id, task.status, task.assigned_to, task.reviewed_at]);
  async function act(action: () => Promise<unknown>, reset?: HTMLFormElement) {
    setBusy(true); setError(null);
    try { await action(); await load(); reset?.reset(); onChanged?.(); return true; }
    catch (err) { setError(apiErrorText(err, "Perubahan tidak tersimpan")); return false; }
    finally { setBusy(false); }
  }
  async function download(id: string) {
    try {
      const { blob } = await api.downloadAttachment(id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url;
      link.download = data?.attachments.find((file) => file.id === id)?.name ?? "lampiran";
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { setError(apiErrorText(err, "Lampiran tidak dapat diunduh")); }
  }
  if (!data) return <section className="rounded-lg border border-border p-4"><p className="text-sm">{error ?? "Memuat perencanaan proyek…"}</p></section>;
  const { metadata, planning } = data;
  return <section className="rounded-xl border border-border">
    <div className="flex gap-1 overflow-x-auto border-b border-border p-2" role="tablist" aria-label="Detail Project">
      {[["planning", "Perencanaan"], ["discussion", "Diskusi"], ["files", "Lampiran"], ["time", "Timesheet"], ["repeat", "Pengulangan"], ["history", "Aktivitas"]].map(([key, label]) =>
        <button key={key} role="tab" aria-selected={tab === key} className={`btn btn-sm shrink-0 ${tab === key ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab(key)}>{label}</button>)}
    </div>
    {error && <div className="p-3"><p role="alert" className="text-sm text-red-600">{error}</p><button className="btn btn-default btn-sm mt-2" onClick={() => void load().then(() => setError(null)).catch((err) => setError(apiErrorText(err, "Detail tidak dapat dimuat")))}>Muat ulang detail</button></div>}
    <div className="space-y-4 p-4" aria-busy={busy}>
      {busy && <Loader2 className="size-4 animate-spin" aria-label="Menyimpan" />}
      {tab === "planning" && <>
        {metadata.blocked && <p className="rounded bg-amber-50 p-2 text-sm text-amber-900">Menunggu tugas prasyarat selesai.</p>}
        <form key={planning.version} className="space-y-3" onSubmit={(event) => {
          event.preventDefault(); const form = new FormData(event.currentTarget);
          void act(() => api.saveTaskPlan(task.id, { expected_version: planning.version,
            parent_id: String(form.get("parent")) || null, milestone_id: String(form.get("milestone")) || null,
            priority: Number(form.get("priority")), estimated_minutes: Number(form.get("estimate")),
            portal_visible: form.get("portal") === "on", assignee_ids: form.getAll("assignees").map(String),
            dependency_ids: form.getAll("dependencies").map(String), tag_ids: form.getAll("tags").map(String) }));
        }}>
          <fieldset disabled={!canManage || busy} className="space-y-3">
            <div className="grid grid-cols-2 gap-3"><label className="text-xs">Prioritas<select name="priority" className={field} defaultValue={metadata.priority}>{["Normal", "Menengah", "Tinggi", "Mendesak"].map((name, index) => <option key={name} value={index}>{name}</option>)}</select></label>
              <label className="text-xs">Estimasi (menit)<input type="number" name="estimate" min={0} max={1000000} defaultValue={metadata.estimated_minutes} className={field} /></label></div>
            <label className="block text-xs">Tugas induk<select name="parent" defaultValue={metadata.parent_id ?? ""} className={field}><option value="">Tanpa induk</option>{planning.tasks.filter((item) => item.id !== task.id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label className="block text-xs">Milestone<select name="milestone" defaultValue={metadata.milestone_id ?? ""} className={field}><option value="">Tanpa milestone</option>{planning.milestones.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <MultiSelect label="Penanggung jawab" name="assignees" options={planning.people} values={metadata.assignees.map((item) => item.id)} />
            <MultiSelect label="Tugas prasyarat" name="dependencies" options={planning.tasks.filter((item) => item.id !== task.id)} values={metadata.dependency_ids} />
            <MultiSelect label="Tag" name="tags" options={planning.tags} values={metadata.tags.map((item) => item.id)} />
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="portal" defaultChecked={metadata.portal_visible} /> Tampilkan tugas ini di portal pelanggan</label>
            {canManage && <button className="btn btn-primary btn-sm">Simpan perencanaan</button>}
          </fieldset>
        </form>
        <div className="border-t border-border pt-3"><h4 className="text-sm font-semibold">Subtugas</h4>
          {data.subtasks.map((item) => <p key={item.id} className="py-1 text-xs">{item.name} · {item.status === "done" ? "Selesai" : "Belum selesai"}</p>)}
          {data.subtasks.length === 0 && <p className="text-xs text-text-muted">Belum ada subtugas.</p>}
          {canManage && task.status !== "done" && <form className="mt-2 flex gap-2" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const name = String(new FormData(form).get("name")); void act(() => api.createSubtask(task.id, name, planning.version), form); }}><input name="name" aria-label="Nama subtugas" required maxLength={160} className={field} placeholder="Nama subtugas" /><button disabled={busy} className="btn btn-default btn-sm">Tambah</button></form>}
        </div>
      </>}
      {tab === "discussion" && <>
        <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); void act(() => api.addComment(task.id, { body: String(values.get("body")), external: values.get("external") === "on", mention_ids: values.getAll("mentions").map(String) }), form); }}>
          <textarea name="body" aria-label="Komentar" required maxLength={5000} className={field} placeholder="Tulis perkembangan atau diskusikan pekerjaan…" />
          <MultiSelect label="Beri tahu anggota proyek" name="mentions" options={planning.people.filter((p) => planning.member_ids.includes(p.id))} values={[]} />
          {canManage && <label className="flex gap-2 text-xs"><input name="external" type="checkbox" /> Boleh dilihat pelanggan</label>}
          <button disabled={busy} className="btn btn-primary btn-sm">Kirim komentar</button>
        </form>
        {data.comments.map((item) => <article key={item.id} className="rounded-lg bg-bg-ctrl p-3 text-sm"><p className="text-xs font-semibold">{item.author_name ?? "Pengguna"} · {dateLabel(item.created_at)} {item.external && "· Pelanggan"}</p><p className="mt-2 whitespace-pre-wrap break-words">{item.body}</p></article>)}
      </>}
      {tab === "files" && <>
        <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); const file = values.get("file"); if (file instanceof File && file.size) void act(() => api.uploadAttachment(task.id, file, values.get("external") === "on"), form); }}>
          <label className="block text-xs">PDF, PNG, JPEG, atau TXT · maksimal 5 MB<input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.txt" required className={`${field} mt-2`} /></label>
          {canManage && <label className="flex gap-2 text-xs"><input name="external" type="checkbox" /> Boleh diunduh pelanggan</label>}
          <button disabled={busy} className="btn btn-primary btn-sm">Unggah lampiran</button>
        </form>
        {data.attachments.map((file) => <div key={file.id} className="flex items-center gap-2 rounded border border-border p-2 text-xs"><button className="flex-1 text-left text-primary" onClick={() => void download(file.id)}>{file.name} · {Math.ceil(file.bytes / 1024)} KB {file.external && "· Pelanggan"}</button><button disabled={busy} className="btn btn-ghost btn-sm" onClick={() => void act(() => api.deleteAttachment(file.id))}>Hapus</button></div>)}
      </>}
      {tab === "time" && <>
        <form key={editTime?.id ?? timeRequest} className="space-y-2" onSubmit={async (event) => { event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); const body = { request_id: timeRequest, work_date: String(values.get("date")), minutes: Number(values.get("minutes")), description: String(values.get("description")) }; if (await act(() => editTime ? api.updateTime(editTime.id, body) : api.logTime(task.id, body))) { setEditTime(null); setTimeRequest(crypto.randomUUID()); } }}>
          <div className="grid grid-cols-2 gap-2"><label className="text-xs">Tanggal<input type="date" name="date" defaultValue={editTime?.work_date ?? new Date().toLocaleDateString("en-CA")} required className={field} /></label><label className="text-xs">Durasi (menit)<input name="minutes" type="number" min={1} max={1440} defaultValue={editTime?.minutes ?? 60} required className={field} /></label></div>
          <input name="description" aria-label="Pekerjaan timesheet" defaultValue={editTime?.description ?? ""} required maxLength={1000} placeholder="Pekerjaan yang dilakukan" className={field} />
          <button disabled={busy} className="btn btn-primary btn-sm">{editTime ? "Simpan perubahan waktu" : "Catat waktu"}</button>{editTime && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditTime(null)}>Batal</button>}
        </form>
        {data.time_entries.map((entry) => <div key={entry.id} className="rounded border border-border p-3 text-xs"><p className="font-semibold">{entry.name} · {entry.work_date} · {entry.minutes} menit</p><p className="my-2">{entry.description}</p><button className="btn btn-ghost btn-sm" onClick={() => setEditTime(entry)}>Ubah</button><button disabled={busy} className="btn btn-ghost btn-sm" onClick={() => void act(() => api.deleteTime(entry.id))}>Hapus</button></div>)}
      </>}
      {tab === "repeat" && <>
        <p className="text-xs text-text-muted">Buat WO baru secara otomatis pada tanggal jatuh tempo. Pengulangan tidak menyalin status selesai atau hasil review.</p>
        {canManage ? <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); const values = new FormData(event.currentTarget); void act(() => api.saveRecurrence(task.id, { expected_version: planning.version, unit: String(values.get("unit")), interval: Number(values.get("interval")), next_date: String(values.get("next")), end_date: String(values.get("end")) || null, active: values.get("active") === "on" })); }}>
          <div className="grid grid-cols-2 gap-2"><label className="text-xs">Setiap<input name="interval" type="number" min={1} max={365} defaultValue={data.recurrence?.interval ?? 1} className={field} /></label><label className="text-xs">Periode<select name="unit" defaultValue={data.recurrence?.unit ?? "weekly"} className={field}><option value="daily">Hari</option><option value="weekly">Minggu</option><option value="monthly">Bulan</option></select></label></div>
          <label className="block text-xs">Tanggal berikutnya<input type="date" name="next" required defaultValue={data.recurrence?.next_date ?? ""} className={field} /></label><label className="block text-xs">Berakhir (opsional)<input type="date" name="end" defaultValue={data.recurrence?.end_date ?? ""} className={field} /></label>
          <label className="flex gap-2 text-xs"><input name="active" type="checkbox" defaultChecked={data.recurrence?.active ?? true} /> Jadwal aktif</label><button disabled={busy} className="btn btn-primary btn-sm">Simpan jadwal</button>
        </form> : <p className="text-sm">{data.recurrence?.active ? `Jadwal berikutnya: ${data.recurrence.next_date}` : "Tidak ada jadwal aktif."}</p>}
      </>}
      {tab === "history" && <ol className="space-y-3">{data.events.map((item) => <li key={item.id} className="border-l-2 border-primary/30 pl-3 text-xs"><p className="font-semibold">{item.action}</p><p className="text-text-muted">{item.actor_name ?? "Sistem"} · {dateLabel(item.created_at)}</p></li>)}{data.events.length === 0 && <li className="text-xs text-text-muted">Belum ada aktivitas tercatat.</li>}</ol>}
    </div>
  </section>;
}

function MultiSelect({ label, name, options, values }: { label: string; name: string; options: { id: string; name: string }[]; values: string[] }) {
  return <fieldset className="rounded-lg border border-border p-2"><legend className="px-1 text-xs text-text-muted">{label}</legend><div className="max-h-28 space-y-1 overflow-y-auto">{options.map((item) => <label key={item.id} className="flex items-center gap-2 py-1 text-xs"><input name={name} value={item.id} type="checkbox" defaultChecked={values.includes(item.id)} />{item.name}</label>)}{options.length === 0 && <p className="text-xs text-text-muted">Belum tersedia.</p>}</div></fieldset>;
}
