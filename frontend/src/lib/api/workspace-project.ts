import type { ApiClient } from "./client";

export interface NamedItem { id: string; name: string; avatar_url?: string | null; inactive?: boolean }
export interface Milestone extends NamedItem { deadline: string | null; reached_at: string | null }
export interface PlanningChoices {
  recurrence_worker_enabled?: boolean;
  version: number;
  tasks: (NamedItem & { status: string })[];
  people: NamedItem[];
  member_ids: string[];
  phases: NamedItem[];
  milestones: Milestone[];
  tags: NamedItem[];
}
export interface TaskPlanning {
  parent_id: string | null; milestone_id: string | null; priority: number;
  estimated_minutes: number; portal_visible: boolean; assignees: NamedItem[];
  tags: NamedItem[]; dependency_ids: string[]; blocked: boolean; overdue: boolean;
}
export interface TimeEntry { id: string; profile_id: string; name: string; work_date: string; minutes: number; description: string }
export interface TaskDetails {
  project_id: string; planning: PlanningChoices; metadata: TaskPlanning;
  subtasks: (NamedItem & { status: string })[];
  comments: { id: string; body: string; external: boolean; created_at: string; author_name: string }[];
  attachments: { id: string; name: string; external: boolean; content_type: string; bytes: number }[];
  time_entries: TimeEntry[];
  events: { id: string; action: string; created_at: string; actor_name: string | null }[];
  recurrence: { id: string; unit: string; interval: number; next_date: string; end_date: string | null; active: boolean } | null;
}
export interface TaskPlanInput {
  expected_version: number; parent_id: string | null; milestone_id: string | null;
  priority: number; estimated_minutes: number; portal_visible: boolean;
  assignee_ids: string[]; dependency_ids: string[]; tag_ids: string[];
}
export interface ProjectUpdate { id: string; health: string; summary: string; external: boolean; created_at: string; author_name: string }
export interface ProjectNotification { id: string; message: string; read_at: string | null; created_at: string }
export interface PortalShare { id: string; label: string; expires_at: string; revoked_at: string | null }
export interface ProjectReport {
  history_complete?: boolean;
  total: number; done: number; blocked: number; overdue: number; progress: number;
  estimated_minutes: number; logged_minutes: number; status_counts: Record<string, number>;
  assignees: { id: string; name: string; tasks: number; done: number; minutes: number }[];
  burndown: { date: string; remaining: number }[];
  milestones: (Milestone & { tasks: number; done: number })[];
}

export function createProjectApi(client: ApiClient) { return {
  searchProjectTasks: (id: string, params: Record<string, string>) => client.get<{ total: number; items: { id: string; name: string; status: string; deadline: string | null }[] }>(`/api/workspace/projects/${id}/task-search`, params),
  projectPlanning: (id: string) => client.get<PlanningChoices>(`/api/workspace/projects/${id}/planning`),
  taskDetails: (id: string) => client.get<TaskDetails>(`/api/workspace/tasks/${id}/details`),
  saveTaskPlan: (id: string, body: TaskPlanInput) => client.put(`/api/workspace/tasks/${id}/planning`, body),
  createSubtask: (id: string, name: string, expected_version: number) => client.post(`/api/workspace/tasks/${id}/subtasks`, { name, expected_version }),
  createMilestone: (id: string, body: { name: string; deadline: string | null; expected_version: number }) => client.post<Milestone>(`/api/workspace/projects/${id}/milestones`, body),
  updateMilestone: (id: string, milestone: Milestone, reached: boolean, expected_version: number) => client.put(`/api/workspace/projects/${id}/milestones/${milestone.id}`, { name: milestone.name, deadline: milestone.deadline, reached, expected_version }),
  deleteMilestone: (id: string, milestoneId: string, version: number) => client.delete(`/api/workspace/projects/${id}/milestones/${milestoneId}?expected_version=${version}`),
  createTag: (id: string, name: string, expected_version: number) => client.post(`/api/workspace/projects/${id}/tags`, { name, expected_version }),
  addComment: (id: string, body: { body: string; external: boolean; mention_ids: string[] }) => client.post(`/api/workspace/tasks/${id}/comments`, body),
  uploadAttachment: (id: string, file: File, external: boolean) => client.upload(`/api/workspace/tasks/${id}/attachments`, file, "file", { external: String(external) }),
  downloadAttachment: (id: string) => client.getBlob(`/api/workspace/attachments/${id}`),
  deleteAttachment: (id: string) => client.delete(`/api/workspace/attachments/${id}`),
  logTime: (id: string, body: { request_id: string; work_date: string; minutes: number; description: string }) => client.post(`/api/workspace/tasks/${id}/time-entries`, body),
  updateTime: (id: string, body: { request_id: string; work_date: string; minutes: number; description: string }) => client.put(`/api/workspace/time-entries/${id}`, body),
  deleteTime: (id: string) => client.delete(`/api/workspace/time-entries/${id}`),
  saveRecurrence: (id: string, body: { expected_version: number; unit: string; interval: number; next_date: string; end_date: string | null; active: boolean }) => client.put(`/api/workspace/tasks/${id}/recurrence`, body),
  runRecurrences: (id: string) => client.post<{ generated: number }>(`/api/workspace/projects/${id}/recurrences/run`, {}),
  projectUpdates: (id: string) => client.get<ProjectUpdate[]>(`/api/workspace/projects/${id}/updates`),
  addProjectUpdate: (id: string, body: { health: string; summary: string; external: boolean }) => client.post(`/api/workspace/projects/${id}/updates`, body),
  projectNotifications: (id: string) => client.get<ProjectNotification[]>(`/api/workspace/projects/${id}/notifications`),
  readNotification: (id: string) => client.post(`/api/workspace/notifications/${id}/read`, {}),
  projectReport: (id: string) => client.get<ProjectReport>(`/api/workspace/projects/${id}/report`),
  shares: (id: string) => client.get<PortalShare[]>(`/api/workspace/projects/${id}/shares`),
  createShare: (id: string, body: { label: string; expires_in_days: number }) => client.post<{ token: string; share: PortalShare }>(`/api/workspace/projects/${id}/shares`, body),
  revokeShare: (id: string, shareId: string) => client.delete(`/api/workspace/projects/${id}/shares/${shareId}`),
  duplicateProject: (id: string, body: { name: string; request_id: string }) => client.post<{ project_id: string }>(`/api/workspace/projects/${id}/duplicate`, body),
  projectFromSale: (body: { reference: string; customer: string; project_name: string; lines: string[] }) => client.post<{ project_id: string }>("/api/workspace/sales-orders", body),
}; }
