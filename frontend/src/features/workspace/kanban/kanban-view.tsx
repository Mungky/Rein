"use client";

import { useState, useEffect, useMemo } from "react";
import { DndContext, DragEndEvent, DragOverlay, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { ChevronRight, Loader2 } from "lucide-react";
import { useWorkspaceStore } from "../store";
import { STATUS_LABEL, STATUS_COLOR, PROJECT_STATUSES, KANBAN_COLUMNS } from "../constants";
import type { Project, Phase, Task } from "@/lib/api/workspace";
import { workspaceApi } from "@/lib/api/workspace";
import { useAuth, useAuthDisplay } from "@/hooks/use-auth";
import { useCan } from "@/components/providers/permissions-provider";
import type { AppRole } from "@/lib/utils/roles";
import { StatusBadge } from "../shared/status-badge";
import { WoDetailDrawer } from "../shared/wo-detail-drawer";
import { KanbanColumn } from "./kanban-column";
import { KanbanCard } from "./kanban-card";
import { StageBoard } from "./stage-board";
import { toast } from "sonner";

export function KanbanView({ canManage }: { canManage: boolean; canComplete?: boolean }) {
  const store = useWorkspaceStore();
  const { projects, loading, updateProjectStatus } = store;
  const { role } = useAuthDisplay();
  const { profile } = useAuth();
  const canExecute = useCan(role as AppRole, "workspace:execute_wo");
  const canReview = useCan(role as AppRole, "workspace:review_wo") || canManage;

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [tasksByPhase, setTasksByPhase] = useState<Record<string, Task[]>>({});
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const [openTaskPhase, setOpenTaskPhase] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  // Load phases + tasks when a project is selected
  useEffect(() => {
    if (!selectedProjectId || process.env.NEXT_PUBLIC_WORKSPACE_STAGES_ENABLED === "1") return;
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      setLoadingDetail(true);
      try {
        const phs = await workspaceApi.listPhases(selectedProjectId);
        const entries = await Promise.all(phs.map(async (phase) => [phase.id, await workspaceApi.listTasks(phase.id)] as const));
        if (active) { setPhases(phs); setTasksByPhase(Object.fromEntries(entries)); }
      } catch { if (active) toast.error("Pekerjaan tidak dapat dimuat. Coba buka kembali proyek."); }
      finally { if (active) setLoadingDetail(false); }
    });
    return () => { active = false; };
  }, [selectedProjectId]);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  // === Project-level Kanban (overview) ===
  if (!selectedProjectId) {
    if (loading) {
      return <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-primary" /></div>;
    }
    const byStatus = Object.fromEntries(
      PROJECT_STATUSES.map((s) => [s, projects.filter((p) => p.status === s)])
    );

    function handleProjectDragEnd(event: DragEndEvent) {
      const { active, over } = event;
      if (!over) return;
      const projectId = String(active.id);
      const newStatus = String(over.id) as Project["status"];
      if (PROJECT_STATUSES.includes(newStatus)) {
        updateProjectStatus(projectId, newStatus);
      }
    }

    return (
      <div className="flex-1 overflow-x-auto bg-bg-ctrl/40">
        <DndContext sensors={sensors} onDragStart={({ active }) => setActiveId(String(active.id))} onDragEnd={handleProjectDragEnd}>
          <div className="flex gap-3 p-4 min-h-full">
            {PROJECT_STATUSES.map((status) => (
              <KanbanColumn
                key={status}
                id={status}
                label={STATUS_LABEL[status]}
                accentClass={PROJECT_ACCENT[status]}
                count={byStatus[status].length}
              >
                {byStatus[status].map((p) => (
                  <KanbanCard
                    key={p.id}
                    id={p.id}
                    title={p.name}
                    subtitle={p.client_name ?? undefined}
                    status={p.status}
                    rpoNumber={p.rpo_number}
                    progress={p.progress}
                    deadline={p.deadline}
                    onClick={() => setSelectedProjectId(p.id)}
                    draggable={canManage}
                  />
                ))}
              </KanbanColumn>
            ))}
          </div>
          <DragOverlay>
            {activeId ? (
              <div className="bg-bg border border-primary rounded-[var(--r)] p-3 shadow-[var(--shadow-lg)] opacity-90 w-[280px]">
                <div className="text-[12.5px] font-semibold">
                  {projects.find((p) => p.id === activeId)?.name}
                </div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    );
  }

  // === Task-level Kanban (project drilldown) ===
  if (!selectedProject) return null;

  if (process.env.NEXT_PUBLIC_WORKSPACE_STAGES_ENABLED === "1") {
    return <StageBoard key={selectedProject.id} project={selectedProject} canManage={canManage}
      canExecute={canExecute} canReview={canReview} userId={profile?.id}
      onProjectCreated={(id) => { void store.loadProjects().then(() => setSelectedProjectId(id)); }}
      onBack={() => setSelectedProjectId(null)} />;
  }

  const allTasks = Object.values(tasksByPhase).flat();
  const tasksByStatus = Object.fromEntries(
    KANBAN_COLUMNS.map((c) => [c.key, allTasks.filter((t) => t.status === c.key || (c.key === "in_progress" && t.status === "overdue"))])
  );

  function handleTaskDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const taskId = String(active.id);
    const newStatus = String(over.id) as Task["status"];
    const task = allTasks.find((t) => t.id === taskId);
    if (!task) return;
    if (task.status === newStatus) return;
    if (!(newStatus === "in_progress" && ["todo", "overdue"].includes(task.status))) {
      setOpenTask(task);
      setOpenTaskPhase(phases.find((phase) => phase.id === task.phase_id)?.name ?? null);
      toast.info("Gunakan Kirim Laporan atau Review pada detail WO.");
      return;
    }
    // Optimistic update
    setTasksByPhase((prev) => {
      const next = { ...prev };
      next[task.phase_id] = next[task.phase_id].map((t) =>
        t.id === taskId ? { ...t, status: newStatus } : t
      );
      return next;
    });
    workspaceApi.startTask(taskId).then((updated) => {
      // Refresh from server
      setTasksByPhase((prev) => ({
        ...prev,
        [task.phase_id]: prev[task.phase_id].map((t) => (t.id === taskId ? updated : t)),
      }));
    }).catch(() => {
      toast.error("WO tidak dapat dimulai. Muat ulang lalu coba lagi.");
      // Rollback on failure
      setTasksByPhase((prev) => {
        const next = { ...prev };
        next[task.phase_id] = next[task.phase_id].map((t) =>
          t.id === taskId ? { ...t, status: task.status } : t
        );
        return next;
      });
    });
  }

  const handleTaskUpdated = (updated: Task) => {
    setTasksByPhase((prev) => {
      const next = { ...prev };
      next[updated.phase_id] = (next[updated.phase_id] ?? []).map((t) =>
        t.id === updated.id ? updated : t
      );
      return next;
    });
    if (openTask?.id === updated.id) setOpenTask(updated);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 h-[52px] min-h-[52px] border-b border-border-soft bg-bg shrink-0">
        <button onClick={() => setSelectedProjectId(null)} className="btn btn-ghost btn-icon btn-sm">
          <ChevronRight className="size-4 rotate-180" />
        </button>
        {selectedProject.rpo_number && (
          <span className="font-mono text-[12.5px] font-bold text-primary">{selectedProject.rpo_number}</span>
        )}
        <span className="text-[14px] font-bold text-text truncate">{selectedProject.name}</span>
        <StatusBadge status={selectedProject.status} />
        <div className="flex-1" />
        <span className="text-[11.5px] text-text-muted hidden sm:block">Task Board · {allTasks.length} WO</span>
      </div>

      {loadingDetail ? (
        <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-primary" /></div>
      ) : (
        <div className="flex-1 overflow-x-auto bg-bg-ctrl/40">
          <DndContext sensors={sensors} onDragStart={({ active }) => setActiveId(String(active.id))} onDragEnd={handleTaskDragEnd}>
            <div className="flex gap-3 p-4 min-h-full">
              {KANBAN_COLUMNS.map((col) => (
                <KanbanColumn
                  key={col.key}
                  id={col.key}
                  label={col.label}
                  accentClass={col.accent}
                  count={tasksByStatus[col.key]?.length ?? 0}
                >
                  {tasksByStatus[col.key]?.map((task) => {
                    const phase = phases.find((p) => p.id === task.phase_id);
                    return (
                      <KanbanCard
                        key={task.id}
                        id={task.id}
                        title={task.name}
                        subtitle={phase?.name}
                        status={task.status}
                        rpoNumber={selectedProject.rpo_number}
                        location={task.location}
                        assigneeName={task.assigned_name}
                        deadline={task.deadline}
                        onClick={() => {
                          setOpenTask(task);
                          setOpenTaskPhase(phase?.name ?? null);
                        }}
                        draggable={canManage || canExecute || canReview}
                      />
                    );
                  })}
                </KanbanColumn>
              ))}
            </div>
            <DragOverlay>
              {activeId ? (
                <div className="bg-bg border border-primary rounded-[var(--r)] p-3 shadow-[var(--shadow-lg)] opacity-95 w-[280px]">
                  <div className="text-[12.5px] font-semibold">{allTasks.find((t) => t.id === activeId)?.name}</div>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>
      )}

      {openTask && (
        <WoDetailDrawer
          taskId={openTask.id}
          initial={openTask}
          rpoNumber={selectedProject.rpo_number}
          phaseName={openTaskPhase}
          canManage={canManage}
          canExecute={canExecute || openTask.assigned_to === undefined}
          canReview={canReview}
          onTaskChanged={handleTaskUpdated}
          onClose={() => setOpenTask(null)}
        />
      )}
    </div>
  );
}

/** Accent colors for project-status columns (overview). */
const PROJECT_ACCENT: Record<string, string> = {
  planning:  "border-l-blue-500",
  active:    "border-l-green-500",
  on_hold:   "border-l-amber-500",
  completed: "border-l-slate-400",
};

// Keep STATUS_COLOR exported reference so cards inheriting from this file
// don't need to re-import constants. (Used by older callers.)
export const _STATUS_COLOR = STATUS_COLOR;
