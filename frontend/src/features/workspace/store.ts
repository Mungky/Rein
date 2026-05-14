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
  return (sessionStorage.getItem("ws-view") as WorkspaceView) ?? "list";
};

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
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
    } finally {
      set({ loading: false });
    }
  },

  loadTemplates: async () => {
    const templates = await workspaceApi.listTemplates();
    set({ templates });
  },

  selectProject: (id) => set({ selectedProjectId: id }),

  setView: (view) => {
    sessionStorage.setItem("ws-view", view);
    set({ view });
  },

  loadPhases: async (projectId) => {
    const phases = await workspaceApi.listPhases(projectId);
    set((s) => ({ phasesByProject: { ...s.phasesByProject, [projectId]: phases } }));
  },

  loadTasks: async (phaseId) => {
    const tasks = await workspaceApi.listTasks(phaseId);
    set((s) => ({ tasksByPhase: { ...s.tasksByPhase, [phaseId]: tasks } }));
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