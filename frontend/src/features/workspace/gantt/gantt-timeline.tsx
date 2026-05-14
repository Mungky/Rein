import { useMemo } from "react";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale/id";
import type { ZoomLevel, DateRange } from "./utils";
import { getColumnDates, pxPerDay, formatHeader, totalDays } from "./utils";

interface GanttTimelineProps {
  range: DateRange;
  zoom: ZoomLevel;
  scrollRef?: React.RefObject<HTMLDivElement | null>;
}

export function GanttTimeline({ range, zoom, scrollRef }: GanttTimelineProps) {
  const columns = useMemo(() => getColumnDates(range, zoom), [range, zoom]);
  const ppd = pxPerDay(zoom);
  const totalW = totalDays(range) * ppd;

  // Group columns by month for month headers
  const monthGroups = useMemo(() => {
    const groups: { label: string; width: number; offset: number }[] = [];
    let currentMonth = "";
    let groupStart = 0;

    columns.forEach((col, i) => {
      const month = format(col, "MMMM yyyy", { locale: idLocale });
      if (month !== currentMonth) {
        if (currentMonth) {
          groups.push({ label: currentMonth, width: (i - groupStart) * ppd, offset: groupStart * ppd });
        }
        currentMonth = month;
        groupStart = i;
      }
    });
    if (currentMonth) {
      groups.push({ label: currentMonth, width: (columns.length - groupStart) * ppd, offset: groupStart * ppd });
    }
    return groups;
  }, [columns, ppd]);

  return (
    <div className="sticky top-0 z-10 bg-bg border-b border-border" ref={scrollRef}>
      {/* Month row */}
      <div className="relative" style={{ width: totalW, height: 24 }}>
        {monthGroups.map((g, i) => (
          <div
            key={i}
            className="absolute top-0 h-6 flex items-center px-2 text-[10px] font-bold text-text-muted border-r border-border-soft bg-bg"
            style={{ left: g.offset, width: g.width }}
          >
            {g.label}
          </div>
        ))}
      </div>
      {/* Day/week column row */}
      <div className="relative" style={{ width: totalW, height: 22 }}>
        {columns.map((col, i) => (
          <div
            key={i}
            className="absolute top-0 h-full flex items-center justify-center text-[9px] text-text-muted border-r border-border-soft"
            style={{ left: i * ppd, width: ppd }}
          >
            {formatHeader(col, zoom)}
          </div>
        ))}
      </div>
    </div>
  );
}