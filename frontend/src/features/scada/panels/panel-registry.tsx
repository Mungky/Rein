"use client";

/** Panel registry — maps panel `type` to its renderer. Add new panel types
 *  here; nothing else in the grid pipeline needs to change. Unknown types
 *  render a friendly placeholder so old clients never crash on newer layouts. */

import { Blocks, Tv } from "lucide-react";
import type {
  AlarmPanelConfig,
  BarPanelConfig,
  Channel,
  ChannelVideoConfig,
  ChartPanelConfig,
  GaugePanelConfig,
  Panel,
  Stream,
  TablePanelConfig,
  Tag,
  WebPanelConfig,
} from "../types";
import { VideoPanel } from "./video-panel";
import { ChartPanel } from "./chart-panel";
import { TablePanel } from "./table-panel";
import { GaugePanel } from "./gauge-panel";
import { BarPanel } from "./bar-panel";
import { AlarmPanel } from "./alarm-panel";
import { WallPanel } from "./wall-panel";
import { ActivityPanel } from "./activity-panel";
import { WebPanel } from "./web-panel";
import { CroppedVideoPanel } from "./cropped-video-panel";

/** Render a channel's SOURCE (no grid involved) — used by the "channel" panel
 *  case and reusable anywhere a channel preview is needed. */
export function renderChannelContent(
  channel: Channel,
  streams: Stream[],
  tags: Tag[]
) {
  switch (channel.kind) {
    case "video": {
      const cfg = channel.config as ChannelVideoConfig;
      const stream = streams.find((s) => s.id === cfg.stream_id);
      if (cfg.cell !== null && cfg.cell !== undefined) {
        return <CroppedVideoPanel stream={stream} cell={cfg.cell} />;
      }
      return (
        <VideoPanel
          stream={stream}
          config={{ stream_id: cfg.stream_id, object_fit: "contain", muted: true }}
        />
      );
    }
    case "web":
      return <WebPanel config={channel.config as WebPanelConfig} />;
    case "chart":
      return <ChartPanel config={channel.config as ChartPanelConfig} tags={tags} />;
    case "table":
      return <TablePanel config={channel.config as TablePanelConfig} tags={tags} />;
    case "gauge":
      return <GaugePanel config={channel.config as GaugePanelConfig} tags={tags} />;
    case "bar":
      return <BarPanel config={channel.config as BarPanelConfig} tags={tags} />;
    case "alarm":
      return <AlarmPanel config={channel.config as AlarmPanelConfig} tags={tags} />;
    case "activity":
      return <ActivityPanel />;
    default:
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-bg-sidebar text-text-muted">
          <Blocks className="size-6 opacity-50" />
          <span className="text-[12px]">Jenis channel belum didukung</span>
        </div>
      );
  }
}

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
    /** TV-style channel registry — required for "channel" panels. */
    channels?: Channel[];
  }
) {
  switch (panel.type) {
    case "channel": {
      const channel = opts?.channels?.find(
        (c) => c.id === panel.config.channel_id
      );
      if (!channel || !channel.enabled) {
        return (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-bg-sidebar text-text-muted">
            <Tv className="size-6 opacity-50" />
            <span className="text-[12px]">
              {channel ? "Channel dinonaktifkan" : "Channel sudah dihapus"}
            </span>
          </div>
        );
      }
      return renderChannelContent(channel, streams, tags);
    }
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
