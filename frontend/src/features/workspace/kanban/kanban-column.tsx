import { useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils/cn";

interface KanbanColumnProps {
  id: string;
  label: string;
  colorClass: string;
  count: number;
  children: React.ReactNode;
}

export function KanbanColumn({ id, label, colorClass, count, children }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex-shrink-0 w-[280px] md:w-[300px] flex flex-col bg-bg-hover/40 rounded-lg border border-border/50",
        isOver && "border-primary/50 bg-primary-bg/10",
      )}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/50">
        <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full", colorClass)}>
          {label}
        </span>
        <span className="text-[10.5px] text-text-muted">{count}</span>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[120px]">
        {children}
      </div>
    </div>
  );
}