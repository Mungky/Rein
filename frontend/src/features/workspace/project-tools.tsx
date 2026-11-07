"use client";

import { useCallback, useEffect, useState } from "react";
import { workspaceApi } from "@/lib/api/workspace";
import type { PlanningChoices, ProjectNotification, ProjectReport, ProjectUpdate, PortalShare, Milestone } from "@/lib/api/workspace-project";
import { apiErrorText } from "@/lib/api/client";

const field = "w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm";
const healthNames: Record<string, string> = { on_track: "Sesuai rencana", at_risk: "Perlu perhatian", off_track: "Terkendala", on_hold: "Ditunda", done: "Selesai" };

export function ProjectTools({ api = workspaceApi, projectId, canManage, preview, onChanged, onProjectCreated, operationalMode = false }: {
  api?: typeof workspaceApi; projectId: string; canManage: boolean; preview?: boolean; operationalMode?: boolean;
  onChanged: () => void; onProjectCreated?: (id: string) => void;
}) {
  const [tab, setTab] = useState("");
  const [choices, setChoices] = useState<PlanningChoices | null>(null);
  const [report, setReport] = useState<ProjectReport | null>(null);
  const [updates, setUpdates] = useState<ProjectUpdate[]>([]);
  const [notifications, setNotifications] = useState<ProjectNotification[]>([]);
  const [shares, setShares] = useState<PortalShare[]>([]);
  const [shareUrl, setShareUrl] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (tab === "planning" || tab === "templates") setChoices(await api.projectPlanning(projectId));
    if (tab === "report") setReport(await api.projectReport(projectId));
    if (tab === "updates") setUpdates(await api.projectUpdates(projectId));
    if (tab === "inbox") setNotifications(await api.projectNotifications(projectId));
    if (tab === "sharing" && canManage) setShares(await api.shares(projectId));
  }, [api, projectId, tab, canManage]);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      try { await load(); if (active) setError(null); }
      catch (err) { if (active) setError(apiErrorText(err, "Panel proyek belum dapat dimuat")); }
    });
    return () => { active = false; };
  }, [load]);
  async function act(action: () => Promise<unknown>, form?: HTMLFormElement) {
    setBusy(true); setError(null); setMessage("");
    try { await action(); await load(); onChanged(); form?.reset(); }
    catch (err) { setError(apiErrorText(err, "Perubahan tidak tersimpan")); }
    finally { setBusy(false); }
  }
  const panels = [["planning", "Milestone & Tag"], ["updates", "Perkembangan"], ["report", "Laporan & Waktu"], ["inbox", "Inbox"],
    ...(canManage ? [["sharing", "Portal pelanggan"], ...(!operationalMode ? [["templates", "Template & Jadwal"], ["orders", "Dari pesanan"]] : [])] : [])];
  return <div className="border-b border-border bg-bg">
    <div className="flex flex-wrap gap-1 px-4 py-2">{panels.map(([key, name]) => <button key={key} className={`btn btn-sm ${tab === key ? "btn-primary" : "btn-ghost"}`} aria-expanded={tab === key} onClick={() => setTab(tab === key ? "" : key)}>{name}</button>)}</div>
    {tab && <section className="max-h-[65vh] space-y-4 overflow-y-auto border-t border-border-soft p-5" aria-busy={busy}>
      {error && <div><p role="alert" className="text-sm text-red-600">{error}</p><button className="btn btn-default btn-sm mt-2" onClick={() => void load().then(() => setError(null)).catch((err) => setError(apiErrorText(err, "Panel belum dapat dimuat")))}>Muat ulang panel</button></div>}
      {message && <p role="status" className="rounded bg-primary-soft p-3 text-sm">{message}</p>}
      {tab === "planning" && choices && <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3"><h3 className="font-semibold">Milestone proyek</h3>
          {choices.milestones.map((milestone) => <div key={milestone.id} className="rounded-lg border border-border p-3 text-sm">
            <p className="font-semibold">{milestone.name}</p><p className="text-xs text-text-muted">{milestone.deadline ?? "Tanpa tanggal"} · {milestone.reached_at ? "Tercapai" : "Belum tercapai"}</p>
            {canManage && <div className="mt-2 flex gap-2"><button disabled={busy} className="btn btn-default btn-sm" onClick={() => void act(() => api.updateMilestone(projectId, milestone, !milestone.reached_at, choices.version))}>{milestone.reached_at ? "Buka kembali" : "Tandai tercapai"}</button><button disabled={busy} className="btn btn-ghost btn-sm" onClick={() => void act(() => api.deleteMilestone(projectId, milestone.id, choices.version))}>Hapus</button>
              <details><summary className="cursor-pointer px-2 py-1 text-xs">Ubah</summary><MilestoneForm milestone={milestone} busy={busy} onSubmit={(name, deadline) => void act(() => api.updateMilestone(projectId, { ...milestone, name, deadline }, !!milestone.reached_at, choices.version))} /></details></div>}
          </div>)}
          {canManage && <MilestoneForm busy={busy} onSubmit={(name, deadline) => void act(() => api.createMilestone(projectId, { name, deadline, expected_version: choices.version }))} />}
        </div>
        <div className="space-y-3"><h3 className="font-semibold">Tag pekerjaan</h3><div className="flex flex-wrap gap-2">{choices.tags.map((tag) => <span key={tag.id} className="rounded-full bg-primary-soft px-3 py-1 text-xs">{tag.name}</span>)}</div>
          {canManage && <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const name = String(new FormData(form).get("name")); void act(() => api.createTag(projectId, name, choices.version), form); }}><input name="name" aria-label="Nama tag baru" required maxLength={60} className={field} placeholder="Tag baru" /><button disabled={busy} className="btn btn-primary btn-sm">Tambah tag</button></form>}
          <p className="text-xs text-text-muted">Pasangkan tag dan milestone pada tab Perencanaan di detail WO.</p>
        </div>
      </div>}
      {tab === "updates" && <div className="grid gap-6 lg:grid-cols-2">
        {canManage && <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); void act(() => api.addProjectUpdate(projectId, { health: String(values.get("health")), summary: String(values.get("summary")), external: values.get("external") === "on" }), form); }}>
          <label className="block text-xs">Kondisi proyek<select name="health" className={field}>{Object.entries(healthNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
          <textarea name="summary" aria-label="Ringkasan perkembangan" required maxLength={5000} className={field} placeholder="Capaian, kendala, dan langkah berikutnya…" /><label className="flex gap-2 text-xs"><input name="external" type="checkbox" /> Bagikan ringkasan ini ke pelanggan</label><button disabled={busy} className="btn btn-primary btn-sm">Terbitkan perkembangan</button>
        </form>}
        <div className="space-y-3">{updates.map((update) => <article key={update.id} className="rounded-lg border border-border p-4"><p className="text-sm font-semibold">{healthNames[update.health]} {update.external && "· Pelanggan"}</p><p className="my-2 whitespace-pre-wrap text-sm">{update.summary}</p><p className="text-xs text-text-muted">{update.author_name} · {new Date(update.created_at).toLocaleString("id-ID")}</p></article>)}{updates.length === 0 && <p className="text-sm text-text-muted">Belum ada pembaruan proyek.</p>}</div>
      </div>}
      {tab === "report" && report && <ReportPanel report={report} />}
      {tab === "inbox" && <div className="space-y-2">{notifications.map((item) => <div key={item.id} className={`flex items-center gap-3 rounded-lg border border-border p-3 text-sm ${item.read_at ? "text-text-muted" : "bg-primary-soft"}`}><div className="flex-1"><p>{item.message}</p><p className="text-xs text-text-muted">{new Date(item.created_at).toLocaleString("id-ID")}</p></div>{!item.read_at && <button disabled={busy} className="btn btn-ghost btn-sm" onClick={() => void act(() => api.readNotification(item.id))}>Sudah dibaca</button>}</div>)}{notifications.length === 0 && <p className="text-sm text-text-muted">Belum ada notifikasi untuk Anda.</p>}</div>}
      {tab === "sharing" && canManage && <div className="space-y-4">
        <p className="text-sm text-text-muted">Pelanggan hanya melihat tugas, komentar, dan lampiran yang Anda tandai untuk portal. Tautan berhenti berlaku saat kedaluwarsa atau dicabut.</p>
        <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); void act(async () => { const result = await api.createShare(projectId, { label: String(values.get("label")), expires_in_days: Number(values.get("days")) }); setShareUrl(`${window.location.origin}/project-portal/${result.token}${preview ? "?preview=1" : ""}`); }, form); }}>
          <label className="flex-1 text-xs">Nama penerima<input name="label" required maxLength={120} className={field} placeholder="Contoh: Tim Klien A" /></label><label className="w-32 text-xs">Berlaku (hari)<input name="days" type="number" defaultValue={7} min={1} max={90} className={field} /></label><button disabled={busy} className="btn btn-primary">Buat tautan</button>
        </form>
        {shareUrl && <div className="rounded-lg border border-primary/30 bg-primary-soft p-3"><label className="block text-xs">Simpan tautan ini; token lengkap hanya ditampilkan saat dibuat.<input readOnly aria-label="Tautan portal pelanggan" value={shareUrl} className={`${field} mt-2`} /></label><a href={shareUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-primary">Buka portal pelanggan ↗</a></div>}
        {shares.map((share) => <div key={share.id} className="flex items-center gap-3 rounded border border-border p-3 text-sm"><div className="flex-1">{share.label}<p className="text-xs text-text-muted">Berakhir {new Date(share.expires_at).toLocaleString("id-ID")} {share.revoked_at && "· Dicabut"}</p></div><button disabled={busy || !!share.revoked_at} className="btn btn-ghost btn-sm" onClick={() => void act(() => api.revokeShare(projectId, share.id))}>Cabut akses</button></div>)}
      </div>}
      {tab === "templates" && canManage && <div className="grid gap-6 lg:grid-cols-2">
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); const name = String(new FormData(event.currentTarget).get("name")); const requestId = crypto.randomUUID(); void act(async () => { const result = await api.duplicateProject(projectId, { name, request_id: requestId }); setMessage("Salinan proyek dibuat. Semua WO kembali ke Todo tanpa laporan atau review lama."); onProjectCreated?.(result.project_id); }); }}>
          <h3 className="font-semibold">Gunakan proyek sebagai template</h3><p className="text-xs text-text-muted">Salin fase, tahap, subtugas, prasyarat, milestone, tag, dan penanggung jawab. Tanggal, catatan waktu, diskusi, akses pelanggan, dan hasil pekerjaan tidak ikut disalin.</p><input name="name" aria-label="Nama salinan proyek" required maxLength={160} className={field} placeholder="Nama proyek baru" /><button disabled={busy} className="btn btn-primary btn-sm">Buat salinan proyek</button>
        </form>
        <div className="space-y-3"><h3 className="font-semibold">Jadwal WO berulang</h3><p className="text-xs text-text-muted">Atur jadwal pada detail WO → Pengulangan. {choices?.recurrence_worker_enabled ? "Pemrosesan otomatis aktif dan memeriksa jadwal setiap menit." : "Pemrosesan otomatis belum aktif; jadwal tetap bisa diproses melalui tombol ini."} Tombol ini memproses jadwal yang sudah jatuh tempo saat ini.</p><button disabled={busy} className="btn btn-default btn-sm" onClick={() => void act(async () => { const result = await api.runRecurrences(projectId); setMessage(`${result.generated} WO berulang dibuat.`); })}>Proses jadwal jatuh tempo</button></div>
      </div>}
      {tab === "orders" && canManage && <form className="max-w-2xl space-y-3" onSubmit={(event) => { event.preventDefault(); const values = new FormData(event.currentTarget); void act(async () => { const result = await api.projectFromSale({ reference: String(values.get("reference")), customer: String(values.get("customer")), project_name: String(values.get("name")), lines: String(values.get("lines")).split("\n").map((line) => line.trim()).filter(Boolean) }); setMessage("Proyek dan WO pesanan siap digunakan."); onProjectCreated?.(result.project_id); }); }}>
        <h3 className="font-semibold">Buat proyek dari referensi pesanan</h3><p className="text-xs text-text-muted">Masukkan referensi pesanan layanan dari penjualan Anda. Referensi yang sama menggunakan proyek yang sudah dibuat.</p><input name="reference" aria-label="Referensi pesanan" required maxLength={100} className={field} placeholder="SO-2026-001" /><input name="customer" aria-label="Nama pelanggan pesanan" required maxLength={255} className={field} placeholder="Nama pelanggan" /><input name="name" aria-label="Nama proyek pesanan" required maxLength={255} className={field} placeholder="Nama proyek" /><textarea name="lines" aria-label="Rincian pekerjaan pesanan" required maxLength={25000} rows={4} className={field} placeholder="Satu pekerjaan per baris, maksimal 100 pekerjaan" /><button disabled={busy} className="btn btn-primary btn-sm">Buat proyek & WO</button>
      </form>}
    </section>}
  </div>;
}

