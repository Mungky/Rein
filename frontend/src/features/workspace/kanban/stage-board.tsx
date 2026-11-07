"use client";

import { useCallback, useEffect, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ArrowLeft, ChevronDown, ChevronUp, Loader2, Plus, RefreshCw } from "lucide-react";
import { workspaceApi, createWorkspaceApi, type ProjectBoard, type Project, type TaskStage, type Task, type BoardTask } from "@/lib/api/workspace";
import { StatusBadge } from "../shared/status-badge";
import { WoDetailDrawer } from "../shared/wo-detail-drawer";
import { KanbanColumn } from "./kanban-column";
import { KanbanCard } from "./kanban-card";
import { moveBoardCard } from "./board-state";
import { ApiClient, apiErrorText } from "@/lib/api/client";
import { ProjectTools } from "../project-tools";
import { ProjectTaskCreator } from "../project-task-creator";
import { WorkOrderForm } from "../work-order-form";
import { TaskList, TaskCalendar, TaskTimeline, filterBoardTasks, emptyTaskFilters } from "../project-task-views";

export const previewWorkspaceApi = createWorkspaceApi(new ApiClient("http://127.0.0.1:8001", false));

interface Props {
  project: Pick<Project, "id" | "name" | "rpo_number">;
  preview?: boolean;
  canManage: boolean;
  canExecute: boolean;
  canReview: boolean;
  userId?: string;
  onBack?: () => void;
  onProjectCreated?: (id: string) => void;
}

