"use client";
import { useEffect, useState } from "react";
import type { BoardTask, workspaceApi } from "@/lib/api/workspace";
import { StatusBadge } from "./shared/status-badge";

export type TaskFilters = { q: string; status: string; assignee_id: string; tag_id: string; priority: string; blocked: string; overdue: string };
export const emptyTaskFilters: TaskFilters = { q: "", status: "", assignee_id: "", tag_id: "", priority: "", blocked: "", overdue: "" };

export function filterBoardTasks(tasks: BoardTask[], filters: TaskFilters) {
  const query = filters.q.trim().toLocaleLowerCase();
  return tasks.filter((task) => (!query || task.name.toLocaleLowerCase().includes(query))
    && (!filters.status || task.status === filters.status)
    && (!filters.assignee_id || task.assigned_to === filters.assignee_id || task.planning?.assignees.some((person) => person.id === filters.assignee_id))
    && (!filters.tag_id || task.planning?.tags.some((tag) => tag.id === filters.tag_id))
    && (!filters.priority || (task.planning?.priority ?? 0) === Number(filters.priority))
    && (!filters.blocked || task.planning?.blocked)
    && (!filters.overdue || task.planning?.overdue));
}

export function TaskList({ api, projectId, filters, tasks, onOpen }: { api: typeof workspaceApi; projectId: string; filters: TaskFilters; tasks: BoardTask[]; onOpen: (task: BoardTask) => void }) {
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<{ total: number; items: { id: string; name: string; status: string; deadline: string | null }[] } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== ""));
    api.searchProjectTasks(projectId, { ...params, offset: String(page * 25), limit: "25" })
      .then((data) => { if (active) { setResult(data); setError(false); } })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [api, projectId, filters, page]);
  if (error) return <p role="alert" className="p-5 text-sm text-red-600">Daftar belum dapat dimuat. Coba ganti filter atau muat ulang.</p>;
  return <div className="overflow-auto p-4"><table className="w-full min-w-[620px] text-left text-sm"><thead><tr className="border-b border-border"><th className="p-3">Pekerjaan</th><th>Penanggung jawab</th><th>Status</th><th>Deadline</th><th>Prioritas</th></tr></thead><tbody>{result?.items.map((item) => {
    const task = tasks.find((t) => t.id === item.id);
    return <tr key={item.id} className="border-b border-border-soft"><td className="p-3"><button className="font-semibold text-primary" onClick={() => task && onOpen(task)}>{item.name}</button>{task?.planning?.parent_id && <p className="text-xs text-text-muted">Subtugas: {tasks.find((t) => t.id === task.planning?.parent_id)?.name ?? "WO induk"}</p>}</td><td className="text-xs">{task?.planning?.assignees.map((p) => p.name).join(", ") || task?.assigned_name || "Belum ditugaskan"}</td><td><StatusBadge status={item.status} /></td><td className="text-xs">{item.deadline ?? "—"}</td><td className="text-xs">{["Normal", "Menengah", "Tinggi", "Mendesak"][task?.planning?.priority ?? 0]}</td></tr>;
  })}</tbody></table><div className="mt-3 flex items-center gap-3 text-xs"><button className="btn btn-default btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Sebelumnya</button><span>{result?.total ?? 0} WO · halaman {page + 1}</span><button className="btn btn-default btn-sm" disabled={!result || (page + 1) * 25 >= result.total} onClick={() => setPage(page + 1)}>Berikutnya</button></div></div>;
}

const isoDate = (year: number, month: number, day: number) => `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

export function TaskCalendar({ tasks, onOpen }: { tasks: BoardTask[]; onOpen: (task: BoardTask) => void }) {
  const [month, setMonth] = useState(() => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1); });
  const year = month.getFullYear(), m = month.getMonth();
  const blanks = (month.getDay() + 6) % 7;
  const count = new Date(year, m + 1, 0).getDate();
  return <div className="p-4"><div className="mb-4 flex items-center gap-4"><button className="btn btn-default btn-sm" onClick={() => setMonth(new Date(year, m - 1, 1))}>← Bulan lalu</button><h3 className="font-semibold">{month.toLocaleDateString("id-ID", { month: "long", year: "numeric" })}</h3><button className="btn btn-default btn-sm" onClick={() => setMonth(new Date(year, m + 1, 1))}>Bulan depan →</button></div>
    <div className="overflow-x-auto"><div className="grid min-w-[650px] grid-cols-7 overflow-hidden rounded-xl border border-border">{["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"].map((name) => <div key={name} className="bg-bg-ctrl p-2 text-center text-xs font-bold">{name}</div>)}{Array.from({ length: blanks }, (_, index) => <div key={`blank-${index}`} className="border-t border-border bg-bg-ctrl/40" />)}{Array.from({ length: count }, (_, index) => {
      const day = index + 1; const items = tasks.filter((task) => task.deadline === isoDate(year, m, day));
      return <div key={day} className="min-h-[95px] border-l border-t border-border p-2"><p className="text-xs text-text-muted">{day}</p>{items.map((task) => <button key={task.id} onClick={() => onOpen(task)} className="mt-1 block w-full rounded bg-primary-soft p-1.5 text-left text-[11px] text-primary">{task.name}</button>)}</div>;
    })}</div></div><p className="mt-3 text-xs text-text-muted">Kalender menampilkan deadline WO. {tasks.filter((task) => !task.deadline).length} pekerjaan belum memiliki deadline.</p></div>;
}

export function TaskTimeline({ tasks, onOpen }: { tasks: BoardTask[]; onOpen: (task: BoardTask) => void }) {
  const scheduled = tasks.filter((task) => task.deadline).map((task) => {
    const end = new Date(`${task.deadline}T12:00:00`).getTime();
    return { task, end, start: end - Math.max(0, Math.min(task.estimated_days ?? 1, 365) - 1) * 86400000 };
  }).sort((a, b) => a.start - b.start);
  if (!scheduled.length) return <p className="p-8 text-center text-sm text-text-muted">Tambahkan deadline dan estimasi hari pada WO untuk melihat timeline.</p>;
  const min = Math.min(...scheduled.map((item) => item.start));
  const max = Math.max(...scheduled.map((item) => item.end)) + 86400000;
  return <div className="overflow-x-auto p-5"><p className="mb-4 text-xs text-text-muted">{new Date(min).toLocaleDateString("id-ID")} — {new Date(max - 86400000).toLocaleDateString("id-ID")} · Berdasarkan estimasi hari dan deadline</p><div className="min-w-[650px] space-y-3">{scheduled.map(({ task, start, end }) => <div key={task.id} className="grid grid-cols-[220px_1fr] items-center gap-4"><button onClick={() => onOpen(task)} className="truncate text-left text-sm text-primary">{task.planning?.parent_id && "↳ "}{task.name}</button><div className="relative h-8 rounded bg-bg-ctrl"><button title={`${new Date(start).toLocaleDateString("id-ID")} – ${task.deadline}`} aria-label={`Detail timeline ${task.name}`} onClick={() => onOpen(task)} className={`absolute top-1 h-6 min-w-2 rounded ${task.status === "done" ? "bg-green-500" : task.planning?.blocked ? "bg-amber-400" : "bg-primary"}`} style={{ left: `${(start - min) / (max - min) * 100}%`, width: `${(end + 86400000 - start) / (max - min) * 100}%` }} /></div></div>)}</div><p className="mt-4 text-xs text-text-muted">{tasks.length - scheduled.length} WO belum terjadwal.</p></div>;
}