function MilestoneForm({ milestone, busy, onSubmit }: { milestone?: Milestone; busy: boolean; onSubmit: (name: string, deadline: string | null) => void }) {
  return <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); const values = new FormData(event.currentTarget); onSubmit(String(values.get("name")), String(values.get("deadline")) || null); }}><label className="flex-1 text-xs">Nama milestone<input name="name" defaultValue={milestone?.name ?? ""} required maxLength={160} className={field} /></label><label className="text-xs">Target<input name="deadline" type="date" defaultValue={milestone?.deadline ?? ""} className={field} /></label><button disabled={busy} className="btn btn-default btn-sm">{milestone ? "Simpan" : "Tambah milestone"}</button></form>;
}

function ReportPanel({ report }: { report: ProjectReport }) {
  const max = Math.max(1, ...report.burndown.map((point) => point.remaining));
  const points = report.burndown.map((point, index) => `${20 + index * 560 / Math.max(1, report.burndown.length - 1)},${155 - point.remaining * 135 / max}`).join(" ");
  return <div className="space-y-5">
    <div className="grid grid-cols-2 gap-3 md:grid-cols-6">{[["Progres", `${report.progress}%`], ["Selesai", `${report.done}/${report.total}`], ["Terlambat", report.overdue], ["Terhambat", report.blocked], ["Estimasi", `${(report.estimated_minutes / 60).toFixed(1)} jam`], ["Tercatat", `${(report.logged_minutes / 60).toFixed(1)} jam`]].map(([name, value]) => <div key={name} className="rounded-xl border border-border bg-bg-ctrl p-4"><p className="text-xs text-text-muted">{name}</p><p className="mt-2 text-xl font-bold">{value}</p></div>)}</div>
    <div className="grid gap-6 lg:grid-cols-2"><div className="rounded-xl border border-border p-4"><h3 className="text-sm font-semibold">Pekerjaan tersisa · 30 hari</h3><svg viewBox="0 0 600 180" role="img" aria-label="Grafik burndown pekerjaan tersisa" className="mt-3 w-full"><line x1="20" y1="155" x2="580" y2="155" stroke="currentColor" opacity=".15" /><polyline points={points} fill="none" stroke="var(--primary, #2563eb)" strokeWidth="3" /><text x="20" y="175" fontSize="10" fill="currentColor">{report.burndown[0]?.date}</text><text x="500" y="175" fontSize="10" fill="currentColor">{report.burndown.at(-1)?.date}</text></svg>{report.history_complete === false && <p className="text-xs text-text-muted">Sebagian WO lama tidak memiliki tanggal penyelesaian; riwayat grafik belum lengkap.</p>}</div>
      <div className="overflow-auto rounded-xl border border-border p-4"><h3 className="mb-3 text-sm font-semibold">Beban kerja & timesheet</h3><table className="w-full text-left text-xs"><thead><tr><th className="py-2">Penanggung jawab</th><th>WO</th><th>Selesai</th><th>Jam</th></tr></thead><tbody>{report.assignees.map((person) => <tr key={person.id} className="border-t border-border"><td className="py-2">{person.name}</td><td>{person.tasks}</td><td>{person.done}</td><td>{(person.minutes / 60).toFixed(1)}</td></tr>)}</tbody></table><p className="mt-2 text-xs text-text-muted">WO dengan beberapa penanggung jawab dihitung pada masing-masing orang.</p></div></div>
    <div className="grid gap-3 md:grid-cols-3">{report.milestones.map((milestone) => <div key={milestone.id} className="rounded-lg border border-border p-3 text-sm"><p className="font-semibold">{milestone.name}</p><p className="text-xs text-text-muted">{milestone.done}/{milestone.tasks} WO selesai · {milestone.deadline ?? "Tanpa tanggal"} · {milestone.reached_at ? "Tercapai" : "Berjalan"}</p></div>)}</div>
    <details><summary className="cursor-pointer text-xs text-primary">Lihat data grafik</summary><table className="mt-2 text-xs"><thead><tr><th>Tanggal</th><th className="px-4">Tersisa</th></tr></thead><tbody>{report.burndown.map((point) => <tr key={point.date}><td>{point.date}</td><td className="px-4">{point.remaining}</td></tr>)}</tbody></table></details>
  </div>;
}
