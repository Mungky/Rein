"use client";

import { useState, useEffect, useCallback } from "react";
import {
  FolderKanban, Plus, ChevronRight, ChevronDown, CheckCircle2,
  AlertTriangle, Clock, Circle, Loader2, Wrench, ClipboardCheck, X, Pencil,
} from "lucide-react";
import { workspaceApi } from "@/lib/api/workspace";
import type { Project, Phase, Task } from "@/lib/api/workspace";
import { useAuthDisplay } from "@/hooks/use-auth";
import { useCan } from "@/components/providers/permissions-provider";
import type { AppRole } from "@/lib/utils/roles";
import { useWorkspaceStore } from "../store";
import { StatusBadge } from "../shared/status-badge";
import { ProgressBar } from "../shared/progress-bar";
import { WoFormModal } from "../shared/wo-form-modal";
import { WoDetailDrawer } from "../shared/wo-detail-drawer";
import { EditProjectModal } from "./edit-project-modal";

function TaskRow({ task, onClick }: { task: Task; onClick: () => void }) {
  const statusIcon = (() => {
    switch (task.status) {
      case "done": return <CheckCircle2 className="size-4 text-green" />;
      case "overdue": return <AlertTriangle className="size-4 text-red" />;
      case "in_progress": return <Clock className="size-4 text-blue" />;
      case "pending_review": return <ClipboardCheck className="size-4 text-amber" />;
      default: return <Circle className="size-4 text-text-light" />;
    }
  })();

  return (
    <button
      onClick={onClick}
      className="w-full flex items-start gap-3 px-5 py-3 hover:bg-bg-hover transition-colors text-left group"
    >
      <div className="mt-0.5 shrink-0">{statusIcon}</div>
      <div className="flex-1 min-w-0">
        <div className={`text-[13px] font-medium ${task.status === "done" ? "line-through text-text-muted" : "text-text"}`}>
          {task.name}
        </div>
        <div className="flex items-center gap-2 mt-1 flex-wrap text-[11px] text-text-muted">
          {task.assigned_name && (
            <span>👤 {task.assigned_name}</span>
          )}
          {task.deadline && (
            <span className={task.status === "overdue" ? "text-red font-semibold" : ""}>
              📅 {new Date(task.deadline).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}
            </span>
          )}
          {task.location && (
            <span className="truncate max-w-[140px]">📍 {task.location}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <StatusBadge status={task.status} />
        <ChevronRight className="size-3.5 text-text-light group-hover:text-primary transition-colors" />
      </div>
    </button>
  );
}

function PhaseSection({
  phase, canManage, onTaskClick, refreshKey,
}: {
  phase: Phase;
  canManage: boolean;
  onTaskClick: (task: Task) => void;
  refreshKey: number;
}) {
  const [open, setOpen] = useState(phase.status !== "completed");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [showCreateWo, setShowCreateWo] = useState(false);

  const reloadTasks = useCallback(() => {
    setLoadingTasks(true);
    workspaceApi.listTasks(phase.id).then(setTasks).finally(() => setLoadingTasks(false));
  }, [phase.id]);

  // Reload tasks when the phase is expanded or when refreshKey bumps from above
  // (e.g. after WO mutation). Fetch-on-toggle: setState inside effect is the sync.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) reloadTasks();
  }, [open, reloadTasks, refreshKey]);

  const handleWoCreated = (newTask: Task) => {
    setTasks((prev) => [...prev, newTask].sort((a, b) => a.order - b.order));
    setShowCreateWo(false);
  };

  return (
    <div className="border-b border-border-soft last:border-b-0">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-bg-hover transition-colors text-left"
      >
        {open ? <ChevronDown className="size-4 text-text-muted shrink-0" /> : <ChevronRight className="size-4 text-text-muted shrink-0" />}
        <span className="text-[13.5px] font-bold flex-1 text-text">{phase.name}</span>
        <div className="flex items-center gap-3">
          <StatusBadge status={phase.status} />
          <span className="text-[11.5px] text-text-muted tabular-nums">{phase.progress}%</span>
        </div>
      </button>
      {open && (
        <div className="bg-bg-ctrl/40 border-t border-border-soft">
          {loadingTasks ? (
            <div className="flex justify-center py-4"><Loader2 className="size-4 animate-spin text-primary" /></div>
          ) : tasks.length === 0 ? (
            <div className="px-5 py-4 text-[12.5px] text-text-muted">
              Belum ada Work Order di phase ini
            </div>
          ) : (
            <div className="divide-y divide-border-soft">
              {tasks.map((t) => (
                <TaskRow key={t.id} task={t} onClick={() => onTaskClick(t)} />
              ))}
            </div>
          )}
          {canManage && (
            <div className="px-5 py-2.5 border-t border-border-soft">
              <button
                onClick={() => setShowCreateWo(true)}
                className="btn btn-default btn-sm gap-1.5 w-full justify-center"
              >
                <Plus className="size-3.5" /> Tambah Work Order
              </button>
            </div>
          )}
        </div>
      )}

      {showCreateWo && (
        <div className="fixed inset-0 z-50 bg-bg">
          <WoFormModal
            mode="create"
            phaseId={phase.id}
            fullPage
            onClose={() => setShowCreateWo(false)}
            onCreated={handleWoCreated}
          />
        </div>
      )}
    </div>
  );
}

