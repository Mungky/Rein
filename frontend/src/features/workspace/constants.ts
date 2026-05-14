export const STATUS_LABEL: Record<string, string> = {
  planning: "Perencanaan", active: "Aktif", on_hold: "Ditunda", completed: "Selesai",
  pending: "Menunggu",
  todo: "Belum", in_progress: "Dikerjakan", done: "Selesai", overdue: "Terlambat",
};

export const STATUS_COLOR: Record<string, string> = {
  planning: "bg-blue-100 text-blue-700",
  active: "bg-green-100 text-green-700",
  on_hold: "bg-yellow-100 text-yellow-700",
  completed: "bg-gray-100 text-gray-600",
  pending: "bg-gray-100 text-gray-500",
  todo: "bg-gray-100 text-gray-600",
  in_progress: "bg-blue-100 text-blue-700",
  done: "bg-green-100 text-green-700",
  overdue: "bg-red-100 text-red-700",
};

export const PROJECT_STATUSES = ["planning", "active", "on_hold", "completed"] as const;
export const TASK_STATUSES = ["todo", "in_progress", "done", "overdue"] as const;