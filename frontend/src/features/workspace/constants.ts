export const STATUS_LABEL: Record<string, string> = {
  // Project
  planning: "Perencanaan", active: "Aktif", on_hold: "Ditunda", completed: "Selesai",
  // Phase
  pending: "Menunggu",
  // Task / WO
  todo: "Todo",
  in_progress: "Dikerjakan",
  pending_review: "Menunggu Review",
  done: "Selesai",
  overdue: "Terlambat",
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
  overdue:        "badge badge-red",
};

export const PROJECT_STATUSES = ["planning", "active", "on_hold", "completed"] as const;
export const TASK_STATUSES = ["todo", "in_progress", "pending_review", "done", "overdue"] as const;

/** Kanban columns — order matters for left-to-right rendering */
export const KANBAN_COLUMNS = [
  { key: "todo",           label: "Todo",           accent: "border-l-slate-400" },
  { key: "in_progress",    label: "Dikerjakan",     accent: "border-l-blue-500"  },
  { key: "pending_review", label: "Menunggu Review", accent: "border-l-amber-500" },
  { key: "done",           label: "Selesai",        accent: "border-l-green-500" },
] as const;