export function ProjectDetail({ project, onBack }: {
  project: Project;
  onBack: () => void;
}) {
  const { role } = useAuthDisplay();
  const canManage = useCan(role as AppRole, "workspace:manage");
  const canCreateWo = useCan(role as AppRole, "workspace:create_wo") || canManage;
  const canExecute = useCan(role as AppRole, "workspace:execute_wo");
  const canReview = useCan(role as AppRole, "workspace:review_wo") || canManage;

  const [phases, setPhases] = useState<Phase[]>([]);
  const [loading, setLoading] = useState(true);
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const [openTaskPhase, setOpenTaskPhase] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showEditProject, setShowEditProject] = useState(false);
  const [currentProject, setCurrentProject] = useState<Project>(project);
  const [showAddPhase, setShowAddPhase] = useState(false);
  const [newPhaseName, setNewPhaseName] = useState("");
  const [addingPhase, setAddingPhase] = useState(false);
  const [addPhaseError, setAddPhaseError] = useState<string | null>(null);

  // Sync local `currentProject` whenever the parent passes a refreshed
  // project object (e.g. after listProjects() reload updates progress %).
  // Without this, the header would keep stale progress / status / dates.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrentProject(project);
  }, [project]);

  // Fetch-on-mount: setState IS the sync of project.id → fetched phases.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    workspaceApi.listPhases(project.id).then(setPhases).finally(() => setLoading(false));
  }, [project.id]);

  const reloadPhases = useCallback(() => {
    workspaceApi.listPhases(project.id).then(setPhases);
  }, [project.id]);

  const handleAddPhase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPhaseName.trim()) return;
    setAddingPhase(true);
    setAddPhaseError(null);
    try {
      const created = await workspaceApi.createPhase(project.id, {
        name: newPhaseName.trim(),
        order: phases.length + 1,
      });
      setPhases((prev) => [...prev, created]);
      setNewPhaseName("");
      setShowAddPhase(false);
    } catch (err) {
      setAddPhaseError(err instanceof Error ? err.message : "Gagal menambah phase");
    } finally {
      setAddingPhase(false);
    }
  };

  const handleTaskChanged = (next: Task) => {
    setOpenTask(next);
    setRefreshKey((k) => k + 1);
    // Also refresh phases (for progress %)
    reloadPhases();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header — sticky */}
      <div className="flex items-center gap-3 px-5 h-[52px] min-h-[52px] border-b border-border-soft bg-bg shrink-0">
        <button onClick={onBack} className="btn btn-ghost btn-icon btn-sm shrink-0">
          <ChevronRight className="size-4 rotate-180" />
        </button>
        {currentProject.rpo_number && (
          <span className="font-mono text-[12.5px] font-bold text-primary shrink-0">{currentProject.rpo_number}</span>
        )}
        <span className="text-[14px] font-bold text-text truncate min-w-0 flex-1" title={currentProject.name}>
          {currentProject.name}
        </span>
        <div className="shrink-0"><StatusBadge status={currentProject.status} /></div>
        <span className="text-[11.5px] text-text-muted tabular-nums shrink-0 hidden sm:inline">
          {currentProject.progress}% selesai
        </span>
        {canManage && (
          <button
            onClick={() => setShowEditProject(true)}
            className="btn btn-ghost btn-icon btn-sm shrink-0"
            title="Edit proyek"
          >
            <Pencil className="size-3.5" />
          </button>
        )}
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">
        {/* Project info */}
        <div className="px-5 py-5 border-b border-border-soft bg-bg">
          {currentProject.client_name && (
            <div className="text-[12.5px] text-text-muted mb-2">
              Klien: <span className="font-semibold text-text">{currentProject.client_name}</span>
            </div>
          )}
          {currentProject.description && (
            <div className="text-[12.5px] text-text-muted mb-3 leading-relaxed whitespace-pre-wrap">
              {currentProject.description}
            </div>
          )}
          <div className="flex flex-wrap gap-4 text-[11.5px] text-text-muted mb-3">
            {currentProject.start_date && (
              <span>Mulai: <span className="text-text font-medium">{new Date(currentProject.start_date).toLocaleDateString("id-ID")}</span></span>
            )}
            {currentProject.deadline && (
              <span>Deadline: <span className="text-text font-medium">{new Date(currentProject.deadline).toLocaleDateString("id-ID")}</span></span>
            )}
          </div>
          <ProgressBar value={currentProject.progress} />
        </div>

        {/* Phases */}
        <div className="bg-bg">
          <div className="px-5 py-3 border-b border-border-soft">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-text-light">
                Tahapan ({phases.length})
              </span>
              <div className="flex items-center gap-3">
                {canCreateWo && phases.length > 0 && (
                  <span className="text-[11px] text-text-light flex items-center gap-1">
                    <Wrench className="size-3" /> Klik phase untuk tambah WO
                  </span>
                )}
                {canManage && !showAddPhase && (
                  <button
                    onClick={() => setShowAddPhase(true)}
                    className="btn btn-default btn-sm gap-1 text-[11.5px]"
                  >
                    <Plus className="size-3.5" /> Tambah Phase
                  </button>
                )}
              </div>
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="size-5 animate-spin text-primary" /></div>
          ) : (
            <>
              {phases.length === 0 && !showAddPhase && (
                <div className="px-5 py-10 text-center">
                  <div className="text-[13px] text-text-muted mb-3">Belum ada tahapan untuk proyek ini.</div>
                  {canManage && (
                    <button
                      onClick={() => setShowAddPhase(true)}
                      className="btn btn-primary btn-sm gap-1.5"
                    >
                      <Plus className="size-3.5" /> Tambah Phase Pertama
                    </button>
                  )}
                </div>
              )}
              {phases.length > 0 && (
                <div>
                  {phases.map((ph) => (
                    <PhaseSection
                      key={ph.id}
                      phase={ph}
                      canManage={canCreateWo}
                      refreshKey={refreshKey}
                      onTaskClick={(t) => { setOpenTask(t); setOpenTaskPhase(ph.name); }}
                    />
                  ))}
                </div>
              )}

              {/* Inline Add Phase Form */}
              {showAddPhase && (
                <form
                  onSubmit={handleAddPhase}
                  className="px-5 py-3.5 border-t border-border-soft bg-bg-ctrl/60 flex flex-col gap-2"
                >
                  <div className="flex items-center gap-2">
                    <input
                      // Callback ref auto-focuses when the input mounts —
                      // deterministic, no setTimeout race.
                      ref={(el) => { el?.focus(); }}
                      className="field-input flex-1 text-[13px] h-8"
                      placeholder="Nama phase, mis. Mobilisasi"
                      value={newPhaseName}
                      onChange={(e) => setNewPhaseName(e.target.value)}
                      disabled={addingPhase}
                      maxLength={120}
                    />
                    <button
                      type="submit"
                      disabled={addingPhase || !newPhaseName.trim()}
                      className="btn btn-primary btn-sm gap-1 shrink-0"
                    >
                      {addingPhase ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                      Tambah
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowAddPhase(false); setNewPhaseName(""); setAddPhaseError(null); }}
                      className="btn btn-ghost btn-icon btn-sm shrink-0"
                      disabled={addingPhase}
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                  {addPhaseError && (
                    <div className="px-2 py-1.5 rounded-[var(--r)] bg-red-bg text-red text-[11.5px] border border-red/20">
                      {addPhaseError}
                    </div>
                  )}
                </form>
              )}
            </>
          )}
        </div>
      </div>

      {/* WO Detail Drawer */}
      {openTask && (
        <WoDetailDrawer
          taskId={openTask.id}
          initial={openTask}
          rpoNumber={currentProject.rpo_number}
          phaseName={openTaskPhase}
          canManage={canManage}
          canExecute={canExecute || openTask.assigned_to === undefined /* fallback */}
          canReview={canReview}
          onTaskChanged={handleTaskChanged}
          onClose={() => { setOpenTask(null); setRefreshKey((k) => k + 1); }}
        />
      )}

      {/* Edit Project Modal */}
      {showEditProject && (
        <EditProjectModal
          project={currentProject}
          onClose={() => setShowEditProject(false)}
          onUpdated={(updated) => {
            setCurrentProject(updated);
            setShowEditProject(false);
          }}
        />
      )}
    </div>
  );
}

