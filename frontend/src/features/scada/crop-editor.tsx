"use client";

/** Visual crop editor for a "screen" channel — draw the crop rectangle straight
 *  on the LIVE source: drag to move, corner to resize, numeric boxes for
 *  precision, and quick-grid buttons (2×2/3×3/4×4 → click a cell) for the
 *  "1 OBS mosaic → N channels" workflow. Works for all three source types:
 *    stream → live video (shared decoder pool, source res auto-detected)
 *    web    → the live page laid out at the channel resolution
 *    vnc    → the live remote screen (framebuffer res auto-detected)
 *  The crop rectangle + numeric UI is identical across all three; only the
 *  backdrop differs. */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CropRect, Stream } from "./types";
import { useScadaStore } from "./store";
import { acquireStreamVideo } from "./stream-pool";
import { VncPanel } from "./panels/vnc-panel";
import { WEB_SANDBOX } from "./panels/web-panel";

const GRID_CHOICES = [
  { label: "2×2", r: 2, c: 2 },
  { label: "3×3", r: 3, c: 3 },
  { label: "4×4", r: 4, c: 4 },
] as const;

export function CropEditor({
  source,
  crop,
  viewW,
  viewH,
  onChange,
}: {
  source: Stream;
  crop: CropRect | null;
  /** Channel screen resolution — the reference space for web crops and the
   *  fallback for vnc until the framebuffer size is known. */
  viewW: number;
  viewH: number;
  /** Fired with the crop (null = whole frame) + detected source resolution. */
  onChange: (crop: CropRect | null, srcW: number, srcH: number) => void;
}) {
  const reconnectNonce = useScadaStore((s) => s.streamReconnectNonce);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  // Detected source resolution (stream: from the video; vnc: from the RFB
  // framebuffer). Web needs no detection — its reference space IS the channel
  // screen (viewW×viewH), derived below without state.
  const [detected, setDetected] = useState<{ w: number; h: number } | null>(null);
  const [grid, setGrid] = useState<{ r: number; c: number } | null>(null);
  const [boxW, setBoxW] = useState(0);

  const isStream = source.source_type === "stream";
  const isWeb = source.source_type === "web";
  const isVnc = source.source_type === "vnc";

  const dims = isWeb ? { w: viewW, h: viewH } : detected;

  const onVncResolution = useCallback((w: number, h: number) => {
    setDetected((d) => (d && d.w === w && d.h === h ? d : { w, h }));
  }, []);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setBoxW(r.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Stream backdrop: shared decoder + live canvas paint + res detect ──
  useEffect(() => {
    if (!isStream) return;
    const { video, release } = acquireStreamVideo(source, reconnectNonce);
    videoRef.current = video;
    return () => {
      videoRef.current = null;
      release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStream, source.id, source.hls_url, source.read_user, source.read_pass, reconnectNonce]);

  useEffect(() => {
    if (!isStream) return;
    let raf = 0;
    const draw = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && video.readyState >= 2 && video.videoWidth) {
        setDetected((d) =>
          d && d.w === video.videoWidth && d.h === video.videoHeight
            ? d
            : { w: video.videoWidth, h: video.videoHeight }
        );
        if (canvas) {
          const dpr = Math.min(window.devicePixelRatio || 1, 3);
          const cw = Math.round(canvas.clientWidth * dpr);
          const ch = Math.round(canvas.clientHeight * dpr);
          if (cw && ch) {
            if (canvas.width !== cw || canvas.height !== ch) {
              canvas.width = cw;
              canvas.height = ch;
            }
            const ctx = canvas.getContext("2d");
            if (ctx) {
              ctx.imageSmoothingEnabled = true;
              ctx.imageSmoothingQuality = "high";
              ctx.drawImage(video, 0, 0, cw, ch);
            }
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [isStream]);

  // ── Pointer interactions (display px ↔ source px) ──
  function startDrag(e: React.PointerEvent, mode: "move" | "resize") {
    if (!crop || !dims || !boxRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const factor = dims.w / boxRef.current.clientWidth; // display → source
    const startX = e.clientX;
    const startY = e.clientY;
    const orig = { ...crop };
    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) * factor;
      const dy = (ev.clientY - startY) * factor;
      let next: CropRect;
      if (mode === "move") {
        next = {
          ...orig,
          x: Math.round(Math.min(Math.max(0, orig.x + dx), dims.w - orig.w)),
          y: Math.round(Math.min(Math.max(0, orig.y + dy), dims.h - orig.h)),
        };
      } else {
        next = {
          ...orig,
          w: Math.round(Math.min(Math.max(16, orig.w + dx), dims.w - orig.x)),
          h: Math.round(Math.min(Math.max(16, orig.h + dy), dims.h - orig.y)),
        };
      }
      onChange(next, dims.w, dims.h);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const disp = dims && boxW > 0 ? boxW / dims.w : 0;

  function setField(k: keyof CropRect, v: number) {
    if (!dims) return;
    const base: CropRect = crop ?? { x: 0, y: 0, w: dims.w, h: dims.h };
    onChange({ ...base, [k]: Math.max(0, Math.round(v || 0)) }, dims.w, dims.h);
  }

  const label = isStream ? "Crop Stream" : isWeb ? "Crop Halaman" : "Crop Layar VNC";

  return (
    <div className="rounded-[var(--r)] border border-border-soft bg-bg p-3">
      <div className="text-[12px] font-semibold text-text mb-0.5">{label}</div>
      <p className="text-[11px] text-text-light mb-2">
        Gambar kotak di atas tampilan: geser untuk memindah, tarik sudut
        kanan-bawah untuk ukuran. Atau klik &ldquo;Bagi&rdquo; lalu pilih
        kotaknya — satu sumber bisa jadi banyak channel.
      </p>

      {/* Live source + crop overlay */}
      <div
        ref={boxRef}
        className="relative w-full overflow-hidden rounded-[var(--r-sm)] bg-black"
        style={{ aspectRatio: dims ? `${dims.w} / ${dims.h}` : "16 / 9" }}
      >
        {isStream && <canvas ref={canvasRef} className="block h-full w-full" />}
        {isWeb && source.url && (
          <iframe
            src={source.url}
            title={source.url}
            className="pointer-events-none absolute inset-0 h-full w-full border-0"
            sandbox={WEB_SANDBOX}
            referrerPolicy="strict-origin-when-cross-origin"
          />
        )}
        {isVnc && source.url && (
          <div className="pointer-events-none absolute inset-0">
            <VncPanel
              url={source.url}
              password={source.secret}
              onResolution={onVncResolution}
            />
          </div>
        )}
        {!dims && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-[11.5px] text-white/60">
            <Loader2 className="size-4 animate-spin" /> Menunggu sinyal sumber…
          </div>
        )}

        {/* Quick-grid picker overlay */}
        {grid && dims && (
          <div
            className="absolute inset-0 grid"
            style={{
              gridTemplateColumns: `repeat(${grid.c}, 1fr)`,
              gridTemplateRows: `repeat(${grid.r}, 1fr)`,
            }}
          >
            {Array.from({ length: grid.r * grid.c }).map((_, i) => (
              <button
                key={i}
                type="button"
                className="border border-white/40 bg-transparent text-[11px] font-bold text-white/70 hover:bg-primary/40"
                onClick={() => {
                  const cw = dims.w / grid.c;
                  const chh = dims.h / grid.r;
                  onChange(
                    {
                      x: Math.round((i % grid.c) * cw),
                      y: Math.round(Math.floor(i / grid.c) * chh),
                      w: Math.round(cw),
                      h: Math.round(chh),
                    },
                    dims.w,
                    dims.h
                  );
                  setGrid(null);
                }}
              >
                {i + 1}
              </button>
            ))}
          </div>
        )}

        {/* Crop rectangle (dark mask outside via giant shadow) */}
        {crop && dims && disp > 0 && !grid && (
          <div
            className="absolute cursor-move ring-2 ring-primary"
            style={{
              left: crop.x * disp,
              top: crop.y * disp,
              width: crop.w * disp,
              height: crop.h * disp,
              boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
            }}
            onPointerDown={(e) => startDrag(e, "move")}
          >
            <span
              className="absolute -bottom-1 -right-1 size-3 rounded-[2px] border border-white bg-primary"
              style={{ cursor: "nwse-resize" }}
              onPointerDown={(e) => startDrag(e, "resize")}
            />
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => dims && onChange(null, dims.w, dims.h)}
          className={cn(
            "rounded-[var(--r)] border px-2 py-1 text-[11px] font-semibold",
            crop === null
              ? "border-primary bg-primary/5 text-text"
              : "border-border-soft text-text-muted cursor-pointer hover:border-border"
          )}
        >
          Utuh
        </button>
        {GRID_CHOICES.map((g) => (
          <button
            key={g.label}
            type="button"
            disabled={!dims}
            onClick={() => setGrid(grid?.r === g.r && grid?.c === g.c ? null : g)}
            className={cn(
              "rounded-[var(--r)] border px-2 py-1 text-[11px] font-semibold",
              grid?.r === g.r && grid?.c === g.c
                ? "border-primary bg-primary/5 text-text"
                : "border-border-soft text-text-muted cursor-pointer hover:border-border disabled:opacity-40"
            )}
          >
            Bagi {g.label}
          </button>
        ))}
        {dims && (
          <span className="ml-auto text-[10.5px] text-text-light">
            Sumber: {dims.w}×{dims.h}
          </span>
        )}
      </div>

      {crop && (
        <div className="mt-2 grid grid-cols-4 gap-2">
          {(["x", "y", "w", "h"] as const).map((k) => (
            <div key={k}>
              <label className="text-[10.5px] font-semibold uppercase text-text-muted mb-0.5 block">
                {k}
              </label>
              <input
                type="number"
                className="field-input"
                value={Math.round(crop[k])}
                onChange={(e) => setField(k, Number(e.target.value))}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
