"use client";

import { useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils/cn";

interface KanbanColumnProps {
  id: string;
  label: string;
  /** Tailwind class for left accent border, e.g. "border-l-blue-500" */
  accentClass?: string;
  count: number;
  children: React.ReactNode;
}

export function KanbanColumn({ id, label, accentClass, count, children }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex-shrink-0 w-[290px] md:w-[320px] flex flex-col rounded-[var(--r-xl)] border border-border bg-bg-ctrl/40 transition-all",
        "border-l-4",
        accentClass ?? "border-l-text-light",
        isOver && "border-primary bg-primary-soft ring-2 ring-primary/20",
      )}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-soft">
        <span className="text-[12px] font-bold uppercase tracking-[0.05em] text-text">
          {label}
        </span>
        <span className="text-[11px] text-text-muted tabular-nums ml-auto px-2 py-0.5 rounded-full bg-bg">
          {count}
        </span>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5 min-h-[140px]">
        {children}
      </div>
    </div>
  );
}
