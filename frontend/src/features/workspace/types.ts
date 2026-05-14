export type WorkspaceView = "list" | "gantt" | "kanban";

export type {
  Project, Phase, Task, ProjectTemplate, Completion,
  WorkspaceSummary, SummaryProject, SummaryTask,
} from "@/lib/api/workspace";