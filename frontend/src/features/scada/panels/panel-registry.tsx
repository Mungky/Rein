"use client";

/** Panel registry — maps panel `type` to its renderer.
 *  Phase 2+: add "chart" / "table" / "alarm" entries here; nothing else in
 *  the grid pipeline needs to change. Unknown types render a friendly
 *  placeholder so old clients never crash on newer layouts. */

import { Blocks } from "lucide-react";
import type { Panel, Stream } from "../types";
import { VideoPanel } from "./video-panel";

export function renderPanel(panel: Panel, streams: Stream[]) {
  switch (panel.type) {
    case "video":
      return (
        <VideoPanel
          stream={streams.find((s) => s.id === panel.config.stream_id)}
          config={panel.config}
        />
      );
    default:
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-bg-sidebar text-text-muted">
          <Blocks className="size-6 opacity-50" />
          <span className="text-[12px]">Panel belum didukung</span>
        </div>
      );
  }
}
