"use client";

import { KPI_DATA } from "@/lib/mock/dashboard-data";

export function KPIStrip() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 border border-border rounded-lg overflow-hidden">
      {KPI_DATA.map((kpi) => (
        <div
          key={kpi.label}
          className="relative bg-bg px-5 py-[18px] hover:bg-bg-hover transition-colors duration-140 cursor-default border-r border-border last:border-r-0"
        >
          <div className="flex items-center gap-1.5 mb-2">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: kpi.dotColor }}
            />
            <span className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-text-muted">
              {kpi.label}
            </span>
          </div>
          <div className="text-[26px] font-extrabold tracking-tight text-text leading-none mb-1">
            {kpi.value}
          </div>
          <div className="text-[11.5px] text-text-muted">{kpi.sub}</div>
        </div>
      ))}
    </div>
  );
}