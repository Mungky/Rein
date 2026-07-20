"use client";

/** Panel registry — maps panel `type` to its renderer. Add new panel types
 *  here; nothing else in the grid pipeline needs to change. Unknown types
 *  render a friendly placeholder so old clients never crash on newer layouts. */

import { Blocks } from "lucide-react";
import type {
  AlarmPanelConfig,
  BarPanelConfig,
  Channel,
  ChartPanelConfig,
  GaugePanelConfig,
  Panel,
  ScreenChannelConfig,
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
import { ActivityPanel } from "./activity-panel";
import { LevelPanel } from "./level-panel";
import { LedPanel } from "./led-panel";
import { ImagePanel } from "./image-panel";
import { WebPanel } from "./web-panel";
import { VncPanel } from "./vnc-panel";
import { CroppedVideoPanel } from "./cropped-video-panel";
import { OrbitFallback } from "./orbit-fallback";
import { WebSlot } from "../web-live-layer";
import { ScreenBox, channelScreen } from "../screen-box";
import { ShapeDecorPanel, TextDecorPanel } from "./decor-panels";

/** True when a channel is a "screen" whose Source is a web page — the only
 *  channels routed through the keep-alive iframe layer (WebLiveLayer) and
 *  eligible for the Interact button. Video/VNC screens are not iframes. */
export function isWebScreenChannel(channel: Channel, streams: Stream[]): boolean {
  if (channel.kind !== "screen") return false;
  const src = streams.find(
    (s) => s.id === (channel.config as ScreenChannelConfig).stream_id
  );
  return src?.source_type === "web";
}

/** Render a channel's SOURCE inside its fixed-resolution ScreenBox — the
 *  channel is a "monitor" (resolusi layar tetap); every placement (Monitor
 *  wall, preview, mobile, maximize) shows the SAME screen, only scaled.
 *  `webLive` routes web channels through the keep-alive layer (monitor wall)
 *  instead of a direct iframe (preview/mobile). */
export function renderChannelContent(
  channel: Channel,
  streams: Stream[],
  tags: Tag[],
  opts?: { webLive?: boolean }
) {
  return (
    <ScreenBox screen={channelScreen(channel)}>
      {renderChannelSource(channel, streams, tags, opts)}
    </ScreenBox>
  );
}

function renderChannelSource(
  channel: Channel,
  streams: Stream[],
  tags: Tag[],
  opts?: { webLive?: boolean }
) {
  switch (channel.kind) {
    case "screen": {
      const cfg = channel.config as ScreenChannelConfig;
      const source = streams.find((s) => s.id === cfg.stream_id);
      if (!source) {
        return (
          <OrbitFallback
            kind="error"
            reason={`CH ${channel.number} — sumber (Screen) tidak ditemukan (sudah dihapus?)`}
          />
        );
      }
      // The SOURCE decides how to render — stream video, web page, or VNC —
      // and the channel's crop is applied on top of whichever it is.
      if (source.source_type === "web") {
        if (!source.url || !/^https?:\/\//i.test(source.url)) {
          return (
            <OrbitFallback
              kind="error"
              reason={`CH ${channel.number} — alamat web sumber tidak valid`}
            />
          );
        }
        const webCfg: WebPanelConfig = {
          url: source.url,
          view_w: cfg.view_w ?? 1920,
          view_h: cfg.view_h ?? 1080,
        };
        if (opts?.webLive)
          return (
            <WebSlot channelId={channel.id} cfg={webCfg} crop={cfg.crop} />
          );
        return <WebPanel config={webCfg} crop={cfg.crop} />;
      }
      if (source.source_type === "vnc") {
        if (!source.url || !/^(https?|wss?):\/\//i.test(source.url)) {
          return (
            <OrbitFallback
              kind="error"
              reason={`CH ${channel.number} — alamat VNC sumber tidak valid`}
            />
          );
        }
        // R-Net owns the RFB connection, always view-only; a flipped-away page
        // reconnects in ~a second on return.
        return (
          <VncPanel
            url={source.url}
            password={source.secret}
            crop={cfg.crop}
            srcW={cfg.src_w}
            srcH={cfg.src_h}
          />
        );
      }
      // stream
      if (cfg.crop) {
        return <CroppedVideoPanel stream={source} cfg={cfg} />;
      }
      return (
        <VideoPanel
          stream={source}
          config={{ stream_id: source.id, object_fit: "contain", muted: true }}
        />
      );
    }
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
    /** Web channels go through the keep-alive iframe layer (monitor wall). */
    webLive?: boolean;
    /** Wall hidden (other tab): pause video decode/bandwidth; web stays alive. */
    videoSuspended?: boolean;
  }
) {
  // Legacy video-ish panels also pause while the wall is hidden.
  if (opts?.videoSuspended && (panel.type === "video" || panel.type === "wall")) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black text-[12px] text-white/40">
        Video dijeda — kembali ke tab Monitor
      </div>
    );
  }
  switch (panel.type) {
    case "channel": {
      const channel = opts?.channels?.find(
        (c) => c.id === panel.config.channel_id
      );
      if (!channel || !channel.enabled) {
        // "Tidak menampilkan apa-apa" → branded maintenance screen
        return (
          <OrbitFallback
            kind="idle"
            reason={channel ? "Channel dinonaktifkan" : "Channel sudah dihapus"}
          />
        );
      }
      if (
        opts?.videoSuspended &&
        channel.kind === "screen" &&
        streams.find((s) => s.id === (channel.config as ScreenChannelConfig).stream_id)
          ?.source_type === "stream"
      ) {
        return (
          <div className="flex h-full w-full items-center justify-center bg-black text-[12px] text-white/40">
            Video dijeda — kembali ke tab Monitor
          </div>
        );
      }
      return renderChannelContent(channel, streams, tags, {
        webLive: opts?.webLive,
      });
    }
    case "video":
      return (
        <VideoPanel
          stream={streams.find((s) => s.id === panel.config.stream_id)}
          config={panel.config}
        />
      );
    case "wall":
      // Legacy (pre-channel era) — superseded by video channels with manual
      // crops; old v1 layouts are "mulai bersih" and never render anyway.
      return (
        <OrbitFallback
          kind="idle"
          reason="Panel lama — buat ulang sebagai channel (crop) di tab Channel"
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
    case "text":
      return <TextDecorPanel config={panel.config} />;
    case "shape":
      return <ShapeDecorPanel config={panel.config} />;
    case "level":
      return <LevelPanel config={panel.config} tags={tags} />;
    case "led":
      return <LedPanel config={panel.config} tags={tags} />;
    case "image":
      return <ImagePanel config={panel.config} />;
    default:
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-bg-sidebar text-text-muted">
          <Blocks className="size-6 opacity-50" />
          <span className="text-[12px]">Panel belum didukung</span>
        </div>
      );
  }
}
