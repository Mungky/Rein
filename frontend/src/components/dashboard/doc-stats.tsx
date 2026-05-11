"use client";

import { DOC_STATS } from "@/lib/mock/dashboard-data";

export function DocStats() {
  return (
    <div className="p-3 flex flex-col gap-2.5">
      {DOC_STATS.map((stat) => (
        <div key={stat.label}>
          <div className="flex justify-between items-baseline mb-1">
            <span className="text-[11.5px] text-text-muted">{stat.label}</span>
            <span className="text-[12px] font-bold text-text font-mono">
              {stat.count}
            </span>
          </div>
          <div className="h-1 bg-border rounded overflow-hidden">
            <div
              className="h-full rounded bg-primary opacity-65 transition-all duration-700"
              style={{ width: `${stat.pct}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}