"use client";

import { useEffect, useState, useCallback } from "react";
import { PageGuard } from "@/components/guards/page-guard";
import { useAuthDisplay } from "@/hooks/use-auth";
import { useCan } from "@/components/providers/permissions-provider";
import type { AppRole } from "@/lib/utils/roles";
import {
  workspaceApi,
  type Project, type Phase, type Task, type ProjectTemplate,
} from "@/lib/api/workspace";
import {
  FolderKanban, Plus, ChevronRight, ChevronDown, CheckCircle2,
  Clock, AlertTriangle, Circle, Loader2, X, Check,
} from "lucide-react";

// ── Helpers ──
const STATUS_LABEL: Record<string, string> = {
  planning: "Perencanaan", active: "Aktif", on_hold: "Ditunda", completed: "Selesai",
  pending: "Menunggu",
  todo: "Belum", in_progress: "Dikerjakan", done: "Selesai", overdue: "Terlambat",
};
const STATUS_COLOR: Record<string, string> = {
  planning: "bg-blue-100 text-blue-700",
  active: "bg-green-100 text-green-700",
  on_hold: "bg-yellow-100 text-yellow-700",
  completed: "bg-gray-100 text-gray-600",
  pending: "bg-gray-100 text-gray-500",
  todo: "bg-gray-100 text-gray-600",
  in_progress: "bg-blue-100 text-blue-700",
  done: "bg-green-100 text-green-700",
  overdue: "bg-red-100 text-red-700",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`text-[10px] font-bold px-1.5 py-[1.5px] rounded-full ${STATUS_COLOR[status] ?? "bg-bg-hover text-text-muted"}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-bg-hover rounded-full h-1.5 overflow-hidden">
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
      <span className="text-[10.5px] text-text-muted shrink-0">{value}%</span>
    </div>
  );
}

// ── Task completion modal ──
function CompleteTaskModal({
  task,
  onClose,
  onDone,
}: {
  task: Task;
  onClose: () => void;
  onDone: () => void;
}) {
  const [notes, setNotes] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      await workspaceApi.completeTask(task.id, {
        notes: notes.trim() || undefined,
        photo_url: photoUrl.trim() || undefined,
      });
      onDone();
    } catch (e: any) {
      setError("Gagal menyimpan. Coba lagi.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
      <div className="bg-bg border border-border rounded-xl w-full max-w-sm shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-[13px] font-bold">Tandai Selesai</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-bg-hover">
            <X className="w-4 h-4 text-text-muted" />
          </button>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <div className="text-[12px] text-text-muted">Task: <span className="font-semibold text-text">{task.name}</span></div>

          <div>
            <label className="text-[11px] font-bold text-text-muted uppercase tracking-wider block mb-1">
              Catatan (opsional)
            </label>
            <textarea
              className="w-full border border-border rounded-lg px-3 py-2 text-[12.5px] bg-bg text-text resize-none focus:outline-none focus:ring-1 focus:ring-primary"
              rows={3}
              placeholder="Ceritakan singkat apa yang sudah dikerjakan..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div>
            <label className="text-[11px] font-bold text-text-muted uppercase tracking-wider block mb-1">
              Link Foto (opsional)
            </label>
            <input
              className="w-full border border-border rounded-lg px-3 py-2 text-[12.5px] bg-bg text-text focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="URL foto dari Google Drive..."
              value={photoUrl}
              onChange={(e) => setPhotoUrl(e.target.value)}
            />
          </div>

          {error && <div className="text-[11.5px] text-red-500">{error}</div>}

          <button
            onClick={submit}
            disabled={loading}
            className="btn btn-primary w-full flex items-center justify-center gap-2 mt-1"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {loading ? "Menyimpan..." : "Tandai Selesai"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Task row ──
function TaskRow({ task, canComplete, onComplete }: {
  task: Task;
  canComplete: boolean;
  onComplete: (task: Task) => void;
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-2.5 hover:bg-bg-hover transition-colors">
      <div className="mt-0.5 shrink-0">
        {task.status === "done"
          ? <CheckCircle2 className="w-4 h-4 text-green-500" />
          : task.status === "overdue"
          ? <AlertTriangle className="w-4 h-4 text-red-400" />
          : task.status === "in_progress"
          ? <Clock className="w-4 h-4 text-blue-400" />
          : <Circle className="w-4 h-4 text-text-muted opacity-40" />
        }
      </div>
      <div className="flex-1 min-w-0">
        <div className={`text-[12.5px] font-medium ${task.status === "done" ? "line-through text-text-muted" : "text-text"}`}>
          {task.name}
        </div>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {task.assigned_name && (
            <span className="text-[10.5px] text-text-muted">{task.assigned_name}</span>
          )}
          {task.deadline && (
            <span className={`text-[10.5px] ${task.status === "overdue" ? "text-red-500 font-semibold" : "text-text-muted"}`}>
              {new Date(task.deadline).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <StatusBadge status={task.status} />
        {canComplete && task.status !== "done" && (
          <button
            onClick={() => onComplete(task)}
            className="text-[10.5px] font-semibold text-primary hover:underline"
          >
            Selesai
          </button>
        )}
      </div>
    </div>
  );
}

// ── Phase accordion ──
function PhaseSection({ phase, canComplete, onTaskComplete }: {
  phase: Phase;
  canComplete: boolean;
  onTaskComplete: (task: Task) => void;
}) {
  const [open, setOpen] = useState(phase.status !== "completed");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);

  useEffect(() => {
    if (open && tasks.length === 0) {
      setLoadingTasks(true);
      workspaceApi.listTasks(phase.id)
        .then(setTasks)
        .finally(() => setLoadingTasks(false));
    }
  }, [open, phase.id, tasks.length]);

  function refreshTasks() {
    workspaceApi.listTasks(phase.id).then(setTasks);
  }

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-hover transition-colors text-left"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5 text-text-muted shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-text-muted shrink-0" />}
        <span className="text-[12.5px] font-bold flex-1">{phase.name}</span>
        <div className="flex items-center gap-2">
          <StatusBadge status={phase.status} />
          <span className="text-[10.5px] text-text-muted">{phase.progress}%</span>
        </div>
      </button>

      {open && (
        <div className="bg-bg-hover/30">
          {loadingTasks ? (
            <div className="flex justify-center py-4">
              <Loader2 className="w-4 h-4 animate-spin text-text-muted" />
            </div>
          ) : tasks.length === 0 ? (
            <div className="px-4 py-3 text-[12px] text-text-muted">Belum ada task</div>
          ) : (
            tasks.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                canComplete={canComplete}
                onComplete={onTaskComplete}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Project detail panel ──
function ProjectDetail({ project, canComplete, onBack }: {
  project: Project;
  canComplete: boolean;
  onBack: () => void;
}) {
  const [phases, setPhases] = useState<Phase[]>([]);
  const [loading, setLoading] = useState(true);
  const [completingTask, setCompletingTask] = useState<Task | null>(null);

  useEffect(() => {
    workspaceApi.listPhases(project.id)
      .then(setPhases)
      .finally(() => setLoading(false));
  }, [project.id]);

  function refreshPhases() {
    workspaceApi.listPhases(project.id).then(setPhases);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-5 h-[46px] min-h-[46px] border-b border-border bg-bg shrink-0">
        <button onClick={onBack} className="text-text-muted hover:text-text transition-colors">
          <ChevronRight className="w-4 h-4 rotate-180" />
        </button>
        <span className="text-[14px] font-bold text-text truncate">{project.name}</span>
        <StatusBadge status={project.status} />
        <div className="flex-1" />
        <span className="text-[11px] text-text-muted">{project.progress}% selesai</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Project info */}
        <div className="px-5 py-4 border-b border-border bg-bg">
          {project.client_name && (
            <div className="text-[12px] text-text-muted mb-2">Klien: <span className="font-semibold text-text">{project.client_name}</span></div>
          )}
          {project.description && (
            <div className="text-[12px] text-text-muted mb-3">{project.description}</div>
          )}
          <div className="flex gap-4 text-[11.5px] text-text-muted">
            {project.start_date && <span>Mulai: {new Date(project.start_date).toLocaleDateString("id-ID")}</span>}
            {project.deadline && <span>Deadline: {new Date(project.deadline).toLocaleDateString("id-ID")}</span>}
          </div>
          <div className="mt-3">
            <ProgressBar value={project.progress} />
          </div>
        </div>

        {/* Phases */}
        <div className="bg-bg">
          <div className="px-5 py-2.5 border-b border-border">
            <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
              Tahapan ({phases.length})
            </span>
          </div>

          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin text-text-muted" />
            </div>
          ) : phases.length === 0 ? (
            <div className="px-5 py-8 text-center text-[12.5px] text-text-muted">Belum ada tahapan</div>
          ) : (
            <div className="divide-y divide-border">
              {phases.map((ph) => (
                <PhaseSection
                  key={ph.id}
                  phase={ph}
                  canComplete={canComplete}
                  onTaskComplete={(task) => setCompletingTask(task)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {completingTask && (
        <CompleteTaskModal
          task={completingTask}
          onClose={() => setCompletingTask(null)}
          onDone={() => {
            setCompletingTask(null);
            refreshPhases();
          }}
        />
      )}
    </div>
  );
}

// ── Create project modal ──
function CreateProjectModal({
  templates,
  onClose,
  onCreated,
}: {
  templates: ProjectTemplate[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [clientName, setClientName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [deadline, setDeadline] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await workspaceApi.createProject({
        name: name.trim(),
        client_name: clientName.trim() || undefined,
        template_id: templateId || undefined,
        start_date: startDate || undefined,
        deadline: deadline || undefined,
      });
      onCreated();
    } catch (e: any) {
      setError("Gagal membuat proyek.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
      <form onSubmit={submit} className="bg-bg border border-border rounded-xl w-full max-w-sm shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-[13px] font-bold">Proyek Baru</span>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-bg-hover">
            <X className="w-4 h-4 text-text-muted" />
          </button>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <div>
            <label className="text-[11px] font-bold text-text-muted uppercase tracking-wider block mb-1">Nama Proyek *</label>
            <input
              required
              className="w-full border border-border rounded-lg px-3 py-2 text-[12.5px] bg-bg text-text focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="Nama proyek..."
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="text-[11px] font-bold text-text-muted uppercase tracking-wider block mb-1">Nama Klien</label>
            <input
              className="w-full border border-border rounded-lg px-3 py-2 text-[12.5px] bg-bg text-text focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="Nama klien (opsional)..."
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
            />
          </div>
          {templates.length > 0 && (
            <div>
              <label className="text-[11px] font-bold text-text-muted uppercase tracking-wider block mb-1">Template</label>
              <select
                className="w-full border border-border rounded-lg px-3 py-2 text-[12.5px] bg-bg text-text focus:outline-none focus:ring-1 focus:ring-primary"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
              >
                <option value="">-- Tanpa template --</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              {templateId && (
                <div className="text-[10.5px] text-text-muted mt-1">
                  Phase & task akan dibuat otomatis dari template.
                </div>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-bold text-text-muted uppercase tracking-wider block mb-1">Mulai</label>
              <input type="date" className="w-full border border-border rounded-lg px-3 py-2 text-[12.5px] bg-bg text-text focus:outline-none focus:ring-1 focus:ring-primary"
                value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <label className="text-[11px] font-bold text-text-muted uppercase tracking-wider block mb-1">Deadline</label>
              <input type="date" className="w-full border border-border rounded-lg px-3 py-2 text-[12.5px] bg-bg text-text focus:outline-none focus:ring-1 focus:ring-primary"
                value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </div>
          </div>
          {error && <div className="text-[11.5px] text-red-500">{error}</div>}
          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="btn btn-primary w-full flex items-center justify-center gap-2 mt-1"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {loading ? "Membuat..." : "Buat Proyek"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Main Workspace page ──
export default function WorkspacePage() {
  const { role } = useAuthDisplay();
  const canManage = useCan(role as AppRole, "workspace:manage");
  const canComplete = useCan(role as AppRole, "workspace:complete_task");

  const [projects, setProjects] = useState<Project[]>([]);
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [projs, tmpls] = await Promise.all([
        workspaceApi.listProjects(),
        canManage ? workspaceApi.listTemplates() : Promise.resolve([]),
      ]);
      setProjects(projs);
      setTemplates(tmpls);
    } finally {
      setLoading(false);
    }
  }, [canManage]);

  useEffect(() => { load(); }, [load]);

  if (selectedProject) {
    return (
      <PageGuard permission="workspace:view">
        <div className="flex flex-col h-full overflow-hidden">
          <ProjectDetail
            project={selectedProject}
            canComplete={canComplete}
            onBack={() => { setSelectedProject(null); load(); }}
          />
        </div>
      </PageGuard>
    );
  }

  return (
    <PageGuard permission="workspace:view">
      <div className="flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-5 h-[46px] min-h-[46px] border-b border-border bg-bg shrink-0">
          <FolderKanban className="w-4 h-4 text-text-muted" />
          <span className="text-[15px] font-bold text-text">Workspace</span>
          <div className="flex-1" />
          {canManage && (
            <button
              onClick={() => setShowCreate(true)}
              className="btn btn-primary btn-sm gap-1.5"
            >
              <Plus className="w-3 h-3" /> Proyek Baru
            </button>
          )}
        </div>

        {/* Project list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
            </div>
          ) : projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-center px-4">
              <FolderKanban className="w-12 h-12 text-text-muted opacity-30" />
              <div className="text-[13px] font-semibold text-text">Belum ada proyek</div>
              {canManage && (
                <div className="text-[12px] text-text-muted">
                  Klik "Proyek Baru" untuk memulai.
                </div>
              )}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedProject(p)}
                  className="w-full px-5 py-4 hover:bg-bg-hover transition-colors text-left flex items-start gap-4"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[13px] font-bold text-text truncate">{p.name}</span>
                      <StatusBadge status={p.status} />
                    </div>
                    {p.client_name && (
                      <div className="text-[11.5px] text-text-muted mb-2">{p.client_name}</div>
                    )}
                    <ProgressBar value={p.progress} />
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {p.deadline && (
                      <span className="text-[10.5px] text-text-muted">
                        {new Date(p.deadline).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                    )}
                    <ChevronRight className="w-3.5 h-3.5 text-text-muted mt-1" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {showCreate && (
        <CreateProjectModal
          templates={templates}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load(); }}
        />
      )}
    </PageGuard>
  );
}
