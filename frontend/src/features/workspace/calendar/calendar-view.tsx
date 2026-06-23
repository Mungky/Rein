"use client";

/**
 * Timeline (Linear-style Plan view) — horizontal Gantt-style roadmap.
 *
 * Two modes:
 *   - Global  (no `project` prop): rows = projects, project bar + phase markers
 *   - Detail  (with project prop): rows = phases of that project, phase bar + WO markers
 *
 * Layout:
 *   ┌─ Left panel (sticky) ─┬─ Timeline (horizontal scroll) ─────────────────┐
 *   │ Project/Phase info    │ Months header                                  │
 *   │ Progress %            │ Bars positioned by date offset × pxPerDay      │
 *   └───────────────────────┴────────────────────────────────────────────────┘
 *
 * The whole grid is one scroll container with two-axis sticky:
 *   - Header sticks to top
 *   - Left panel sticks to left
 */

import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  addDays, differenceInCalendarDays, eachMonthOfInterval, endOfMonth, format,
  max as maxDate, min as minDate, parseISO, isSameMonth,
} from "date-fns";
import { id as idLocale } from "date-fns/locale/id";
import {
  ChevronLeft, FolderKanban, Loader2,
} from "lucide-react";
import { workspaceApi } from "@/lib/api/workspace";
import type { Phase, Project, Task, TimelineProject } from "@/lib/api/workspace";
import { useAuthDisplay } from "@/hooks/use-auth";
import { useCan } from "@/components/providers/permissions-provider";
import type { AppRole } from "@/lib/utils/roles";
import { useWorkspaceStore } from "../store";
import { WoDetailDrawer } from "../shared/wo-detail-drawer";
import { StatusBadge } from "../shared/status-badge";

// =========================================================================
// Constants
// =========================================================================

type ZoomLevel = "week" | "month" | "quarter";

const ZOOM: Record<ZoomLevel, { label: string; pxPerDay: number }> = {
  week:    { label: "Minggu",  pxPerDay: 32 },
  month:   { label: "Bulan",   pxPerDay: 10 },
  quarter: { label: "Kuartal", pxPerDay: 4 },
};

const LEFT_PANEL_WIDTH = 240;
const HEADER_HEIGHT = 48;
const ROW_HEIGHT_GLOBAL = 60;  // project rows
const ROW_HEIGHT_DETAIL = 48;  // phase rows
const PROJECT_BAR_HEIGHT = 22;
const PHASE_BAR_HEIGHT = 18;

const PAD_DAYS_BEFORE = 7;
const PAD_DAYS_AFTER = 30;

// Project status → bar colors (base bg, solid fill for progress, border).
// Keeping these as objects (not Tailwind opacity-suffix strings to
// string-munge) so adjusting any single token never breaks the progress fill.
const PROJECT_BAR_COLORS: Record<string, { bg: string; solid: string; border: string }> = {
  planning:  { bg: "bg-blue/80",       solid: "bg-blue",       border: "border-blue" },
  active:    { bg: "bg-green/80",      solid: "bg-green",      border: "border-green" },
  on_hold:   { bg: "bg-amber/80",      solid: "bg-amber",      border: "border-amber" },
  completed: { bg: "bg-text-light/60", solid: "bg-text-light", border: "border-text-light" },
};

// Task status → bar colors
const TASK_BAR_COLORS: Record<string, { bg: string; border: string }> = {
  done:           { bg: "bg-green/85",      border: "border-green" },
  in_progress:    { bg: "bg-blue/85",       border: "border-blue" },
  pending_review: { bg: "bg-amber/85",      border: "border-amber" },
  overdue:        { bg: "bg-red/85",        border: "border-red" },
  todo:           { bg: "bg-text-light/70", border: "border-text-light" },
};

// =========================================================================
// Types
// =========================================================================

interface CalendarProps {
  project?: Project;
  onBack: () => void;
}

interface PhaseRowData {
  phase: Phase;
  tasks: Task[];
}

