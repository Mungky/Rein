import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils/cn";
import { STATUS_LABEL } from "../constants";

interface KanbanCardProps {
  id: string;
  title: string;
  subtitle?: string;
  status: string;
  progress?: number;
  deadline?: string | null;
  onClick?: () => void;
  draggable?: boolean;
}

export function KanbanCard({ id, title, subtitle, status, progress, deadline, onClick, draggable }: KanbanCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !draggable,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={cn(
        "bg-bg border border-border rounded-lg p-3 cursor-pointer hover:border-primary/40 transition-all",
        isDragging && "opacity-50 shadow-lg scale-[1.02]",
        draggable && "cursor-grab active:cursor-grabbing",
      )}
    >
      <div className="text-[12.5px] font-semibold text-text truncate">{title}</div>
      {subtitle && <div className="text-[10.5px] text-text-muted mt-0.5 truncate">{subtitle}</div>}
      {deadline && (
        <div className="text-[10.5px] text-text-muted mt-1">
          {new Date(deadline).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}
        </div>
      )}
      {progress !== undefined && (
        <div className="flex items-center gap-2 mt-1.5">
          <div className="flex-1 bg-bg-hover rounded-full h-1 overflow-hidden">
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(progress, 100)}%` }} />
          </div>
          <span className="text-[9.5px] text-text-muted shrink-0">{progress}%</span>
        </div>
      )}
    </div>
  );
}