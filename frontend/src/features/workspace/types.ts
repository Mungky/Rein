export type WorkspaceView = "list" | "kanban" | "calendar";

export type {
  Project, Phase, Task, ProjectTemplate, Completion,
  WorkspaceSummary, SummaryProject, SummaryTask,
} from "@/lib/api/workspace";