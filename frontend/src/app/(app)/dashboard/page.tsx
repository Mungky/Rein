"use client";

import { KPIStrip } from "@/components/dashboard/kpi-strip";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { DocStats } from "@/components/dashboard/doc-stats";
import { Filter, List } from "lucide-react";
import { PageGuard } from "@/components/guards/page-guard";

export default function DashboardPage() {
  return (
    <PageGuard permission="dashboard:view">
    <div className="flex flex-col h-full overflow-hidden">
      {/* Control panel */}
      <div className="flex items-center gap-2 px-5 h-[46px] min-h-[46px] border-b border-border bg-bg shrink-0">
        <span className="text-[15px] font-bold text-text">Dashboard</span>
        <span className="text-[11.5px] text-text-muted ml-0.5">
          Kamis, 8 Mei 2026
        </span>
        <div className="w-px h-[18px] bg-border mx-1 shrink-0" />
        <div className="flex-1" />
        <button className="btn btn-default btn-sm gap-1.5">
          <Filter className="w-3 h-3" /> Filter
        </button>
        <div className="flex gap-0.5 ml-1.5">
          <button className="ctrl-view-btn active" title="List">
            <List className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-4 md:px-[22px] md:py-[22px] flex flex-col gap-5">
          {/* KPI strip */}
          <KPIStrip />

          {/* Main grid */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_284px] gap-[18px]">
            {/* Activity feed */}
            <div className="bg-bg border border-border rounded-lg overflow-hidden flex flex-col">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
                <span className="text-[12.5px] font-bold">Aktivitas Terbaru</span>
                <span className="text-[10px] font-bold px-2 py-[1.5px] rounded-full bg-bg-hover text-text-muted">
                  6
                </span>
                <button className="ml-auto text-text-muted text-[12px] flex items-center gap-1 px-1.5 py-[3px] rounded hover:text-primary hover:bg-primary-bg transition-colors duration-140">
                  Lihat semua →
                </button>
              </div>
              <ActivityFeed />
            </div>

            {/* Right column */}
            <div className="flex flex-col gap-4">
              {/* Quick actions */}
              <div className="bg-bg border border-border rounded-lg overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
                  <span className="text-[12.5px] font-bold">Aksi Cepat</span>
                </div>
                <QuickActions />
              </div>

              {/* Document type stats */}
              <div className="bg-bg border border-border rounded-lg overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
                  <span className="text-[12.5px] font-bold">Dokumen per Tipe</span>
                  <span className="text-[10px] font-bold px-2 py-[1.5px] rounded-full bg-bg-hover text-text-muted">
                    741
                  </span>
                </div>
                <DocStats />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    </PageGuard>
  );
}