"use client";

/** One cropped region of a stream — the renderer behind a "video" channel.
 *  Supports the manual free crop (user-drawn rect in source pixels, scaled by
 *  the reference resolution) and the legacy mosaic-cell index. Decoding is
 *  SHARED through the stream pool: nine crops of one OBS mosaic = one decode. */

import { useEffect, useRef } from "react";
import type { ChannelVideoConfig, Stream } from "../types";
import { useScadaStore } from "../store";
import { acquireStreamVideo } from "../stream-pool";
import { OrbitFallback } from "./orbit-fallback";

export function CroppedVideoPanel({
  stream,
  cfg,
}: {
  stream: Stream | undefined;
  cfg: ChannelVideoConfig;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reconnectNonce = useScadaStore((s) => s.streamReconnectNonce);

  useEffect(() => {
    if (!stream) return;
    const { video, release } = acquireStreamVideo(stream, reconnectNonce);
    videoRef.current = video;
    return () => {
      videoRef.current = null;
      release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    stream?.id,
    stream?.hls_url,
    stream?.read_user,
    stream?.read_pass,
    reconnectNonce,
  ]);

  useEffect(() => {
    if (!stream) return;
    let raf = 0;
    const draw = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState >= 2) {
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        // Draw in PHYSICAL pixels: on scaled displays (Windows 125–200%,
        // 4K TVs) a CSS-pixel canvas renders at a fraction of the panel's
        // real resolution and gets stretched → systemic blur.
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        const cw = Math.round(canvas.clientWidth * dpr);
        const ch = Math.round(canvas.clientHeight * dpr);
        if (vw && vh && cw && ch) {
          if (canvas.width !== cw || canvas.height !== ch) {
            canvas.width = cw;
            canvas.height = ch;
          }
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
            // Source region: manual crop (scaled from its reference
            // resolution) > legacy mosaic cell > whole frame.
            let sx = 0;
            let sy = 0;
            let sw = vw;
            let sh = vh;
            if (cfg.crop) {
              const fx = vw / (cfg.src_w ?? vw);
              const fy = vh / (cfg.src_h ?? vh);
              sx = cfg.crop.x * fx;
              sy = cfg.crop.y * fy;
              sw = Math.max(1, cfg.crop.w * fx);
              sh = Math.max(1, cfg.crop.h * fy);
            } else if (cfg.cell !== null && cfg.cell !== undefined) {
              const R = Math.max(1, stream.mosaic_rows);
              const C = Math.max(1, stream.mosaic_cols);
              sw = vw / C;
              sh = vh / R;
              sx = (cfg.cell % C) * sw;
              sy = Math.floor(cfg.cell / C) * sh;
            }
            // contain — show the whole region, letterboxed
            const scale = Math.min(cw / sw, ch / sh);
            const dw = sw * scale;
            const dh = sh * scale;
            ctx.fillStyle = "#000";
            ctx.fillRect(0, 0, cw, ch);
            ctx.drawImage(video, sx, sy, sw, sh, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [stream, cfg.crop, cfg.src_w, cfg.src_h, cfg.cell]);

  if (!stream) {
    return (
      <OrbitFallback kind="error" reason="Sumber stream tidak ditemukan" />
    );
  }

  return (
    <div className="relative h-full w-full bg-black">
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