export function ProjectListView({ canManage }: { canManage: boolean }) {
  const { projects, loading } = useWorkspaceStore();
  const store = useWorkspaceStore();

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-primary" /></div>;
  }

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-center px-4">
        <div className="size-16 rounded-[var(--r-xl)] bg-bg-ctrl border border-border flex items-center justify-center">
          <FolderKanban className="size-7 text-text-light" />
        </div>
        <div>
          <div className="text-[14px] font-semibold text-text">Belum ada proyek</div>
          {canManage && <div className="text-[12px] text-text-muted mt-1">Klik &quot;Proyek Baru&quot; untuk memulai.</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border-soft">
      {projects.map((p) => (
        <button
          key={p.id}
          onClick={() => store.selectProject(p.id)}
          className="w-full px-5 py-4 hover:bg-bg-hover transition-colors text-left flex items-start gap-4 group"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              {p.rpo_number && (
                <span className="font-mono text-[11.5px] font-bold text-primary px-1.5 py-0.5 rounded bg-primary-soft">
                  {p.rpo_number}
                </span>
              )}
              <span className="text-[13.5px] font-bold text-text truncate">{p.name}</span>
              <StatusBadge status={p.status} />
            </div>
            {p.client_name && <div className="text-[11.5px] text-text-muted mb-2">{p.client_name}</div>}
            <ProgressBar value={p.progress} />
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {p.deadline && (
              <span className="text-[10.5px] text-text-muted">
                {new Date(p.deadline).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
              </span>
            )}
            <ChevronRight className="size-3.5 text-text-light group-hover:text-primary mt-1 transition-colors" />
          </div>
        </button>
      ))}
    </div>
  );
}