export function StageBoard({ preview = false, project, canManage, canExecute, canReview, userId, onBack, onProjectCreated }: Props) {
  const api = preview ? previewWorkspaceApi : workspaceApi;
  const suite = preview || process.env.NEXT_PUBLIC_WORKSPACE_PROJECT_SUITE_ENABLED === "1";
  const [board, setBoard] = useState<ProjectBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newStage, setNewStage] = useState("");
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const [creatingWo, setCreatingWo] = useState(false);
  const [view, setView] = useState("board");
  const [filters, setFilters] = useState(emptyTaskFilters);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const load = useCallback(async () => {
    try { setBoard(await api.getBoard(project.id)); setError(null); }
    catch (err) { setError(apiErrorText(err, "Papan belum dapat dimuat. Periksa konfigurasi dan migrasi Project.")); }
  }, [api, project.id]);
  useEffect(() => {
    let active = true;
    api.getBoard(project.id).then((data) => { if (active) setBoard(data); })
      .catch((err) => { if (active) setError(apiErrorText(err, "Papan belum dapat dimuat")); });
    return () => { active = false; };
  }, [api, project.id]);
  useEffect(() => {
    if (!suite || busy) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 60000);
    return () => clearInterval(timer);
  }, [suite, busy, load]);

  async function mutate(action: () => Promise<ProjectBoard>, optimistic?: ProjectBoard) {
    if (busy) return false;
    const previous = board;
    setBusy(true); setError(null);
    if (optimistic) setBoard(optimistic);
    try { setBoard(await action()); return true; }
    catch (err) { setBoard(previous); setError(apiErrorText(err, "Perubahan tidak tersimpan. Muat ulang lalu coba lagi.")); return false; }
    finally { setBusy(false); }
  }
  function canMove(task: BoardTask) {
    return canManage || task.assigned_to === userId || !!task.planning?.assignees.some((person) => person.id === userId);
  }
  function move(taskId: string, stageId: string, beforeId: string | null = null) {
    if (!board) return;
    void mutate(() => api.moveBoardTask(project.id, taskId, { stage_id: stageId, before_task_id: beforeId,
      expected_version: board.version }), moveBoardCard(board, taskId, stageId, beforeId));
  }
  function onDragEnd({ active, over }: DragEndEvent) {
    if (!board || !over || busy || active.id === over.id) return;
    const target = board.tasks.find((task) => task.id === String(over.id));
    const stageId = target?.stage_id ?? String(over.id);
    if (board.stages.some((stage) => stage.id === stageId)) move(String(active.id), stageId, target?.id ?? null);
  }
  function saveStage(stage: TaskStage) {
    if (board) void mutate(() => api.updateStage(project.id, stage, board.version));
  }
  const filtered = filterBoardTasks(board?.tasks ?? [], filters);
  const people = [...new Map((board?.tasks ?? []).flatMap((task) => task.planning?.assignees ?? []).map((person) => [person.id, person])).values()];
  const tags = [...new Map((board?.tasks ?? []).flatMap((task) => task.planning?.tags ?? []).map((tag) => [tag.id, tag])).values()];
  const activeTask = board?.tasks.find((task) => task.id === openTask?.id);

  return <div className="flex h-full min-h-[520px] flex-col">
    <div className="flex flex-wrap items-center gap-3 border-b border-border-soft bg-bg px-5 py-3">
      {onBack && <button onClick={onBack} className="btn btn-ghost btn-icon btn-sm" aria-label="Kembali ke proyek"><ArrowLeft className="size-4" /></button>}
      <div><p className="text-[11px] font-mono text-primary">{project.rpo_number || "PROJECT"}</p><h2 className="text-[16px] font-bold">{project.name}</h2></div>
      <div className="flex-1" />
      {busy && <Loader2 className="size-4 animate-spin" aria-label="Menyimpan" />}
      <span className="text-xs text-text-muted">{board?.tasks.length ?? 0} Work Order</span>
      {suite && canManage && <ProjectTaskCreator api={api} projectId={project.id} onOpenCreate={() => setCreatingWo(true)} onCreated={() => void load()} />}
      <button disabled={busy} onClick={() => void load()} className="btn btn-ghost btn-sm"><RefreshCw className="size-3.5" /> Muat ulang</button>
    </div>
    {suite && <ProjectTools api={api} projectId={project.id} canManage={canManage} preview={preview}
      onChanged={() => void load()} onProjectCreated={onProjectCreated} />}
    <p className="border-b border-border-soft px-5 py-2 text-xs text-text-muted">Kolom menunjukkan tahap kerja. Status dan persetujuan WO dikelola melalui detail pekerjaan.</p>
    {error && <div role="alert" className="mx-4 mt-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
    {!board && !error && <div className="p-12 text-center"><Loader2 className="mx-auto size-5 animate-spin" aria-label="Memuat papan" /></div>}
    {board && <>
      {suite && <div className="flex flex-wrap items-center gap-2 border-b border-border-soft px-4 py-3">
        <div className="flex gap-1">{[["board", "Papan"], ["list", "Daftar"], ["calendar", "Kalender"], ["timeline", "Timeline"]].map(([key, name]) => <button key={key} className={`btn btn-sm ${view === key ? "btn-primary" : "btn-ghost"}`} onClick={() => setView(key)}>{name}</button>)}</div>
        <input aria-label="Cari pekerjaan" value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} placeholder="Cari pekerjaan…" className="field-input max-w-[210px]" />
        <select aria-label="Filter status" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })} className="field-input w-auto"><option value="">Semua status</option><option value="todo">Todo</option><option value="in_progress">Dikerjakan</option><option value="pending_review">Menunggu Review</option><option value="done">Selesai</option></select>
        <select aria-label="Filter penanggung jawab" value={filters.assignee_id} onChange={(event) => setFilters({ ...filters, assignee_id: event.target.value })} className="field-input max-w-[155px]"><option value="">Semua orang</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>
        <select aria-label="Filter tag" value={filters.tag_id} onChange={(event) => setFilters({ ...filters, tag_id: event.target.value })} className="field-input max-w-[130px]"><option value="">Semua tag</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select>
        <select aria-label="Filter prioritas" value={filters.priority} onChange={(event) => setFilters({ ...filters, priority: event.target.value })} className="field-input w-auto"><option value="">Semua prioritas</option>{["Normal", "Menengah", "Tinggi", "Mendesak"].map((name, i) => <option key={name} value={i}>{name}</option>)}</select>
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={!!filters.blocked} onChange={(event) => setFilters({ ...filters, blocked: event.target.checked ? "true" : "" })} /> Terhambat</label>
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={!!filters.overdue} onChange={(event) => setFilters({ ...filters, overdue: event.target.checked ? "true" : "" })} /> Terlambat</label>
      </div>}
      {board.stages.length === 0 && <div className="p-8 text-center"><h3 className="font-semibold">Susun tahap proyek Anda</h3>{canManage && <button disabled={busy} onClick={() => void mutate(() => api.initializeBoard(project.id, board.version))} className="btn btn-primary mt-4">Buat tahap awal</button>}</div>}
      {view === "list" && suite ? <TaskList key={JSON.stringify(filters) + board.version} api={api} projectId={project.id} filters={filters} tasks={board.tasks} onOpen={setOpenTask} />
        : view === "calendar" ? <TaskCalendar tasks={filtered} onOpen={setOpenTask} />
        : view === "timeline" ? <TaskTimeline tasks={filtered} onOpen={setOpenTask} />
        : <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <div className="flex flex-1 gap-3 overflow-x-auto bg-bg-ctrl/40 p-4">
            {board.stages.map((stage, index) => {
              const tasks = filtered.filter((task) => task.stage_id === stage.id);
              const total = board.tasks.filter((task) => task.stage_id === stage.id).length;
              return <KanbanColumn key={stage.id} id={stage.id} label={stage.name} count={tasks.length} accentClass="border-l-primary/60">
                <div className="flex items-center justify-between gap-1 px-1 pb-2">
                  <button disabled={busy} onClick={() => canManage ? saveStage({ ...stage, folded: !stage.folded }) : setBoard({ ...board, stages: board.stages.map((item) => item.id === stage.id ? { ...item, folded: !item.folded } : item) })} className="btn btn-ghost btn-sm" aria-expanded={!stage.folded}>{stage.folded ? <ChevronDown className="size-3" /> : <ChevronUp className="size-3" />}{stage.folded ? "Tampilkan" : "Ringkas"}</button>
                  {canManage && <details className="relative text-xs"><summary className="cursor-pointer rounded px-2 py-1">Atur tahap</summary><div className="absolute right-0 z-20 mt-2 w-56 space-y-2 rounded-lg border border-border bg-bg p-3 shadow-lg">
                    <form onSubmit={(event) => { event.preventDefault(); saveStage({ ...stage, name: String(new FormData(event.currentTarget).get("name")).trim() }); }}><label className="block text-text-muted">Nama tahap<input name="name" aria-label={`Nama tahap ${stage.name}`} defaultValue={stage.name} required maxLength={80} className="mt-1 w-full rounded border border-border bg-bg px-2 py-1.5" /></label><button disabled={busy} className="btn btn-primary btn-sm mt-2">Simpan nama</button></form>
                    <div className="flex gap-2"><button disabled={busy || index === 0} className="btn btn-ghost btn-sm" onClick={() => saveStage({ ...stage, sequence: index - 1 })}>Ke kiri</button><button disabled={busy || index === board.stages.length - 1} className="btn btn-ghost btn-sm" onClick={() => saveStage({ ...stage, sequence: index + 1 })}>Ke kanan</button></div>
                    <button disabled={busy || total > 0 || board.stages.length === 1} className="btn btn-ghost btn-sm text-red-600" onClick={() => void mutate(() => api.deleteStage(project.id, stage.id, board.version))}>Hapus tahap kosong</button>
                  </div></details>}
                </div>
                {!stage.folded && <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
                  {tasks.map((task) => <div key={task.id} className="space-y-1.5">
                    <KanbanCard id={task.id} title={`${task.planning?.parent_id ? "↳ " : ""}${task.name}`} subtitle={task.phase_name} status={task.status}
                      assigneeName={task.planning?.assignees.map((person) => person.name).join(", ") || task.assigned_name}
                      deadline={task.status === "done" ? null : task.deadline} location={task.location} onClick={() => setOpenTask(task)} draggable={!busy && canMove(task)} />
                    {task.planning && <div className="flex flex-wrap gap-1 px-1 text-[10px]">{task.planning.blocked && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900">Menunggu prasyarat</span>}{task.planning.overdue && <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-700">Terlambat</span>}{task.planning.priority >= 2 && <span className="rounded bg-primary-soft px-1.5 py-0.5">{task.planning.priority === 3 ? "Mendesak" : "Prioritas tinggi"}</span>}{task.planning.tags.map((tag) => <span key={tag.id} className="rounded bg-bg-ctrl px-1.5 py-0.5">{tag.name}</span>)}</div>}
                    <div className="flex items-center justify-between px-1"><StatusBadge status={task.status} /><label className="text-[10px] text-text-muted">Pindah ke <select aria-label={`Tahap ${task.name}`} value={stage.id} disabled={busy || !canMove(task)} className="max-w-[125px] rounded border border-border bg-bg text-[11px]" onChange={(event) => move(task.id, event.target.value)}>{board.stages.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label></div>
                  </div>)}
                  {tasks.length === 0 && <p className="px-2 py-6 text-center text-xs text-text-muted">Belum ada pekerjaan di tahap ini</p>}
                </SortableContext>}
              </KanbanColumn>;
            })}
            {canManage && board.stages.length > 0 && <form className="w-[250px] shrink-0 self-start rounded-xl border border-dashed border-border p-4" onSubmit={async (event) => { event.preventDefault(); if (newStage.trim() && await mutate(() => api.createStage(project.id, newStage.trim(), board.version))) setNewStage(""); }}><label className="text-xs font-semibold">Tambah tahap<input aria-label="Nama tahap baru" value={newStage} onChange={(event) => setNewStage(event.target.value)} maxLength={80} required placeholder="Contoh: Pengadaan" className="mt-3 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm" /></label><button disabled={busy || !newStage.trim()} className="btn btn-ghost btn-sm mt-2"><Plus className="size-3" /> Tambah tahap</button></form>}
          </div>
        </DndContext>}
    </>}
    {openTask && <WoDetailDrawer projectFeatures={suite} api={api} taskId={openTask.id} initial={openTask} rpoNumber={project.rpo_number} canManage={canManage}
      canExecute={canExecute || openTask.assigned_to === userId || !!activeTask?.planning?.assignees.some((person) => person.id === userId)} canReview={canReview}
      onClose={() => setOpenTask(null)} onTaskChanged={(task) => { setOpenTask(task); void load(); }} />}
    {creatingWo && <div className="fixed inset-0 z-50 bg-bg"><WorkOrderForm api={api} projectId={project.id} projectName={project.name} fullPage onClose={() => setCreatingWo(false)} onSaved={() => { setCreatingWo(false); void load(); }} /></div>}
  </div>;
}
