"use client";

import { ACTIVITY_DATA } from "@/lib/mock/dashboard-data";
import { Badge } from "@/components/ui/badge";

export function ActivityFeed() {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border-soft bg-bg-ctrl">
        <span className="text-[10.5px] font-bold uppercase tracking-[0.05em] text-text-light flex-1">
          Deskripsi
        </span>
        <span className="text-[10.5px] font-bold uppercase tracking-[0.05em] text-text-light w-[52px] text-right">
          Waktu
        </span>
      </div>
      <div className="overflow-y-auto flex-1">
        {ACTIVITY_DATA.map((activity) => (
          <div
            key={activity.id}
            className="flex items-start gap-3 px-4 py-2.5 border-b border-border-soft hover:bg-bg-hover transition-colors duration-140 cursor-pointer"
          >
            <div
              className="w-2 h-2 rounded-full mt-1.5 shrink-0"
              style={{ backgroundColor: activity.color }}
            />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium text-text truncate">
                {activity.title}
              </div>
              <div className="text-[11.5px] text-text-muted truncate">
                {activity.meta}
              </div>
            </div>
            <Badge
              variant="outline"
              className={`text-[11px] font-semibold shrink-0 ${activity.badgeType}`}
            >
              {activity.badge}
            </Badge>
            <div className="text-[11px] text-text-light shrink-0">
              {activity.time}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}