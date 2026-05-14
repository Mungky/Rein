import { useState, useMemo, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { workspaceApi } from "@/lib/api/workspace";
import type { Project, Phase, Task } from "@/lib/api/workspace";
import { StatusBadge } from "../shared/status-badge";
import { GanttBar } from "./gantt-bar";
import { GanttTimeline } from "./gantt-timeline";
import {
  computeDateRange, dayOffset, totalDays, pxPerDay,
  todayOffset, type ZoomLevel,
} from "./utils";

export function GanttDetail({ project, onBack }: { project: Project; onBack: () => void }) {
  const [phases, setPhases] = useState<Phase[]>([]);
  const [tasksByPhase, setTasksByPhase] = useState<Record<string, Task[]>>({});
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState<ZoomLevel>("week");

  useEffect(() => {
    workspaceApi.listPhases(project.id).then(async (phs) => {
      setPhases(phs);
      const allTasks: Record<string, Task[]> = {};
      await Promise.all(
        phs.map(async (ph) => {
          allTasks[ph.id] = await workspaceApi.listTasks(ph.id);
        }),
      );
      setTasksByPhase(allTasks);
    }).finally(() => setLoading(false));
  }, [project.id]);

  const range = useMemo(() => {
    const dates = [
      project.start_date ? new Date(project.start_date) : null,
      project.deadline ? new Date(project.deadline) : null,
      ...phases.flatMap((ph) => [
        ph.start_date ? new Date(ph.start_date) : null,
        ph.deadline ? new Date(ph.deadline) : null,
      ]),
      ...Object.values(tasksByPhase).flat().map((t) =>
        t.deadline ? new Date(t.deadline) : null
      ),
    ].filter((d): d is Date => d !== null);
    return computeDateRange(dates);
  }, [project, phases, tasksByPhase]);

  const ppd = pxPerDay(zoom);
  const totalW = totalDays(range) * ppd;
  const today = todayOffset(range.start);

  // Calculate total rows: phases + their tasks
  const rows = useMemo(() => {
    const result: { type: "phase" | "task"; data: Phase | Task; phaseName?: string }[] = [];
    for (const ph of phases) {
      result.push({ type: "phase", data: ph });
      const tasks = tasksByPhase[ph.id] ?? [];
      for (const t of tasks) {
        result.push({ type: "task", data: t, phaseName: ph.name });
      }
    }
    return result;
  }, [phases, tasksByPhase]);

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-text-muted" /></div>;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 h-[46px] min-h-[46px] border-b border-border bg-bg shrink-0">
        <button onClick={onBack} className="text-text-muted hover:text-text transition-colors">
          ←
        </button>
        <span className="text-[14px] font-bold text-text truncate">{project.name}</span>
        <StatusBadge status={project.status} />
      </div>

      {/* Zoom controls */}
      <div className="flex items-center gap-1 px-4 py-1.5 border-b border-border bg-bg shrink-0">
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
      <div className="flex-1 overflow-auto">
        <div style={{ width: totalW, minWidth: "100%" }}>
          <GanttTimeline range={range} zoom={zoom} />

          {/* Today line */}
          {today >= 0 && today <= totalDays(range) && (
            <div className="absolute z-20 w-px bg-red-400/60" style={{ left: today * ppd, height: rows.length * 36 + 46 }}>
              <div className="absolute -top-[46px] text-[9px] font-bold text-red-500 bg-red-50 px-1 rounded-b">Hari ini</div>
            </div>
          )}

          {rows.map((row, i) => {
            const data = row.data;
            const hasStartDate = row.type === "phase" && "start_date" in data && data.start_date;
            const hasDeadline = "deadline" in data && data.deadline;
            const start = hasStartDate
              ? dayOffset(new Date(data.start_date!), range.start)
              : hasDeadline
                ? dayOffset(new Date(data.deadline!), range.start) - 3
                : 0;
            const end = hasDeadline
              ? dayOffset(new Date(data.deadline!), range.start)
              : start + 7;
            const duration = Math.max(end - start, 1);

            return (
              <div
                key={data.id}
                className={`relative ${row.type === "phase" ? "bg-bg-hover/30" : ""}`}
                style={{ height: row.type === "phase" ? 36 : 32 }}
              >
                {/* Row label (absolute, outside scroll) */}
                <div className="sticky left-0 z-10 flex items-center h-full px-3 bg-bg/90 backdrop-blur-sm">
                  <span className={`text-[11px] ${row.type === "phase" ? "font-bold" : "font-medium"} text-text truncate`}>
                    {row.type === "task" && <span className="text-text-muted mr-1">└</span>}
                    {data.name}
                  </span>
                </div>

                <GanttBar
                  label={data.name}
                  status={data.status}
                  startOffset={start}
                  durationDays={duration}
                  progress={"progress" in data ? (data as Phase).progress : 0}
                  pxPerDay={ppd}
                  isDiamond={row.type === "task"}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}