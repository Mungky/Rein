import { useState, useEffect } from "react";
import {
  FolderKanban, Plus, ChevronRight, ChevronDown, CheckCircle2,
  AlertTriangle, Clock, Circle, Loader2,
} from "lucide-react";
import { workspaceApi } from "@/lib/api/workspace";
import type { Project, Phase, Task } from "@/lib/api/workspace";
import { useWorkspaceStore } from "../store";
import { StatusBadge } from "../shared/status-badge";
import { ProgressBar } from "../shared/progress-bar";
import { CompleteTaskModal } from "../shared/complete-task-modal";

function TaskRow({ task, canComplete, onComplete }: {
  task: Task;
  canComplete: boolean;
  onComplete: (task: Task) => void;
}) {
  const statusIcon = (() => {
    switch (task.status) {
      case "done": return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case "overdue": return <AlertTriangle className="w-4 h-4 text-red-400" />;
      case "in_progress": return <Clock className="w-4 h-4 text-blue-400" />;
      default: return <Circle className="w-4 h-4 text-text-muted opacity-40" />;
    }
  })();

  return (
    <div className="flex items-start gap-3 px-4 py-2.5 hover:bg-bg-hover transition-colors">
      <div className="mt-0.5 shrink-0">{statusIcon}</div>
      <div className="flex-1 min-w-0">
        <div className={`text-[12.5px] font-medium ${task.status === "done" ? "line-through text-text-muted" : "text-text"}`}>
          {task.name}
        </div>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {task.assigned_name && <span className="text-[10.5px] text-text-muted">{task.assigned_name}</span>}
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
          <button onClick={() => onComplete(task)} className="text-[10.5px] font-semibold text-primary hover:underline">Selesai</button>
        )}
      </div>
    </div>
  );
}

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
      workspaceApi.listTasks(phase.id).then(setTasks).finally(() => setLoadingTasks(false));
    }
  }, [open, phase.id, tasks.length]);

  return (
    <div className="border-b border-border last:border-b-0">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-hover transition-colors text-left">
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
            <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-text-muted" /></div>
          ) : tasks.length === 0 ? (
            <div className="px-4 py-3 text-[12px] text-text-muted">Belum ada task</div>
          ) : (
            tasks.map((t) => <TaskRow key={t.id} task={t} canComplete={canComplete} onComplete={onTaskComplete} />)
          )}
        </div>
      )}
    </div>
  );
}

export function ProjectDetail({ project, canComplete, onBack }: {
  project: Project;
  canComplete: boolean;
  onBack: () => void;
}) {
  const [phases, setPhases] = useState<Phase[]>([]);
  const [loading, setLoading] = useState(true);
  const [completingTask, setCompletingTask] = useState<Task | null>(null);

  useEffect(() => {
    workspaceApi.listPhases(project.id).then(setPhases).finally(() => setLoading(false));
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
        <div className="px-5 py-4 border-b border-border bg-bg">
          {project.client_name && (
            <div className="text-[12px] text-text-muted mb-2">Klien: <span className="font-semibold text-text">{project.client_name}</span></div>
          )}
          {project.description && <div className="text-[12px] text-text-muted mb-3">{project.description}</div>}
          <div className="flex gap-4 text-[11.5px] text-text-muted">
            {project.start_date && <span>Mulai: {new Date(project.start_date).toLocaleDateString("id-ID")}</span>}
            {project.deadline && <span>Deadline: {new Date(project.deadline).toLocaleDateString("id-ID")}</span>}
          </div>
          <div className="mt-3"><ProgressBar value={project.progress} /></div>
        </div>
        <div className="bg-bg">
          <div className="px-5 py-2.5 border-b border-border">
            <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Tahapan ({phases.length})</span>
          </div>
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-text-muted" /></div>
          ) : phases.length === 0 ? (
            <div className="px-5 py-8 text-center text-[12.5px] text-text-muted">Belum ada tahapan</div>
          ) : (
            <div className="divide-y divide-border">
              {phases.map((ph) => (
                <PhaseSection key={ph.id} phase={ph} canComplete={canComplete} onTaskComplete={(task) => setCompletingTask(task)} />
              ))}
            </div>
          )}
        </div>
      </div>
      {completingTask && (
        <CompleteTaskModal
          task={completingTask}
          onClose={() => setCompletingTask(null)}
          onDone={() => { setCompletingTask(null); refreshPhases(); }}
        />
      )}
    </div>
  );
}

export function ProjectListView({ canManage, canComplete }: { canManage: boolean; canComplete: boolean }) {
  const { projects, loading, selectedProjectId } = useWorkspaceStore();
  const store = useWorkspaceStore();

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-text-muted" /></div>;
  }

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-center px-4">
        <FolderKanban className="w-12 h-12 text-text-muted opacity-30" />
        <div className="text-[13px] font-semibold text-text">Belum ada proyek</div>
        {canManage && <div className="text-[12px] text-text-muted">Klik &quot;Proyek Baru&quot; untuk memulai.</div>}
      </div>
    );
  }

  return (
    <div className="divide-y divide-border">
      {projects.map((p) => (
        <button
          key={p.id}
          onClick={() => store.selectProject(p.id)}
          className="w-full px-5 py-4 hover:bg-bg-hover transition-colors text-left flex items-start gap-4"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[13px] font-bold text-text truncate">{p.name}</span>
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
            <ChevronRight className="w-3.5 h-3.5 text-text-muted mt-1" />
          </div>
        </button>
      ))}
    </div>
  );
}