"use client";

import { useMemo, useState } from "react";
import { DndContext, PointerSensor, TouchSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { CalendarDays, ChevronLeft, ChevronRight, GripVertical, MessageSquareText, Search } from "lucide-react";
import { workspaceApi, type BoardTask } from "@/lib/api/workspace";
import type { Coordination } from "@/lib/api/workspace-coordination";
import { apiErrorText } from "@/lib/api/client";
import { StatusBadge } from "./shared/status-badge";
import { STATUS_LABEL, TASK_STATUSES } from "./constants";
import { addDays, calendarDate, monthWeeks, moveDeadline, shortDate, weekEnd } from "./weekly-schedule";

interface Props {
  tasks: BoardTask[];
  data: Coordination;
  api?: typeof workspaceApi;
  canPlan: boolean;
  onOpen: (id: string) => void;
  onChanged: () => Promise<void>;
}
type Row = { task: BoardTask; end: string | null; update?: { work_date: string; count: number } };

export function WeeklyTimeline({ tasks, data, api = workspaceApi, canPlan, onOpen, onChanged }: Props) {
  const today = calendarDate(new Date().toISOString())!;
  const [month, setMonth] = useState(today.slice(0, 7));
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  // Only the dedicated grip starts a drag, so card clicks keep their usual behavior.
  const sensors = useSensors(useSensor(PointerSensor), useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }));
  const rows = useMemo(() => {
    const controls = new Map(data.controls.map(c => [c.task_id, c]));
    return tasks.map(task => ({ task, end: calendarDate(controls.get(task.id)?.planned_end ?? task.deadline), update: data.daily_updates?.[task.id] }))
      .sort((a, b) => (a.end ?? "9999").localeCompare(b.end ?? "9999") || a.task.name.localeCompare(b.task.name));
  }, [tasks, data]);
  const filtered = rows.filter(({ task }) => (showClosed || status === "done" || status === "cancelled" || !["done", "cancelled"].includes(task.status)) &&
    (!status || (task.status === "overdue" ? "todo" : task.status) === status) && `${task.name} ${task.assigned_name ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  const weeks = monthWeeks(month);
  const visible = filtered.filter(row => row.end && weeks.includes(weekEnd(row.end)));
  const unscheduled = filtered.filter(row => !row.end);
  async function reschedule(row: Row, end: string) {
    if (busy || !canPlan || row.end === end) return;
    if (!row.task.updated_at) { setError("Versi WO belum tersedia. Muat ulang proyek sebelum mengubah jadwal."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      await api.rescheduleWorkOrder(row.task.id, { end_date: end, expected_updated_at: row.task.updated_at });
      await onChanged(); setMessage(`Jadwal ${row.task.name} dipindahkan ke ${shortDate(end)}.`);
    } catch (err) {
      setError(apiErrorText(err, "Jadwal belum tersimpan"));
      await onChanged();
    } finally { setBusy(false); }
  }
  function dragEnd(event: DragEndEvent) {
    if (!event.over) return;
    const row = rows.find(r => r.task.id === event.active.id);
    const target = String(event.over.id);
    if (row && weeks.includes(target)) void reschedule(row, moveDeadline(row.end, target));
  }
  function moveMonth(delta: number) {
    const value = new Date(`${month}-01T00:00:00Z`);
    value.setUTCMonth(value.getUTCMonth() + delta);
    setMonth(value.toISOString().slice(0, 7));
  }
  return <section className="space-y-5" aria-label="Kanban timeline mingguan">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><div className="flex items-center gap-2"><CalendarDays aria-hidden className="size-5 text-primary" /><h2 className="text-lg font-bold tracking-tight">Timeline mingguan</h2></div>
        <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-text-muted">Setiap WO masuk ke minggu tanggal selesainya. Senin–Minggu, dengan status dan logbook di kartu yang sama.</p></div>
      <div className="flex items-center gap-1 rounded-xl border border-border bg-bg p-1">
        <button className="btn btn-ghost btn-icon min-h-10" aria-label="Bulan sebelumnya" onClick={() => moveMonth(-1)}><ChevronLeft className="size-4" /></button>
        <input aria-label="Bulan timeline" type="month" value={month} onChange={e => { if (/^\d{4}-\d{2}$/.test(e.target.value)) setMonth(e.target.value); }} className="min-h-10 min-w-0 max-w-[175px] bg-transparent px-1 text-sm font-semibold" />
        <button className="btn btn-ghost btn-icon min-h-10" aria-label="Bulan berikutnya" onClick={() => moveMonth(1)}><ChevronRight className="size-4" /></button>
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border-soft bg-bg p-3">
      <label className="relative min-w-[180px] flex-1"><Search aria-hidden className="absolute left-3 top-3 size-4 text-text-muted" /><span className="sr-only">Cari WO atau PIC</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Cari WO atau PIC…" className="field-input pl-9" /></label>
      <select aria-label="Status timeline" value={status} onChange={e => setStatus(e.target.value)} className="field-input w-auto"><option value="">Semua status</option>{TASK_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
      <label className="flex min-h-10 items-center gap-2 text-xs text-text-muted"><input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} />Tampilkan Finish & Cancelled</label>
      <button className="btn btn-default btn-sm min-h-10" onClick={() => setMonth(today.slice(0, 7))}>Bulan ini</button>
    </div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <p role="status" aria-live="polite" className="text-xs text-text-muted">{busy ? "Menyimpan jadwal…" : message || `${visible.length} WO terjadwal · ${unscheduled.length} belum dijadwalkan${canPlan ? " · Geser kartu untuk memindahkan minggu, atau gunakan Ubah jadwal." : ""}`}</p>
    {!visible.length && filtered.some(row => row.end) && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-bg p-4 text-sm"><p className="text-text-muted">Tidak ada WO pada rentang minggu ini.</p><button className="btn btn-default btn-sm" onClick={() => setMonth(filtered.find(row => row.end)!.end!.slice(0, 7))}>Lihat jadwal WO</button></div>}
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={dragEnd} accessibility={{ screenReaderInstructions: { draggable: "Geser kartu dengan pointer untuk memindahkan minggu. Dengan keyboard, gunakan Ubah jadwal pada kartu dan pilih tanggal selesai." } }}>
      <div className="overflow-x-auto pb-4" tabIndex={0} role="region" aria-label="Kolom minggu, geser horizontal untuk melihat minggu lain">
        <div className="flex items-stretch gap-4">{weeks.map(end => <WeekColumn key={end} end={end} current={weekEnd(today) === end}>
          {filtered.filter(row => row.end && weekEnd(row.end) === end).map(row => <WorkCard key={row.task.id} row={row} today={today} canPlan={canPlan && !busy} onOpen={onOpen} onSchedule={end => reschedule(row, end)} />)}
          {!filtered.some(row => row.end && weekEnd(row.end) === end) && <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-xs leading-relaxed text-text-muted">Belum ada target selesai<br />di minggu ini</p>}
        </WeekColumn>)}
          {!!unscheduled.length && <div className="w-[280px] shrink-0 space-y-3 rounded-2xl border border-dashed border-border bg-bg-ctrl/50 p-3"><h3 className="px-1 py-2 text-sm font-semibold">Belum dijadwalkan <span className="ml-1 text-text-muted">{unscheduled.length}</span></h3>{unscheduled.map(row => <WorkCard key={row.task.id} row={row} today={today} canPlan={canPlan && !busy} onOpen={onOpen} onSchedule={end => reschedule(row, end)} />)}</div>}
        </div>
      </div>
    </DndContext>
  </section>;
}

function WeekColumn({ end, current, children }: { end: string; current: boolean; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: end });
  return <div ref={setNodeRef} className={`min-h-[320px] w-[280px] shrink-0 rounded-2xl border p-3 transition-colors ${isOver ? "border-primary bg-primary/10" : current ? "border-primary/40 bg-primary/5" : "border-border-soft bg-bg-ctrl/60"}`}>
    <header className="mb-4 px-1 pt-1"><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-bold">Minggu {shortDate(end)}</h3>{current && <span className="rounded-md bg-primary px-1.5 py-1 text-[10px] font-semibold text-white">Kini</span>}</div><p className="mt-1.5 text-xs text-text-muted">{shortDate(addDays(end, -6))} – {shortDate(end)} {end.slice(0, 4)}</p></header>
    <div className="space-y-3">{children}</div>
  </div>;
}

function WorkCard({ row, today, canPlan, onOpen, onSchedule }: { row: Row; today: string; canPlan: boolean; onOpen: (id: string) => void; onSchedule: (end: string) => Promise<void> }) {
  const closed = ["done", "cancelled"].includes(row.task.status);
  const editable = canPlan && !closed;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: row.task.id, disabled: !editable });
  const late = !closed && !!row.end && row.end < today;
  return <article ref={setNodeRef} style={transform ? { transform: `translate3d(${transform.x}px,${transform.y}px,0)`, zIndex: 20, position: "relative" } : undefined} className={`rounded-xl border bg-bg p-4 shadow-sm ${isDragging ? "border-primary opacity-80 shadow-lg" : "border-border"}`}>
    <div className="flex items-center justify-between gap-2"><StatusBadge status={row.task.status} />{editable && <button {...attributes} {...listeners} aria-label={`Geser jadwal ${row.task.name}`} className="-mr-2 flex size-9 touch-none items-center justify-center rounded-lg text-text-muted hover:bg-bg-hover"><GripVertical className="size-4" /></button>}</div>
    <button onClick={() => onOpen(row.task.id)} className="mt-3 min-h-11 w-full text-left text-sm font-semibold leading-relaxed hover:text-primary focus-visible:outline-primary">{row.task.name}</button>
    {row.task.description && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-text-muted">{row.task.description}</p>}
    <div className="mt-4 flex items-center gap-2 border-t border-border-soft pt-3"><span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">{(row.task.assigned_name ?? "?").split(" ").slice(0, 2).map(n => n[0]).join("")}</span><span className="truncate text-xs font-medium">{row.task.assigned_name ?? "PIC belum ditetapkan"}</span></div>
    <p className={`mt-3 flex items-center gap-1.5 text-xs ${late ? "font-medium text-red-600 dark:text-red-400" : "text-text-muted"}`}><CalendarDays aria-hidden className="size-3.5" />{row.end ? `Target ${shortDate(row.end)}${late ? " · Terlambat" : ""}` : "Belum ada tanggal selesai"}</p>
    {row.update && <p className="mt-2 flex items-center gap-1.5 text-xs text-text-muted"><MessageSquareText aria-hidden className="size-3.5" />{row.update.count} log · {shortDate(row.update.work_date)}</p>}
    {editable && <details className="mt-3 border-t border-border-soft pt-2"><summary className="cursor-pointer py-2 text-xs font-medium text-primary">Ubah jadwal</summary><form className="mt-1 space-y-2" onSubmit={async e => { e.preventDefault(); const end = String(new FormData(e.currentTarget).get("end")); if (calendarDate(end)) await onSchedule(end); }}><label className="block text-xs text-text-muted">Tanggal selesai<input type="date" name="end" required defaultValue={row.end ?? today} className="field-input mt-1" /></label><button className="btn btn-default btn-sm w-full">Simpan jadwal</button></form></details>}
  </article>;
}
