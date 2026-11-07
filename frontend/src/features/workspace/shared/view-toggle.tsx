"use client";

import { List, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { WorkspaceView } from "../types";

const views: { key: WorkspaceView; label: string; icon: typeof List }[] = [
  { key: "list",     label: "Daftar",   icon: List },
  { key: "calendar", label: "Timeline", icon: CalendarDays },
];

export function ViewToggle({ value, onChange }: { value: WorkspaceView; onChange: (v: WorkspaceView) => void }) {
  return (
    <div role="group" aria-label="Tampilan proyek" className="flex shrink-0 items-center p-0.5 rounded-[var(--r)] bg-bg-ctrl border border-border">
      {views.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          aria-label={label}
          title={label}
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={cn(
            "flex min-h-11 min-w-11 items-center justify-center gap-1.5 px-2.5 rounded-[var(--r-sm)] text-[11.5px] font-medium transition-colors sm:min-h-7 sm:min-w-7",
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
