import { useState, useMemo, useRef } from "react";
import { Loader2, Calendar, ZoomIn, ZoomOut } from "lucide-react";
import { useWorkspaceStore } from "../store";
import { STATUS_LABEL } from "../constants";
import { StatusBadge } from "../shared/status-badge";
import { ProgressBar } from "../shared/progress-bar";
import { GanttBar } from "./gantt-bar";
import { GanttTimeline } from "./gantt-timeline";
import {
  computeDateRange, dayOffset, totalDays, pxPerDay,
  todayOffset, type ZoomLevel, type DateRange,
} from "./utils";

export function GanttView({ canManage }: { canManage: boolean }) {
  const { projects, loading, selectProject } = useWorkspaceStore();
  const [zoom, setZoom] = useState<ZoomLevel>("month");
  const scrollRef = useRef<HTMLDivElement>(null);

  const range = useMemo(() => {
    const dates = projects.flatMap((p) => [
      p.start_date ? new Date(p.start_date) : null,
      p.deadline ? new Date(p.deadline) : null,
    ]);
    return computeDateRange(dates);
  }, [projects]);

  const ppd = pxPerDay(zoom);
  const totalW = totalDays(range) * ppd;
  const today = todayOffset(range.start);

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-text-muted" /></div>;
  }

  if (projects.length === 0) {
    return <div className="flex flex-col items-center justify-center py-20 gap-3 text-center px-4"><div className="text-[13px] text-text-muted">Belum ada proyek untuk ditampilkan di Gantt.</div></div>;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Zoom controls */}
      <div className="flex items-center gap-1 px-4 py-1.5 border-b border-border bg-bg shrink-0">
        <Calendar className="w-3.5 h-3.5 text-text-muted mr-1" />
        <span className="text-[11px] text-text-muted">Zoom:</span>
        {(["week", "month", "quarter"] as ZoomLevel[]).map((z) => (
          <button
            key={z}
            onClick={() => setZoom(z)}
            className={`text-[10.5px] font-medium px-2 py-0.5 rounded ${zoom === z ? "bg-primary-bg text-primary" : "text-text-muted hover:bg-bg-hover"}`}
          >
            {z === "week" ? "Minggu" : z === "month" ? "Bulan" : "Kuartal"}
          </button>
        ))}
      </div>

      {/* Timeline + bars */}
      <div className="flex-1 overflow-auto" ref={scrollRef}>
        <div style={{ width: totalW, minWidth: "100%" }}>
          <GanttTimeline range={range} zoom={zoom} />

          {/* Today line */}
          {today >= 0 && today <= totalDays(range) && (
            <div className="absolute z-20 w-px bg-red-400/60" style={{ left: today * ppd, height: projects.length * 40 + 46 }}>
              <div className="absolute -top-[46px] text-[9px] font-bold text-red-500 bg-red-50 px-1 rounded-b">Hari ini</div>
            </div>
          )}

          {/* Project rows */}
          {projects.map((p, i) => {
            const start = p.start_date ? dayOffset(new Date(p.start_date), range.start) : 0;
            const end = p.deadline ? dayOffset(new Date(p.deadline), range.start) : start + 14;
            const duration = Math.max(end - start, 1);

            return (
              <div key={p.id} className="relative border-b border-border-soft" style={{ height: 40 }}>
                <GanttBar
                  label={p.name}
                  status={p.status}
                  startOffset={start}
                  durationDays={duration}
                  progress={p.progress}
                  pxPerDay={ppd}
                  onClick={() => selectProject(p.id)}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}