"use client";
import type { workspaceApi, BoardTask } from "@/lib/api/workspace";
import type { Coordination } from "@/lib/api/workspace-coordination";
import { ActionForm, Badge, Field, dateLabel, textValue } from "./operations-ui";

export function WorkControlPanel({api, projectId, task, data, canRelease, onChanged}: {api: typeof workspaceApi; projectId: string; task: BoardTask; data: Coordination; canRelease: boolean; onChanged: () => void}) {
  const control = data.controls.find(c => c.task_id === task.id), state = data.readiness.find(r => r.task_id === task.id);
  const eligible = data.people.filter(p => data.members.some(m => m.profile_id === p.id) || task.planning?.assignees.some(a => a.id === p.id) || p.id === control?.pic_id);
  const localTime = (value?: string | null) => {if (!value) return ""; const d = new Date(value); return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
  return <div className="space-y-5 rounded-xl border border-border bg-bg p-4">
    <div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold">Izin & kesiapan kerja</h3><p className="mt-1 text-xs text-text-muted">PIC, jadwal, gambar dan material diperiksa sebelum WO dimulai.</p></div><Badge tone={state?.ready ? "good" : "warn"}>{state?.state ?? "Belum Siap"}</Badge></div>
    {!!state?.reasons.length && <ul className="list-disc space-y-1 pl-4 text-xs text-amber-800">{state.reasons.map(r => <li key={r}>{r}</li>)}</ul>}
    {control?.released_at && <p className="text-xs text-text-muted">Diizinkan oleh {control.released_by}, {dateLabel(control.released_at)}. {control.release_note}</p>}
    {canRelease && <>
      <details><summary className="cursor-pointer text-xs font-semibold text-primary">Atur PIC, jadwal & persyaratan</summary><ActionForm key={control?.planned_start ?? task.id} className="mt-3 grid gap-3 sm:grid-cols-2" onSaved={onChanged} onSubmit={f => api.saveWorkControl(projectId, task.id, {division:textValue(f,"division"), pic_id:textValue(f,"pic"), planned_start:new Date(textValue(f,"start")).toISOString(), planned_end:new Date(textValue(f,"end")).toISOString(), drawing_required:f.has("drawing"), material_required:f.has("material")})}>
        <Field label="Divisi"><input name="division" required maxLength={80} defaultValue={control?.division ?? "Produksi"} className="field-input" /></Field>
        <Field label="PIC"><select name="pic" required defaultValue={control?.pic_id ?? ""} className="field-input"><option value="">Pilih anggota proyek</option>{eligible.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="Mulai pekerjaan"><input name="start" required type="datetime-local" defaultValue={localTime(control?.planned_start)} className="field-input" /></Field>
        <Field label="Selesai pekerjaan"><input name="end" required type="datetime-local" defaultValue={localTime(control?.planned_end)} className="field-input" /></Field>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="drawing" defaultChecked={control?.drawing_required ?? true} />Memerlukan gambar disetujui klien</label><label className="flex items-center gap-2 text-xs"><input type="checkbox" name="material" defaultChecked={control?.material_required ?? true} />Memerlukan material siap</label>
      </ActionForm></details>
      {control && <ActionForm submitLabel={control.released_at ? "Cabut izin mulai" : "Izinkan mulai pekerjaan"} onSaved={onChanged} onSubmit={f => api.releaseWork(projectId, task.id, {note:textValue(f,"note"), release:!control.released_at})}><Field label="Catatan keputusan / alasan persyaratan"><textarea name="note" minLength={5} maxLength={2000} required className="field-input" placeholder="Dasar keputusan izin kerja" /></Field></ActionForm>}
    </>}
  </div>;
}
