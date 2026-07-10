"use client";

/** Panel registry — maps panel `type` to its renderer. Add new panel types
 *  here; nothing else in the grid pipeline needs to change. Unknown types
 *  render a friendly placeholder so old clients never crash on newer layouts. */

import { Blocks } from "lucide-react";
import type { Panel, Stream, Tag } from "../types";
import { VideoPanel } from "./video-panel";
import { ChartPanel } from "./chart-panel";
import { TablePanel } from "./table-panel";
import { GaugePanel } from "./gauge-panel";
import { BarPanel } from "./bar-panel";
import { AlarmPanel } from "./alarm-panel";
import { WallPanel } from "./wall-panel";
import { ActivityPanel } from "./activity-panel";
import { WebPanel } from "./web-panel";

/** `opts` carries editing context. `editMode` = the global layout edit-mode
 *  (draft). `canInlineEdit` lets the Video Wall be tweaked anytime via its own
 *  gear (persists straight to the active perspective through onConfigChange). */
export function renderPanel(
  panel: Panel,
  streams: Stream[],
  tags: Tag[],
  opts?: {
    editMode?: boolean;
    canInlineEdit?: boolean;
    onConfigChange?: (config: Panel["config"]) => void;
  }
) {
  switch (panel.type) {
    case "video":
      return (
        <VideoPanel
          stream={streams.find((s) => s.id === panel.config.stream_id)}
          config={panel.config}
        />
      );
    case "wall":
      return (
        <WallPanel
          config={panel.config}
          streams={streams}
          editMode={!!opts?.editMode}
          canInlineEdit={!!opts?.canInlineEdit}
          onConfigChange={opts?.onConfigChange}
        />
      );
    case "chart":
      return <ChartPanel config={panel.config} tags={tags} />;
    case "table":
      return <TablePanel config={panel.config} tags={tags} />;
    case "gauge":
      return <GaugePanel config={panel.config} tags={tags} />;
    case "bar":
      return <BarPanel config={panel.config} tags={tags} />;
    case "alarm":
      return <AlarmPanel config={panel.config} tags={tags} />;
    case "activity":
      return <ActivityPanel />;
    case "web":
      return <WebPanel config={panel.config} />;
    default:
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-bg-sidebar text-text-muted">
          <Blocks className="size-6 opacity-50" />
          <span className="text-[12px]">Panel belum didukung</span>
        </div>
      );
  }
}
