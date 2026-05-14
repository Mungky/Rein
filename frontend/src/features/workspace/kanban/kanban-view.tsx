import { useState, useEffect, useCallback } from "react";
import { DndContext, DragEndEvent, DragOverlay, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { Loader2 } from "lucide-react";
import { useWorkspaceStore } from "../store";
import { STATUS_LABEL, STATUS_COLOR, PROJECT_STATUSES, TASK_STATUSES } from "../constants";
import type { Project, Phase, Task } from "@/lib/api/workspace";
import { workspaceApi } from "@/lib/api/workspace";
import { StatusBadge } from "../shared/status-badge";
import { KanbanColumn } from "./kanban-column";
import { KanbanCard } from "./kanban-card";

export function KanbanView({ canManage, canComplete }: { canManage: boolean; canComplete: boolean }) {
  const store = useWorkspaceStore();
  const { projects, loading, selectProject, updateProjectStatus } = store;
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [tasksByPhase, setTasksByPhase] = useState<Record<string, Task[]>>({});
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // Load phases + tasks when a project is selected
  useEffect(() => {
    if (!selectedProjectId) return;
    setLoadingDetail(true);
    workspaceApi.listPhases(selectedProjectId).then(async (phs) => {
      setPhases(phs);
      const allTasks: Record<string, Task[]> = {};
      await Promise.all(
        phs.map(async (ph) => {
          allTasks[ph.id] = await workspaceApi.listTasks(ph.id);
        }),
      );
      setTasksByPhase(allTasks);
    }).finally(() => setLoadingDetail(false));
  }, [selectedProjectId]);

  // Detail view: task-level kanban
  if (selectedProjectId) {
    const selectedProject = projects.find((p) => p.id === selectedProjectId);
    if (!selectedProject) return null;

    const allTasks = Object.values(tasksByPhase).flat();
    const tasksByStatus = Object.fromEntries(
      TASK_STATUSES.map((s) => [s, allTasks.filter((t) => t.status === s)])
    );

    function handleTaskDragEnd(event: DragEndEvent) {
      const { active, over } = event;
      if (!over) return;
      const taskId = String(active.id);
      const newStatus = String(over.id) as Task["status"];
      if (TASK_STATUSES.includes(newStatus)) {
        // Optimistic update
        setTasksByPhase((prev) => {
          const next = { ...prev };
          for (const phaseId of Object.keys(next)) {
            next[phaseId] = next[phaseId].map((t) =>
              t.id === taskId ? { ...t, status: newStatus } : t
            );
          }
          return next;
        });
        // Find phase ID for refresh
        const task = allTasks.find((t) => t.id === taskId);
        if (task) {
          workspaceApi.updateTask(taskId, { status: newStatus }).then(() => {
            // Refresh to get server state
            workspaceApi.listTasks(task.phase_id).then((tasks) => {
              setTasksByPhase((prev) => ({ ...prev, [task.phase_id]: tasks }));
            });
          });
        }
      }
    }

    return (
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 h-[46px] min-h-[46px] border-b border-border bg-bg shrink-0">
          <button onClick={() => setSelectedProjectId(null)} className="text-text-muted hover:text-text transition-colors">
            ←
          </button>
          <span className="text-[14px] font-bold text-text truncate">{selectedProject.name}</span>
          <StatusBadge status={selectedProject.status} />
          <div className="flex-1" />
          <span className="text-[11px] text-text-muted">Task Board</span>
        </div>

        {loadingDetail ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-text-muted" /></div>
        ) : (
          <div className="flex-1 overflow-x-auto">
            <DndContext sensors={sensors} onDragStart={({ active }) => setActiveId(String(active.id))} onDragEnd={handleTaskDragEnd}>
              <div className="flex gap-3 p-4 min-h-full">
                {TASK_STATUSES.map((status) => (
                  <KanbanColumn
                    key={status}
                    id={status}
                    label={STATUS_LABEL[status]}
                    colorClass={STATUS_COLOR[status]}
                    count={tasksByStatus[status]?.length ?? 0}
                  >
                    {tasksByStatus[status]?.map((task) => (
                      <KanbanCard
                        key={task.id}
                        id={task.id}
                        title={task.name}
                        subtitle={task.assigned_name ?? undefined}
                        status={task.status}
                        deadline={task.deadline}
                        draggable={canManage || canComplete}
                      />
                    ))}
                  </KanbanColumn>
                ))}
              </div>
              <DragOverlay>
                {activeId ? (
                  <div className="bg-bg border border-primary/40 rounded-lg p-3 shadow-lg opacity-90">
                    <div className="text-[12.5px] font-semibold">{allTasks.find((t) => t.id === activeId)?.name}</div>
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          </div>
        )}
      </div>
    );
  }

  // Overview: project-level kanban
  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-text-muted" /></div>;
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
    <div className="flex-1 overflow-x-auto">
      <DndContext sensors={sensors} onDragStart={({ active }) => setActiveId(String(active.id))} onDragEnd={handleProjectDragEnd}>
        <div className="flex gap-3 p-4 min-h-full">
          {PROJECT_STATUSES.map((status) => (
            <KanbanColumn
              key={status}
              id={status}
              label={STATUS_LABEL[status]}
              colorClass={STATUS_COLOR[status]}
              count={byStatus[status].length}
            >
              {byStatus[status].map((p) => (
                <KanbanCard
                  key={p.id}
                  id={p.id}
                  title={p.name}
                  subtitle={p.client_name ?? undefined}
                  status={p.status}
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
            <div className="bg-bg border border-primary/40 rounded-lg p-3 shadow-lg opacity-90">
              <div className="text-[12.5px] font-semibold">{projects.find((p) => p.id === activeId)?.name}</div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}