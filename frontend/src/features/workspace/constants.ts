export const STATUS_LABEL: Record<string, string> = {
  // Project
  planning: "Perencanaan", active: "Aktif", on_hold: "Ditunda", completed: "Selesai",
  // Phase
  pending: "Menunggu",
  // Task / WO
  todo: "To Do",
  in_progress: "On Progress",
  pending_review: "Need Review",
  done: "Finish",
  overdue: "To Do",
  cancelled: "Cancelled",
};

/* Uses the design-system tokens (badge-*) where possible, falls back to Tailwind. */
export const STATUS_COLOR: Record<string, string> = {
  planning:       "badge badge-blue",
  active:         "badge badge-green",
  on_hold:        "badge badge-amber",
  completed:      "badge badge-muted",
  pending:        "badge badge-muted",
  todo:           "badge badge-muted",
  in_progress:    "badge badge-blue",
  pending_review: "badge badge-amber",
  done:           "badge badge-green",
  overdue:        "badge badge-muted",
  cancelled:      "badge badge-red",
};

export const PROJECT_STATUSES = ["planning", "active", "on_hold", "completed"] as const;
export const TASK_STATUSES = ["todo", "in_progress", "pending_review", "done", "cancelled"] as const;

/** Kanban columns — order matters for left-to-right rendering */
export const KANBAN_COLUMNS = [
  { key: "todo",           label: "To Do",           accent: "border-l-slate-400" },
  { key: "in_progress",    label: "On Progress",     accent: "border-l-blue-500"  },
  { key: "pending_review", label: "Need Review", accent: "border-l-amber-500" },
  { key: "done",           label: "Finish",        accent: "border-l-green-500" },
  { key: "cancelled", label: "Cancelled", accent: "border-l-red-400" },
] as const;
