import { create } from "zustand";
import { workspaceApi } from "@/lib/api/workspace";
import type { Project, Phase, Task, ProjectTemplate } from "@/lib/api/workspace";
import type { WorkspaceView } from "./types";

interface WorkspaceState {
  projects: Project[];
  templates: ProjectTemplate[];
  loading: boolean;
  selectedProjectId: string | null;
  view: WorkspaceView;
  phasesByProject: Record<string, Phase[]>;
  tasksByPhase: Record<string, Task[]>;

  loadProjects: () => Promise<void>;
  loadTemplates: () => Promise<void>;
  selectProject: (id: string | null) => void;
  setView: (view: WorkspaceView) => void;
  loadPhases: (projectId: string) => Promise<void>;
  loadTasks: (phaseId: string) => Promise<void>;
  updateProjectStatus: (projectId: string, status: Project["status"]) => Promise<void>;
  updateTaskStatus: (taskId: string, status: Task["status"], phaseId: string) => Promise<void>;
  refreshProject: (projectId: string) => Promise<void>;
  showCreate: boolean;
  setShowCreate: (v: boolean) => void;
}

const savedView = (): WorkspaceView => {
  if (typeof window === "undefined") return "list";
  const v = sessionStorage.getItem("ws-view");
  // Migrate legacy "gantt" → "calendar" (Gantt + Calendar merged into Timeline).
  // Persist the new value immediately so we don't re-migrate every session.
  if (v === "gantt") {
    sessionStorage.setItem("ws-view", "calendar");
    return "calendar";
  }
  if (v === "list" || v === "kanban" || v === "calendar") return v;
  return "list";
};

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  projects: [],
  templates: [],
  loading: true,
  selectedProjectId: null,
  view: savedView(),
  phasesByProject: {},
  tasksByPhase: {},
  showCreate: false,
  setShowCreate: (v) => set({ showCreate: v }),

  loadProjects: async () => {
    set({ loading: true });
    try {
      const projects = await workspaceApi.listProjects();
      set({ projects });
    } catch (err) {
      // Auth not ready or network error — will retry after auth resolves.
      // Log so dev-time bugs (e.g. 404 from a renamed endpoint, RLS denial)
      // aren't silently swallowed.
      console.warn("loadProjects failed:", err);
    } finally {
      set({ loading: false });
    }
  },

  loadTemplates: async () => {
    try {
      const templates = await workspaceApi.listTemplates();
      set({ templates });
    } catch (err) {
      console.warn("loadTemplates failed:", err);
    }
  },

  selectProject: (id) => set({ selectedProjectId: id }),

  setView: (view) => {
    sessionStorage.setItem("ws-view", view);
    set({ view });
  },

  loadPhases: async (projectId) => {
    try {
      const phases = await workspaceApi.listPhases(projectId);
      set((s) => ({ phasesByProject: { ...s.phasesByProject, [projectId]: phases } }));
    } catch (err) {
      console.warn("loadPhases failed:", err);
    }
  },

  loadTasks: async (phaseId) => {
    try {
      const tasks = await workspaceApi.listTasks(phaseId);
      set((s) => ({ tasksByPhase: { ...s.tasksByPhase, [phaseId]: tasks } }));
    } catch (err) {
      console.warn("loadTasks failed:", err);
    }
  },

  updateProjectStatus: async (projectId, status) => {
    await workspaceApi.updateProject(projectId, { status });
    set((s) => ({
      projects: s.projects.map((p) => (p.id === projectId ? { ...p, status } : p)),
    }));
  },

  updateTaskStatus: async (taskId, status, phaseId) => {
    await workspaceApi.updateTask(taskId, { status });
    const tasks = await workspaceApi.listTasks(phaseId);
    set((s) => ({ tasksByPhase: { ...s.tasksByPhase, [phaseId]: tasks } }));
  },

  refreshProject: async (projectId) => {
    const [project, phases] = await Promise.all([
      workspaceApi.getProject(projectId),
      workspaceApi.listPhases(projectId),
    ]);
    set((s) => ({
      projects: s.projects.map((p) => (p.id === projectId ? project : p)),
      phasesByProject: { ...s.phasesByProject, [projectId]: phases },
    }));
  },
}));