// =========================================================================
// Main component
// =========================================================================

export function CalendarView({ project, onBack }: CalendarProps) {
  const { role } = useAuthDisplay();
  const canManage = useCan(role as AppRole, "workspace:manage");
  const canExecute = useCan(role as AppRole, "workspace:execute_wo");
  const canReview = useCan(role as AppRole, "workspace:review_wo") || canManage;
  const { projects, selectProject } = useWorkspaceStore();

  const [zoom, setZoom] = useState<ZoomLevel>("month");
  // Global mode now uses the bulk /timeline endpoint (3 queries total)
  // instead of fanning out listPhases per project (was N+1).
  const [globalRows, setGlobalRows] = useState<TimelineProject[]>([]);
  const [detailRows, setDetailRows] = useState<PhaseRowData[]>([]);
  const [loading, setLoading] = useState(true);
  const [openTask, setOpenTask] = useState<{ task: Task; phaseName: string | null; project: Project | undefined } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const didInitialScrollRef = useRef(false);

  // -------- Load --------
  // Fetch-on-mount: setState inside the effect IS the synchronization (URL/scope → fetched data).
  // The react-hooks/set-state-in-effect rule prefers `use(promise)` / external libs (SWR), but
  // that refactor is out of scope here.
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    didInitialScrollRef.current = false;  // reset for new dataset
    (async () => {
      try {
        if (project) {
          const phases = await workspaceApi.listPhases(project.id);
          const tasksPerPhase = await Promise.all(phases.map((ph) => workspaceApi.listTasks(ph.id)));
          const rows: PhaseRowData[] = phases.map((ph, i) => ({ phase: ph, tasks: tasksPerPhase[i] }));
          if (!cancelled) setDetailRows(rows);
        } else {
          const rows = await workspaceApi.timeline();
          if (!cancelled) setGlobalRows(rows);
        }
      } catch (e) {
        console.warn("Timeline load failed:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [project, projects]);

  // -------- Compute date range --------
  const range = useMemo(() => {
    const dates: Date[] = [];
    const push = (s: string | null, e: string | null) => {
      if (s) dates.push(parseISO(s));
      if (e) dates.push(parseISO(e));
    };
    if (project) {
      push(project.start_date, project.deadline);
      for (const r of detailRows) {
        push(r.phase.start_date, r.phase.deadline);
        for (const t of r.tasks) push(t.deadline, t.deadline);
      }
    } else {
      for (const r of globalRows) {
        push(r.start_date, r.deadline);
        for (const ph of r.phases) push(ph.start_date, ph.deadline);
      }
    }
    const today = new Date();
    dates.push(today);
    if (dates.length === 0) {
      return { start: addDays(today, -14), end: addDays(today, 60) };
    }
    return {
      start: addDays(minDate(dates), -PAD_DAYS_BEFORE),
      end: addDays(maxDate(dates), PAD_DAYS_AFTER),
    };
  }, [project, globalRows, detailRows]);

  const pxPerDay = ZOOM[zoom].pxPerDay;
  const totalDays = differenceInCalendarDays(range.end, range.start) + 1;
  const totalWidth = totalDays * pxPerDay;
  const todayOffset = differenceInCalendarDays(new Date(), range.start);
  const todayInRange = todayOffset >= 0 && todayOffset <= totalDays;

  // Month/week tick segments for the header
  const monthSegments = useMemo(() => {
    const months = eachMonthOfInterval({ start: range.start, end: range.end });
    return months.map((m) => {
      const segStart = maxDate([m, range.start]);
      const segEnd = minDate([endOfMonth(m), range.end]);
      const startOffset = differenceInCalendarDays(segStart, range.start);
      const days = differenceInCalendarDays(segEnd, segStart) + 1;
      return {
        date: m,
        left: startOffset * pxPerDay,
        width: days * pxPerDay,
      };
    });
  }, [range.start, range.end, pxPerDay]);

  // Auto-scroll to today on first successful load. Uses a ref guard so it
  // only fires once per data load — re-runs after dataset changes (covered
  // by resetting the ref in the loader above).
  useEffect(() => {
    if (loading || !scrollRef.current || didInitialScrollRef.current) return;
    if (!todayInRange) return;
    const targetX = todayOffset * pxPerDay - 200;
    scrollRef.current.scrollLeft = Math.max(0, targetX);
    didInitialScrollRef.current = true;
  }, [loading, todayInRange, todayOffset, pxPerDay]);

  const handleTaskUpdated = (next: Task) => {
    setDetailRows((rows) => rows.map((r) => ({
      ...r,
      tasks: r.tasks.map((t) => t.id === next.id ? next : t),
    })));
    if (openTask && openTask.task.id === next.id) {
      setOpenTask({ ...openTask, task: next });
    }
  };

  const isGlobal = !project;
  const rowCount = isGlobal ? globalRows.length : detailRows.length;

  return (
    <div className="flex flex-col h-full">
      {/* Header — fixed at top of view */}
      <div className="flex items-center gap-3 px-5 h-[52px] min-h-[52px] border-b border-border-soft bg-bg shrink-0">
        {project && (
          <button onClick={onBack} className="btn btn-ghost btn-icon btn-sm shrink-0">
            <ChevronLeft className="size-4" />
          </button>
        )}
        {project ? (
          <>
            {project.rpo_number && (
              <span className="font-mono text-[12.5px] font-bold text-primary shrink-0">{project.rpo_number}</span>
            )}
            <span className="text-[14px] font-bold text-text truncate min-w-0 flex-1" title={project.name}>
              {project.name}
            </span>
            <div className="shrink-0"><StatusBadge status={project.status} /></div>
          </>
        ) : (
          <>
            <span className="text-[14px] font-bold text-text">Timeline</span>
            <div className="flex-1" />
          </>
        )}

        {/* Zoom controls */}
        <div className="flex items-center gap-0.5 shrink-0 bg-bg-ctrl border border-border rounded-[var(--r)] p-0.5">
          {(["week", "month", "quarter"] as ZoomLevel[]).map((z) => (
            <button
              key={z}
              onClick={() => setZoom(z)}
              className={`px-2 py-0.5 text-[11px] font-medium rounded-[var(--r-sm)] transition-all ${
                zoom === z ? "bg-bg text-primary shadow-[var(--shadow-xs)]" : "text-text-muted hover:text-text"
              }`}
            >
              {ZOOM[z].label}
            </button>
          ))}
        </div>
        <button
          onClick={() => {
            if (!scrollRef.current) return;
            const targetX = todayOffset * pxPerDay - 200;
            scrollRef.current.scrollTo({ left: Math.max(0, targetX), behavior: "smooth" });
          }}
          className="btn btn-default btn-sm shrink-0"
          disabled={!todayInRange}
        >
          Hari Ini
        </button>
      </div>

      {/* Body */}
      {loading ? (
        <div className="flex-1 flex justify-center items-center">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : rowCount === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-4">
          <div className="size-16 rounded-[var(--r-xl)] bg-bg-ctrl border border-border flex items-center justify-center">
            <FolderKanban className="size-7 text-text-light" />
          </div>
          <div className="text-[13px] text-text-muted">
            {isGlobal ? "Belum ada proyek untuk ditampilkan." : "Belum ada tahapan untuk proyek ini."}
          </div>
        </div>
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-auto bg-bg-ctrl/15">
          <div
            className="relative"
            style={{ minWidth: LEFT_PANEL_WIDTH + totalWidth, minHeight: "100%" }}
          >
            {/* ---------- Sticky header row (months) ---------- */}
            <div
              className="sticky top-0 z-30 bg-bg border-b border-border flex"
              style={{ height: HEADER_HEIGHT }}
            >
              <div
                className="sticky left-0 z-40 bg-bg border-r border-border flex items-center px-4"
                style={{ width: LEFT_PANEL_WIDTH, minWidth: LEFT_PANEL_WIDTH }}
              >
                <span className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-text-light">
                  {isGlobal ? "Proyek" : "Tahapan"}
                </span>
              </div>
              <div className="relative" style={{ width: totalWidth }}>
                {monthSegments.map((m) => (
                  <div
                    key={m.date.toISOString()}
                    className="absolute top-0 bottom-0 flex flex-col justify-center border-l border-border-soft"
                    style={{ left: m.left, width: m.width }}
                  >
                    <div className="px-2 text-[11.5px] font-bold text-text capitalize">
                      {format(m.date, "MMMM yyyy", { locale: idLocale })}
                    </div>
                    {/* Day ticks (only visible at week zoom) */}
                    {zoom === "week" && (
                      <DayTicks
                        monthStart={m.date}
                        rangeStart={range.start}
                        rangeEnd={range.end}
                        pxPerDay={pxPerDay}
                      />
                    )}
                  </div>
                ))}
                {/* Today line — extends through whole body via z-index hack */}
                {todayInRange && (
                  <div
                    className="absolute top-0 bottom-0 w-px bg-red/80 z-20 pointer-events-none"
                    style={{ left: todayOffset * pxPerDay }}
                  >
                    <div className="absolute top-1 -translate-x-1/2 left-0 bg-red text-white text-[9px] font-bold px-1.5 py-0.5 rounded">
                      HARI INI
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ---------- Rows ---------- */}
            <div className="relative">
              {/* Today line continued through rows */}
              {todayInRange && (
                <div
                  className="absolute top-0 bottom-0 w-px bg-red/40 pointer-events-none"
                  style={{ left: LEFT_PANEL_WIDTH + todayOffset * pxPerDay }}
                />
              )}

              {isGlobal
                ? globalRows.map((r) => (
                    <ProjectRow
                      key={r.id}
                      data={r}
                      rangeStart={range.start}
                      pxPerDay={pxPerDay}
                      totalWidth={totalWidth}
                      onProjectClick={() => selectProject(r.id)}
                      onPhaseClick={() => selectProject(r.id)}
                    />
                  ))
                : detailRows.map((r) => (
                    <PhaseRow
                      key={r.phase.id}
                      data={r}
                      rangeStart={range.start}
                      pxPerDay={pxPerDay}
                      totalWidth={totalWidth}
                      onTaskClick={(t) => setOpenTask({
                        task: t,
                        phaseName: r.phase.name,
                        project,
                      })}
                    />
                  ))}
            </div>
          </div>
        </div>
      )}

      {openTask && (
        <WoDetailDrawer
          taskId={openTask.task.id}
          initial={openTask.task}
          rpoNumber={openTask.project?.rpo_number ?? null}
          phaseName={openTask.phaseName}
          canManage={canManage}
          canExecute={canExecute || openTask.task.assigned_to === undefined}
          canReview={canReview}
          onTaskChanged={handleTaskUpdated}
          onClose={() => setOpenTask(null)}
        />
      )}
    </div>
  );
}

// =========================================================================
// Day ticks (week zoom only) — shows day numbers below month label.
// Memoized: at quarter zoom this loop allocates a Date per day across many
// months. Re-rendering parent rows shouldn't re-run it unless props change.
// =========================================================================

const DayTicks = memo(function DayTicks({
  monthStart, rangeStart, rangeEnd, pxPerDay,
}: {
  monthStart: Date; rangeStart: Date; rangeEnd: Date; pxPerDay: number;
}) {
  const monthEnd = endOfMonth(monthStart);
  const firstDay = maxDate([monthStart, rangeStart]);
  const lastDay = minDate([monthEnd, rangeEnd]);
  const days: Date[] = [];
  for (let d = firstDay; d <= lastDay; d = addDays(d, 1)) {
    days.push(d);
  }
  return (
    <div className="absolute bottom-0 left-0 right-0 flex">
      {days.map((d) => (
        <div
          key={d.toISOString()}
          className={`text-[9px] tabular-nums text-text-light text-center border-l border-border-soft/40 ${
            d.getDay() === 0 || d.getDay() === 6 ? "text-red/40" : ""
          }`}
          style={{ width: pxPerDay }}
        >
          {d.getDate()}
        </div>
      ))}
    </div>
  );
});

// =========================================================================
// Project row (global view)
// =========================================================================

function ProjectRow({
  data, rangeStart, pxPerDay, totalWidth, onProjectClick, onPhaseClick,
}: {
  data: TimelineProject;
  rangeStart: Date;
  pxPerDay: number;
  totalWidth: number;
  onProjectClick: () => void;
  onPhaseClick: () => void;
}) {
  const p = data;
  const ps = p.start_date ? parseISO(p.start_date) : null;
  const pe = p.deadline ? parseISO(p.deadline) : null;

  return (
    <div className="flex border-b border-border-soft hover:bg-bg-hover/40 transition-colors" style={{ height: ROW_HEIGHT_GLOBAL }}>
      {/* Left panel */}
      <div
        className="sticky left-0 z-10 bg-bg border-r border-border-soft px-4 py-2.5 flex flex-col justify-center"
        style={{ width: LEFT_PANEL_WIDTH, minWidth: LEFT_PANEL_WIDTH }}
      >
        <button onClick={onProjectClick} className="text-left min-w-0 group">
          <div className="flex items-center gap-1.5 mb-0.5 min-w-0">
            {p.rpo_number && (
              <span className="font-mono text-[10px] font-bold text-primary shrink-0">{p.rpo_number}</span>
            )}
            <span className="text-[12.5px] font-semibold text-text truncate group-hover:text-primary transition-colors">{p.name}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-bg-ctrl rounded-full h-1 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-primary to-primary-hover"
                style={{ width: `${Math.min(p.progress, 100)}%` }}
              />
            </div>
            <span className="text-[10.5px] text-text-muted tabular-nums shrink-0">{p.progress}%</span>
          </div>
        </button>
      </div>

      {/* Timeline bars */}
      <div className="relative" style={{ width: totalWidth }}>
        {/* Project bar */}
        {ps && pe && (
          <ProjectBar
            project={p}
            start={ps}
            end={pe}
            rangeStart={rangeStart}
            pxPerDay={pxPerDay}
            onClick={onProjectClick}
          />
        )}
        {/* Phase markers (small) */}
        {data.phases.map((ph) => {
          if (!ph.start_date || !ph.deadline) return null;
          const phs = parseISO(ph.start_date);
          const phe = parseISO(ph.deadline);
          return (
            <PhaseMarker
              key={ph.id}
              phaseName={ph.name}
              start={phs}
              end={phe}
              rangeStart={rangeStart}
              pxPerDay={pxPerDay}
              onClick={onPhaseClick}
            />
          );
        })}
      </div>
    </div>
  );
}

// =========================================================================
// Phase row (detail view — single project)
// =========================================================================

function PhaseRow({
  data, rangeStart, pxPerDay, totalWidth, onTaskClick,
}: {
  data: PhaseRowData;
  rangeStart: Date;
  pxPerDay: number;
  totalWidth: number;
  onTaskClick: (t: Task) => void;
}) {
  const ph = data.phase;
  const phs = ph.start_date ? parseISO(ph.start_date) : null;
  const phe = ph.deadline ? parseISO(ph.deadline) : null;

  // Derive phase span from tasks if not set explicitly
  let phaseStart = phs;
  let phaseEnd = phe;
  if ((!phaseStart || !phaseEnd) && data.tasks.length > 0) {
    const taskEnds = data.tasks.filter((t) => t.deadline).map((t) => parseISO(t.deadline!));
    const taskStarts = data.tasks.filter((t) => t.deadline).map((t) => {
      const e = parseISO(t.deadline!);
      const span = Math.max(t.estimated_days ?? 1, 1);
      return addDays(e, -(span - 1));
    });
    if (taskStarts.length > 0) phaseStart = phaseStart ?? minDate(taskStarts);
    if (taskEnds.length > 0) phaseEnd = phaseEnd ?? maxDate(taskEnds);
  }

  return (
    <div className="flex border-b border-border-soft hover:bg-bg-hover/40 transition-colors" style={{ height: ROW_HEIGHT_DETAIL }}>
      {/* Left panel */}
      <div
        className="sticky left-0 z-10 bg-bg border-r border-border-soft px-4 py-2 flex flex-col justify-center"
        style={{ width: LEFT_PANEL_WIDTH, minWidth: LEFT_PANEL_WIDTH }}
      >
        <div className="flex items-center gap-2 mb-0.5 min-w-0">
          <span className="text-[12.5px] font-semibold text-text truncate">{ph.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-bg-ctrl rounded-full h-1 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-primary/70 to-primary"
              style={{ width: `${Math.min(ph.progress, 100)}%` }}
            />
          </div>
          <span className="text-[10.5px] text-text-muted tabular-nums shrink-0">{ph.progress}%</span>
        </div>
      </div>

      {/* Timeline bars */}
      <div className="relative" style={{ width: totalWidth }}>
        {/* Phase background bar */}
        {phaseStart && phaseEnd && (
          <PhaseBackgroundBar
            start={phaseStart}
            end={phaseEnd}
            rangeStart={rangeStart}
            pxPerDay={pxPerDay}
          />
        )}
        {/* WO bars (from estimasi-deadline range) */}
        {data.tasks.map((t) => {
          if (!t.deadline) return null;
          const end = parseISO(t.deadline);
          const span = Math.max(t.estimated_days ?? 1, 1);
          const start = addDays(end, -(span - 1));
          return (
            <TaskBar
              key={t.id}
              task={t}
              start={start}
              end={end}
              rangeStart={rangeStart}
              pxPerDay={pxPerDay}
              onClick={() => onTaskClick(t)}
            />
          );
        })}
      </div>
    </div>
  );
}

// =========================================================================
// Bar primitives
//
// All four primitives guard against inverted dates (end < start) by
// returning null — silently rendering a tiny mis-placed bar is worse than
// showing nothing when the admin has accidentally swapped dates.
// =========================================================================

function ProjectBar({
  project, start, end, rangeStart, pxPerDay, onClick,
}: {
  project: Project;
  start: Date; end: Date;
  rangeStart: Date; pxPerDay: number;
  onClick: () => void;
}) {
  if (end < start) return null;
  const offset = differenceInCalendarDays(start, rangeStart);
  const days = differenceInCalendarDays(end, start) + 1;
  const left = offset * pxPerDay;
  const width = Math.max(days * pxPerDay, 8);

  const c = PROJECT_BAR_COLORS[project.status] ?? PROJECT_BAR_COLORS.planning;
  const labelText = `${project.rpo_number ? project.rpo_number + " · " : ""}${project.name}`;
  const aria = `${labelText}, ${format(start, "d MMM yyyy", { locale: idLocale })} sampai ${format(end, "d MMM yyyy", { locale: idLocale })}, ${project.progress}% selesai`;

  return (
    <button
      onClick={onClick}
      aria-label={aria}
      className={`absolute ${c.bg} ${c.border} rounded-[var(--r-sm)] border shadow-[var(--shadow-xs)] hover:shadow-[var(--shadow-sm)] hover:brightness-110 transition-all overflow-hidden text-left`}
      style={{
        left, width,
        top: 8,
        height: PROJECT_BAR_HEIGHT,
      }}
      title={`${labelText}\n${format(start, "d MMM yyyy", { locale: idLocale })} – ${format(end, "d MMM yyyy", { locale: idLocale })}\n${project.progress}% selesai`}
    >
      {/* Progress fill — solid stripe overlaid on translucent base */}
      <div
        className={`absolute inset-y-0 left-0 ${c.solid} opacity-90`}
        style={{ width: `${Math.min(project.progress, 100)}%` }}
      />
      <div className="absolute inset-0 flex items-center px-2">
        <span className="text-[10.5px] font-bold text-white truncate">{labelText}</span>
      </div>
    </button>
  );
}

function PhaseMarker({
  phaseName, start, end, rangeStart, pxPerDay, onClick,
}: {
  phaseName: string;
  start: Date; end: Date;
  rangeStart: Date; pxPerDay: number;
  onClick: () => void;
}) {
  if (end < start) return null;
  const offset = differenceInCalendarDays(start, rangeStart);
  const days = differenceInCalendarDays(end, start) + 1;
  const left = offset * pxPerDay;
  const width = Math.max(days * pxPerDay, 6);
  const aria = `Phase ${phaseName}, ${format(start, "d MMM", { locale: idLocale })} sampai ${format(end, "d MMM yyyy", { locale: idLocale })}`;

  return (
    <button
      onClick={onClick}
      aria-label={aria}
      className="absolute bg-text/40 hover:bg-text/60 rounded-sm transition-colors"
      style={{
        left, width,
        top: 8 + PROJECT_BAR_HEIGHT + 4,
        height: 6,
      }}
      title={`Phase: ${phaseName}\n${format(start, "d MMM", { locale: idLocale })} – ${format(end, "d MMM yyyy", { locale: idLocale })}`}
    />
  );
}

function PhaseBackgroundBar({
  start, end, rangeStart, pxPerDay,
}: {
  start: Date; end: Date;
  rangeStart: Date; pxPerDay: number;
}) {
  if (end < start) return null;
  const offset = differenceInCalendarDays(start, rangeStart);
  const days = differenceInCalendarDays(end, start) + 1;
  const left = offset * pxPerDay;
  const width = Math.max(days * pxPerDay, 6);
  return (
    <div
      className="absolute bg-primary/8 border border-primary/15 rounded-[var(--r-sm)]"
      aria-hidden="true"
      style={{
        left, width,
        top: 4,
        bottom: 4,
      }}
    />
  );
}

function TaskBar({
  task, start, end, rangeStart, pxPerDay, onClick,
}: {
  task: Task;
  start: Date; end: Date;
  rangeStart: Date; pxPerDay: number;
  onClick: () => void;
}) {
  if (end < start) return null;
  const offset = differenceInCalendarDays(start, rangeStart);
  const days = differenceInCalendarDays(end, start) + 1;
  const left = offset * pxPerDay;
  const width = Math.max(days * pxPerDay, 6);

  const c = TASK_BAR_COLORS[task.status] ?? TASK_BAR_COLORS.todo;
  const sameDay = isSameMonth(start, end) && start.getDate() === end.getDate();
  const rangeStr = sameDay
    ? format(start, "d MMM yyyy", { locale: idLocale })
    : `${format(start, "d MMM", { locale: idLocale })} – ${format(end, "d MMM yyyy", { locale: idLocale })}`;
  const aria = `WO ${task.name}, ${rangeStr}${task.estimated_days ? `, ${task.estimated_days} hari` : ""}${task.assigned_name ? `, ditugaskan ke ${task.assigned_name}` : ""}, status ${task.status}`;

  return (
    <button
      onClick={onClick}
      aria-label={aria}
      className={`absolute ${c.bg} ${c.border} text-white rounded-[var(--r-sm)] border hover:brightness-110 hover:shadow-[var(--shadow-xs)] transition-all overflow-hidden text-left px-1.5`}
      style={{
        left, width,
        top: 14,
        height: PHASE_BAR_HEIGHT,
      }}
      title={`${task.name}\n${rangeStr}${task.estimated_days ? ` · ${task.estimated_days} hari` : ""}${task.assigned_name ? `\nAssignee: ${task.assigned_name}` : ""}`}
    >
      {width >= 60 && (
        <span className="text-[10px] font-semibold leading-[18px] truncate inline-block w-full">
          {task.name}
        </span>
      )}
    </button>
  );
}
