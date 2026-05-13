/** API client for the Workspace module (projects, phases, tasks, completions). */

import { apiClient } from "./client";

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string | null;
}

export interface PhaseTemplateDetail {
  id: string;
  name: string;
  order: number;
  estimated_days: number | null;
  tasks: { id: string; name: string; estimated_days: number | null; default_role: string | null }[];
}

export interface TemplateDetail extends ProjectTemplate {
  phases: PhaseTemplateDetail[];
}

export interface Project {
  id: string;
  name: string;
  client_name: string | null;
  status: "planning" | "active" | "on_hold" | "completed";
  start_date: string | null;
  deadline: string | null;
  manager_id: string | null;
  description: string | null;
  progress: number;
}

export interface Phase {
  id: string;
  project_id: string;
  name: string;
  order: number;
  status: "pending" | "active" | "completed";
  start_date: string | null;
  deadline: string | null;
  progress: number;
}

export interface Task {
  id: string;
  phase_id: string;
  name: string;
  assigned_to: string | null;
  assigned_name: string | null;
  deadline: string | null;
  status: "todo" | "in_progress" | "done" | "overdue";
  notes: string | null;
  order: number;
}

export interface Completion {
  id: string;
  task_id: string;
  submitted_by: string;
  submitted_name: string | null;
  photo_url: string | null;
  notes: string | null;
  completed_at: string;
}

export interface SummaryTask {
  id: string;
  name: string;
  deadline: string | null;
  status: string;
}

export interface SummaryProject {
  id: string;
  name: string;
  client_name: string | null;
  status: string;
  deadline: string | null;
  progress: number;
}

export interface WorkspaceSummary {
  managed: {
    active_projects: number;
    total_projects: number;
    overdue_tasks: number;
    projects: SummaryProject[];
  };
  personal: {
    today_count: number;
    upcoming_count: number;
    overdue_count: number;
    done_this_month: number;
    today_tasks: SummaryTask[];
    overdue_tasks: SummaryTask[];
  };
}

export const workspaceApi = {
  // Templates
  listTemplates: () => apiClient.get<ProjectTemplate[]>("/api/workspace/templates"),
  getTemplate: (id: string) => apiClient.get<TemplateDetail>(`/api/workspace/templates/${id}`),
  createTemplate: (data: { name: string; description?: string; phases?: object[] }) =>
    apiClient.post<ProjectTemplate>("/api/workspace/templates", data),

  // Projects
  listProjects: () => apiClient.get<Project[]>("/api/workspace/projects"),
  getProject: (id: string) => apiClient.get<Project>(`/api/workspace/projects/${id}`),
  createProject: (data: {
    name: string;
    client_name?: string;
    template_id?: string;
    start_date?: string;
    deadline?: string;
    manager_id?: string;
    description?: string;
  }) => apiClient.post<Project>("/api/workspace/projects", data),
  updateProject: (id: string, data: Partial<Project>) =>
    apiClient.put<Project>(`/api/workspace/projects/${id}`, data),

  // Phases
  listPhases: (projectId: string) => apiClient.get<Phase[]>(`/api/workspace/projects/${projectId}/phases`),
  createPhase: (projectId: string, data: { name: string; order?: number; start_date?: string; deadline?: string }) =>
    apiClient.post<Phase>(`/api/workspace/projects/${projectId}/phases`, data),
  updatePhase: (phaseId: string, data: Partial<Phase>) =>
    apiClient.put<Phase>(`/api/workspace/phases/${phaseId}`, data),

  // Tasks
  listTasks: (phaseId: string) => apiClient.get<Task[]>(`/api/workspace/phases/${phaseId}/tasks`),
  myTasks: () => apiClient.get<Task[]>("/api/workspace/my-tasks"),
  createTask: (phaseId: string, data: { name: string; assigned_to?: string; deadline?: string; notes?: string; order?: number }) =>
    apiClient.post<Task>(`/api/workspace/phases/${phaseId}/tasks`, data),
  updateTask: (taskId: string, data: Partial<Task>) =>
    apiClient.put<Task>(`/api/workspace/tasks/${taskId}`, data),

  // Completions
  completeTask: (taskId: string, data: { photo_url?: string; notes?: string }) =>
    apiClient.post<Completion>(`/api/workspace/tasks/${taskId}/complete`, data),
  listCompletions: (taskId: string) =>
    apiClient.get<Completion[]>(`/api/workspace/tasks/${taskId}/completions`),

  // Summary (dashboard)
  summary: () => apiClient.get<WorkspaceSummary>("/api/workspace/summary"),
};
