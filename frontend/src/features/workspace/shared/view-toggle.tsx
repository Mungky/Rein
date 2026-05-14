import { List, Calendar, Columns3 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { WorkspaceView } from "../types";

const views: { key: WorkspaceView; label: string; icon: typeof List }[] = [
  { key: "list", label: "Daftar", icon: List },
  { key: "gantt", label: "Gantt", icon: Calendar },
  { key: "kanban", label: "Kanban", icon: Columns3 },
];

export function ViewToggle({ value, onChange }: { value: WorkspaceView; onChange: (v: WorkspaceView) => void }) {
  return (
    <div className="flex items-center gap-0.5 ml-2">
      {views.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={cn(
            "flex items-center justify-center gap-1 h-7 px-2 rounded-md text-[11px] font-medium transition-all",
            value === key
              ? "bg-primary-bg text-primary border border-primary-mid"
              : "text-text-muted hover:bg-bg-hover border border-transparent",
          )}
        >
          <Icon className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}