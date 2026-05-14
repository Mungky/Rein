import { cn } from "@/lib/utils/cn";
import { STATUS_COLOR } from "../constants";

interface GanttBarProps {
  label: string;
  status: string;
  startOffset: number;
  durationDays: number;
  progress: number;
  pxPerDay: number;
  onClick?: () => void;
  isDiamond?: boolean;
}

export function GanttBar({ label, status, startOffset, durationDays, progress, pxPerDay, onClick, isDiamond }: GanttBarProps) {
  const left = startOffset * pxPerDay;
  const width = Math.max(durationDays * pxPerDay, isDiamond ? pxPerDay : 8);

  if (isDiamond) {
    return (
      <button
        onClick={onClick}
        className="absolute top-1/2 -translate-y-1/2 group"
        style={{ left }}
        title={label}
      >
        <div className={cn("w-3 h-3 rotate-45 border-2 border-white shadow-sm", STATUS_COLOR[status] ?? "bg-gray-200 text-gray-600")} />
        <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 px-1.5 py-0.5 bg-bg border border-border rounded text-[10px] text-text whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-sm z-10">
          {label}
        </div>
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      className="absolute top-1/2 -translate-y-1/2 group"
      style={{ left, width }}
      title={label}
    >
      <div className={cn(
        "h-5 rounded-full text-[9.5px] font-bold px-2 flex items-center overflow-hidden whitespace-nowrap",
        STATUS_COLOR[status] ?? "bg-gray-200 text-gray-600",
      )}>
        <span className="truncate">{label}</span>
      </div>
      {progress > 0 && (
        <div
          className="absolute inset-0 rounded-full bg-black/10 pointer-events-none"
          style={{ width: `${Math.min(progress, 100)}%`, maxWidth: "100%" }}
        />
      )}
      <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 px-2 py-1 bg-bg border border-border rounded text-[10px] text-text whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-sm z-10">
        {label} — {progress}%
      </div>
    </button>
  );
}