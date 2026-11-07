"use client";
import { useState } from "react";
import { ArrowRight, Circle, CircleCheck, CircleX, ClipboardCheck, Play } from "lucide-react";
import type { TaskStatus } from "@/lib/api/workspace";
import type { WorkOrderDetail } from "@/lib/api/workspace-logbook";
import { ActionForm, Field, textValue } from "./operations-ui";
import { STATUS_LABEL, TASK_STATUSES } from "./constants";

const icons = { todo: Circle, in_progress: Play, pending_review: ClipboardCheck, done: CircleCheck, cancelled: CircleX };

export function WorkOrderStatus({ data, onChange }: { data: WorkOrderDetail; onChange: (status: TaskStatus, note: string) => Promise<void> }) {
  const [selected, setSelected] = useState<TaskStatus | null>(null);
  const current = data.task.status === "overdue" ? "todo" : data.task.status;
  const labels: Partial<Record<TaskStatus, string>> = {
    in_progress: current === "pending_review" ? "Minta revisi · On Progress" : "Mulai · On Progress",
    pending_review: "Kirim ke Need Review", done: "Setujui & Finish", cancelled: "Batalkan WO", todo: "Buka kembali · To Do",
  };
  return <section className="space-y-4 rounded-xl border border-border bg-bg p-4" aria-label="Status pekerjaan">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-3">{TASK_STATUSES.map((status, i) => { const Icon = icons[status]; return <div key={status} className="flex items-center gap-3">{i > 0 && <ArrowRight aria-hidden className="size-3 text-text-muted/50" />}<span aria-current={current === status ? "step" : undefined} className={`inline-flex items-center gap-1.5 text-xs ${current === status ? "font-bold text-primary" : "text-text-muted"}`}><Icon aria-hidden className="size-3.5" />{STATUS_LABEL[status]}</span></div>; })}</div>
    {!!data.allowed_statuses?.length && <div className="flex flex-wrap gap-2 border-t border-border-soft pt-4">{data.allowed_statuses.map(status => status === "cancelled" || (status === "in_progress" && current === "pending_review") || status === "todo" ? <button key={status} onClick={() => setSelected(status)} className="btn btn-ghost btn-sm min-h-10 text-text-muted">{labels[status]}</button> : <ActionForm key={status} className="contents" submitLabel={labels[status]} onSubmit={() => onChange(status, "")}>{null}</ActionForm>)}</div>}
    {selected && <div className="rounded-lg bg-bg-ctrl p-4"><p className="mb-3 text-sm font-semibold">{labels[selected]}</p><p className="mb-4 text-xs leading-relaxed text-text-muted">{selected === "pending_review" ? "Hasil logbook akan dikirim untuk diperiksa. Role dengan permission review dapat menyetujui atau meminta revisi." : selected === "cancelled" ? "Catatan dan lampiran tetap tersimpan. Isi alasan agar tim mengetahui perubahan ini." : selected === "todo" ? "WO dibuka kembali. Riwayat pekerjaan sebelumnya tetap tersimpan." : selected === "done" ? "Pastikan hasil pekerjaan dan dokumentasinya sudah diperiksa." : "Setelah On Progress, PIC dapat mencatat update harian di logbook."}</p>
      <ActionForm key={selected} submitLabel={selected === "cancelled" ? "Konfirmasi pembatalan" : "Simpan status"} onSubmit={async form => { await onChange(selected, textValue(form, "note")); setSelected(null); }}>
        {(selected === "cancelled" || selected === "todo" || current === "pending_review") && <Field label={selected === "cancelled" ? "Alasan pembatalan" : "Catatan (opsional)"}><textarea name="note" required={selected === "cancelled"} maxLength={2000} rows={2} className="field-input" /></Field>}
      </ActionForm><button className="btn btn-ghost btn-sm mt-2" onClick={() => setSelected(null)}>Kembali</button>
    </div>}
    {!!data.status_history?.length && <details className="border-t border-border-soft pt-3"><summary className="cursor-pointer py-1 text-xs text-text-muted">Riwayat status</summary><div className="mt-3 space-y-3">{data.status_history.map(event => <div key={event.id} className="border-l-2 border-border pl-3"><p className="text-xs font-medium">{STATUS_LABEL[event.from]} → {STATUS_LABEL[event.status]}</p><p className="mt-1 text-xs text-text-muted">{event.author_name} · {new Date(event.created_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</p>{event.note && <p className="mt-1 whitespace-pre-wrap text-sm">{event.note}</p>}</div>)}</div></details>}
  </section>;
}
