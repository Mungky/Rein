"use client";

import { List, Columns3, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { WorkspaceView } from "../types";

const views: { key: WorkspaceView; label: string; icon: typeof List }[] = [
  { key: "list",     label: "Daftar",   icon: List },
  { key: "kanban",   label: "Kanban",   icon: Columns3 },
  { key: "calendar", label: "Timeline", icon: CalendarDays },
];

export function ViewToggle({ value, onChange }: { value: WorkspaceView; onChange: (v: WorkspaceView) => void }) {
  return (
    <div className="flex items-center p-0.5 rounded-[var(--r)] bg-bg-ctrl border border-border ml-2">
      {views.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={cn(
            "flex items-center justify-center gap-1.5 h-7 px-2.5 rounded-[var(--r-sm)] text-[11.5px] font-medium transition-all",
            value === key
              ? "bg-bg text-primary shadow-[var(--shadow-xs)]"
              : "text-text-muted hover:text-text",
          )}
        >
          <Icon className="size-3.5" />
          <span className="hidden md:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}
