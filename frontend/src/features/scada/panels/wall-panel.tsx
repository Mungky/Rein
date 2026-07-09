"use client";

/** Video Wall — a grid of "channels". One OBS output can be an R×C mosaic of
 *  cameras; each wall cell shows a cropped region of a stream (a channel).
 *
 *  Efficiency: the same mosaic is decoded ONCE (one hidden <video> per distinct
 *  stream) and painted into each cell via <canvas> drawImage — so a 3×3 wall of
 *  one mosaic costs one decode, not nine. Cells from different streams each get
 *  their own decoder. This is the multiviewer technique; no server-side split. */

import { useEffect, useMemo, useRef } from "react";
import { MonitorPlay } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Stream, WallCell, WallPanelConfig } from "../types";
import { useScadaStore } from "../store";
import { channelNumberOf, listChannels } from "../channels";
import { ChannelCombobox } from "../channel-combobox";
import { attachHls, type HlsHandle } from "./hls-attach";

const WALL_SIZES = [1, 2, 3, 4] as const;

export function WallPanel({
  config,
  streams,
  editMode = false,
  onConfigChange,
}: {
  config: WallPanelConfig;
  streams: Stream[];
  editMode?: boolean;
  onConfigChange?: (config: WallPanelConfig) => void;
}) {
  const rows = Math.max(1, Math.min(6, config.rows));
  const cols = Math.max(1, Math.min(6, config.cols));
  const cellCount = rows * cols;

  const cells = useMemo(
    () => Array.from({ length: cellCount }, (_, i) => config.cells[i] ?? null),
    [config.cells, cellCount]
  );
  const streamById = useMemo(
    () => new Map(streams.map((s) => [s.id, s])),
    [streams]
  );
  const reconnectNonce = useScadaStore((s) => s.streamReconnectNonce);

  // Distinct streams actually referenced — one decoder each.
  const distinctIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of cells) if (c && streamById.has(c.stream_id)) ids.add(c.stream_id);
    return [...ids];
  }, [cells, streamById]);

  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);

  // Reattach when the set of streams (or their URL/creds) changes, or when the
  // user hits "Segarkan Stream".
  const attachKey = distinctIds
    .map((id) => {
      const s = streamById.get(id);
      return `${id}:${s?.hls_url}:${s?.read_user}:${s?.read_pass}`;
    })
    .join("|");

  useEffect(() => {
    const handles: HlsHandle[] = [];
    for (const id of distinctIds) {
      const stream = streamById.get(id);
      const video = videoRefs.current.get(id);
      if (stream && video) handles.push(attachHls(video, stream));
    }
    return () => handles.forEach((h) => h.destroy());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachKey, reconnectNonce]);

  // Paint each cell's crop every animation frame (rAF pauses on hidden tabs).
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        const canvas = canvasRefs.current[i];
        if (!cell || !canvas) continue;
        const stream = streamById.get(cell.stream_id);
        const video = videoRefs.current.get(cell.stream_id);
        if (!stream || !video || video.readyState < 2) continue;
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        if (!vw || !vh) continue;
        const cw = canvas.clientWidth;
        const ch = canvas.clientHeight;
        if (cw === 0 || ch === 0) continue;
        if (canvas.width !== cw || canvas.height !== ch) {
          canvas.width = cw;
          canvas.height = ch;
        }
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        const R = Math.max(1, stream.mosaic_rows);
        const C = Math.max(1, stream.mosaic_cols);
        const sw = vw / C;
        const sh = vh / R;
        const sx = (cell.cell % C) * sw;
        const sy = Math.floor(cell.cell / C) * sh;
        // object-fit: cover — scale the source cell to fill, cropping overflow
        const scale = Math.max(cw / sw, ch / sh);
        const dw = sw * scale;
        const dh = sh * scale;
        ctx.drawImage(video, sx, sy, sw, sh, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [cells, streamById]);

  // Edit-mode: channel catalogue + live config mutators (fully controlled —
  // every change flows straight into the draft panel via onConfigChange).
  const channels = useMemo(() => listChannels(streams), [streams]);

  function setSize(n: number) {
    if (!onConfigChange) return;
    const next = Array.from({ length: n * n }, (_, i) => cells[i] ?? null);
    onConfigChange({ rows: n, cols: n, cells: next });
  }

  function setCellChannel(i: number, channelNumber: string) {
    if (!onConfigChange) return;
    const ch =
      channelNumber === ""
        ? null
        : channels.find((c) => c.number === Number(channelNumber));
    const ref: WallCell | null = ch ? { stream_id: ch.stream_id, cell: ch.cell } : null;
    const next = cells.map((c, idx) => (idx === i ? ref : c));
    onConfigChange({ rows, cols, cells: next });
  }

  return (
    <div className="relative h-full w-full bg-black">
      {/* Hidden decoders — one <video> per distinct mosaic stream */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          width: 0,
          height: 0,
          overflow: "hidden",
          opacity: 0,
          pointerEvents: "none",
        }}
      >
        {distinctIds.map((id) => (
          <video
            key={id}
            ref={(el) => {
              if (el) videoRefs.current.set(id, el);
              else videoRefs.current.delete(id);
            }}
            muted
            playsInline
          />
        ))}
      </div>

      {/* Visible grid of channel crops */}
      <div
        className="grid h-full w-full gap-[2px]"
        style={{
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
        }}
      >
        {cells.map((cell, i) => {
          const stream = cell ? streamById.get(cell.stream_id) : undefined;
          return (
            <div key={i} className="relative min-h-0 min-w-0 overflow-hidden bg-black">
              {cell && stream ? (
                <canvas
                  ref={(el) => {
                    canvasRefs.current[i] = el;
                  }}
                  className="block h-full w-full"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-white/20">
                  <MonitorPlay className="size-5" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Edit overlay — change grid size & channels live, no delete/re-add */}
      {editMode && onConfigChange && (
        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col">
          <div className="pointer-events-auto flex items-center gap-1 bg-black/70 px-2 py-1 backdrop-blur-sm">
            <span className="mr-0.5 text-[10px] font-semibold text-white/60">
              Grid
            </span>
            {WALL_SIZES.map((n) => (
              <button
                key={n}
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setSize(n)}
                className={cn(
                  "rounded-[var(--r-xs)] px-1.5 py-0.5 text-[10px] font-semibold",
                  rows === n && cols === n
                    ? "bg-primary text-white"
                    : "cursor-pointer bg-white/10 text-white/70 hover:bg-white/20"
                )}
              >
                {n}×{n}
              </button>
            ))}
            {streams.length === 0 && (
              <span className="ml-1 truncate text-[10px] text-amber-300">
                Belum ada stream — atur di &ldquo;Kelola Stream&rdquo;
              </span>
            )}
          </div>
          <div
            className="grid min-h-0 flex-1 gap-[2px] p-[2px]"
            style={{
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
            }}
          >
            {cells.map((cell, i) => (
              <div key={i} className="pointer-events-auto flex items-start justify-center p-1">
                <ChannelCombobox
                  channels={channels}
                  value={channelNumberOf(streams, cell)}
                  onChange={(n) => setCellChannel(i, n === null ? "" : String(n))}
                  dark
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
