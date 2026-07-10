"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Calendar, MapPin, User } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface KanbanCardProps {
  id: string;
  title: string;
  subtitle?: string;
  status: string;
  rpoNumber?: string | null;
  location?: string | null;
  assigneeName?: string | null;
  progress?: number;
  deadline?: string | null;
  onClick?: () => void;
  draggable?: boolean;
}

function relativeDeadline(iso: string): { label: string; tone: "ok" | "warn" | "danger" } {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(iso); d.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return { label: `${Math.abs(diff)} hari lewat`, tone: "danger" };
  if (diff === 0) return { label: "Hari ini", tone: "danger" };
  if (diff <= 2) return { label: `${diff} hari lagi`, tone: "warn" };
  const formatted = d.toLocaleDateString("id-ID", { day: "numeric", month: "short" });
  return { label: formatted, tone: "ok" };
}

export function KanbanCard({
  id, title, subtitle,
  rpoNumber, location, assigneeName,
  progress, deadline, onClick, draggable,
}: KanbanCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !draggable,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const dl = deadline ? relativeDeadline(deadline) : null;
  const dlClass =
    dl?.tone === "danger" ? "bg-red-bg text-red"
    : dl?.tone === "warn" ? "bg-amber-bg text-amber"
    : "bg-bg-ctrl text-text-muted";

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={cn(
        "bg-bg border border-border rounded-[var(--r)] p-3 hover:border-primary/50 hover:shadow-[var(--shadow-xs)] transition-all",
        isDragging && "opacity-50 shadow-[var(--shadow-sm)] scale-[1.02] border-primary",
        draggable && "cursor-grab active:cursor-grabbing",
        !draggable && onClick && "cursor-pointer",
      )}
    >
      {rpoNumber && (
        <div className="text-[10px] font-mono font-bold text-primary mb-1">{rpoNumber}</div>
      )}
      <div className="text-[12.5px] font-semibold text-text leading-snug line-clamp-2">
        {title}
      </div>
      {subtitle && <div className="text-[11px] text-text-muted mt-0.5 truncate">{subtitle}</div>}

      {/* Meta chips */}
      {(assigneeName || location || dl) && (
        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
          {assigneeName && (
            <span className="inline-flex items-center gap-1 text-[10.5px] text-text-muted bg-bg-ctrl px-1.5 py-0.5 rounded-full">
              <User className="size-2.5" />
              {assigneeName}
            </span>
          )}
          {location && (
            <span className="inline-flex items-center gap-1 text-[10.5px] text-text-muted bg-bg-ctrl px-1.5 py-0.5 rounded-full max-w-[120px] truncate">
              <MapPin className="size-2.5" />
              {location}
            </span>
          )}
          {dl && (
            <span className={cn("inline-flex items-center gap-1 text-[10.5px] font-medium px-1.5 py-0.5 rounded-full", dlClass)}>
              <Calendar className="size-2.5" />
              {dl.label}
            </span>
          )}
        </div>
      )}

      {progress !== undefined && (
        <div className="flex items-center gap-2 mt-2">
          <div className="flex-1 bg-bg-ctrl rounded-full h-1.5 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary to-primary-hover transition-[width]"
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
          <span className="text-[10px] text-text-muted tabular-nums shrink-0">{progress}%</span>
        </div>
      )}
    </div>
  );
}
