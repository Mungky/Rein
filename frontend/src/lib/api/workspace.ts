/** API client for the Workspace module (projects, phases, tasks, completions). */

import { apiClient } from "./client";
import { createProjectApi } from "./workspace-project";
import { createCoordinationApi } from "./workspace-coordination";
import { createLogbookApi } from "./workspace-logbook";
import type { TaskPlanning } from "./workspace-project";

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
  rpo_number: string | null;
  client_name: string | null;
  status: "planning" | "active" | "on_hold" | "completed";
  start_date: string | null;
  deadline: string | null;
  manager_id: string | null;
  description: string | null;
  progress: number;
  archived_at?: string | null;
}

/** Compact phase shape returned by the bulk /timeline endpoint. */
export interface TimelinePhase {
  id: string;
  name: string;
  order: number;
  status: "pending" | "active" | "completed";
  start_date: string | null;
  deadline: string | null;
  progress: number;
}

export interface TimelineProject extends Project {
  phases: TimelinePhase[];
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

export type TaskStatus = "todo" | "in_progress" | "pending_review" | "done" | "overdue" | "cancelled";

export interface Task {
  wo_number?: number | null;
  updated_at?: string | null;
  id: string;
  phase_id: string;
  name: string;
  description: string | null;
  location: string | null;
  estimated_days: number | null;
  assigned_to: string | null;
  assigned_name: string | null;
  assigned_avatar_url?: string | null;
  deadline: string | null;
  status: TaskStatus;
  notes: string | null;
  review_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  started_at: string | null;
  order: number;
}

export interface TaskStage {
  id: string;
  name: string;
  sequence: number;
  folded: boolean;
}

export interface BoardTask extends Task {
  allowed_statuses?: TaskStatus[];
  stage_id: string | null;
  board_order: number;
  phase_name: string;
  planning?: TaskPlanning | null;
}

export interface ProjectBoard {
  version: number;
  stages: TaskStage[];
  tasks: BoardTask[];
}

export interface Completion {
  id: string;
  task_id: string;
  submitted_by: string;
  submitted_name: string | null;
  photo_url: string | null;
  photos_before: string[];
  photos_after: string[];
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

export function createWorkspaceApi(client = apiClient) { return {
  ...createLogbookApi(client),
  ...createCoordinationApi(client),
  ...createProjectApi(client),
  getBoard: (projectId: string) => client.get<ProjectBoard>(`/api/workspace/projects/${projectId}/board`),
  initializeBoard: (projectId: string, expected_version: number) =>
    client.post<ProjectBoard>(`/api/workspace/projects/${projectId}/board/initialize`, { expected_version }),
  createStage: (projectId: string, name: string, expected_version: number) =>
    client.post<ProjectBoard>(`/api/workspace/projects/${projectId}/board/stages`, { name, expected_version }),
  updateStage: (projectId: string, stage: TaskStage, expected_version: number) =>
    client.put<ProjectBoard>(`/api/workspace/projects/${projectId}/board/stages/${stage.id}`, { ...stage, expected_version }),
  deleteStage: (projectId: string, stageId: string, expected_version: number) =>
    client.delete<ProjectBoard>(`/api/workspace/projects/${projectId}/board/stages/${stageId}?expected_version=${expected_version}`),
  moveBoardTask: (projectId: string, taskId: string, data: { stage_id: string; before_task_id: string | null; expected_version: number }) =>
    client.put<ProjectBoard>(`/api/workspace/projects/${projectId}/board/tasks/${taskId}`, data),
  // Templates
  listTemplates: () => client.get<ProjectTemplate[]>("/api/workspace/templates"),
  getTemplate: (id: string) => client.get<TemplateDetail>(`/api/workspace/templates/${id}`),
  createTemplate: (data: { name: string; description?: string; phases?: object[] }) =>
    client.post<ProjectTemplate>("/api/workspace/templates", data),

  // Projects
  listProjects: (archived = false) => client.get<Project[]>("/api/workspace/projects", {archived: String(archived)}),
  /** Bulk endpoint — returns projects + phases in 3 queries (no N+1). */
  timeline: () => client.get<TimelineProject[]>("/api/workspace/timeline"),
  getProject: (id: string) => client.get<Project>(`/api/workspace/projects/${id}`),
  createProject: (data: {
    name: string;
    rpo_number?: string;
    client_name?: string;
    template_id?: string;
    start_date?: string;
    deadline?: string;
    manager_id?: string;
    description?: string;
  }) => client.post<Project>("/api/workspace/projects", data),
  updateProject: (id: string, data: Partial<Project>) =>
    client.put<Project>(`/api/workspace/projects/${id}`, data),

  // Phases
  listPhases: (projectId: string) => client.get<Phase[]>(`/api/workspace/projects/${projectId}/phases`),
  createPhase: (projectId: string, data: { name: string; order?: number; start_date?: string; deadline?: string }) =>
    client.post<Phase>(`/api/workspace/projects/${projectId}/phases`, data),
  updatePhase: (phaseId: string, data: Partial<Phase>) =>
    client.put<Phase>(`/api/workspace/phases/${phaseId}`, data),

  // Tasks / Work Orders
  listTasks: (phaseId: string) => client.get<Task[]>(`/api/workspace/phases/${phaseId}/tasks`),
  myTasks: () => client.get<Task[]>("/api/workspace/my-tasks"),
  createTask: (phaseId: string, data: {
    name: string;
    description?: string;
    location?: string;
    estimated_days?: number;
    assigned_to?: string;
    deadline?: string;
    notes?: string;
    order?: number;
  }) =>
    client.post<Task>(`/api/workspace/phases/${phaseId}/tasks`, data),
  updateTask: (taskId: string, data: Partial<Task>) =>
    client.put<Task>(`/api/workspace/tasks/${taskId}`, data),

  // WO lifecycle
  startTask: (taskId: string) =>
    client.post<Task>(`/api/workspace/tasks/${taskId}/start`, {}),
  submitReport: (taskId: string, data: { photos_before?: string[]; photos_after?: string[]; notes?: string }) =>
    client.post<Completion>(`/api/workspace/tasks/${taskId}/submit-report`, data),
  reviewTask: (taskId: string, data: { decision: "approve" | "request_revision"; review_notes?: string }) =>
    client.post<Task>(`/api/workspace/tasks/${taskId}/review`, data),

  // Completions (legacy single-photo path, kept for backwards compat)
  completeTask: (taskId: string, data: { photo_url?: string; notes?: string }) =>
    client.post<Completion>(`/api/workspace/tasks/${taskId}/complete`, data),
  listCompletions: (taskId: string) =>
    client.get<Completion[]>(`/api/workspace/tasks/${taskId}/completions`),

  // Summary (dashboard)
  summary: () => client.get<WorkspaceSummary>("/api/workspace/summary"),
}; }

export const workspaceApi = createWorkspaceApi();
