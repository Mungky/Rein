"use client";

/** One cropped cell of a mosaic stream — the renderer behind a "video" channel
 *  whose config points at a specific mosaic cell. Same technique as the Video
 *  Wall (decode once, canvas-crop), but for a single cell filling the panel. */

import { useEffect, useRef } from "react";
import { MonitorPlay } from "lucide-react";
import type { Stream } from "../types";
import { useScadaStore } from "../store";
import { attachHls, type HlsHandle } from "./hls-attach";

export function CroppedVideoPanel({
  stream,
  cell,
}: {
  stream: Stream | undefined;
  cell: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reconnectNonce = useScadaStore((s) => s.streamReconnectNonce);

  const attachKey = stream
    ? `${stream.id}:${stream.hls_url}:${stream.read_user}:${stream.read_pass}`
    : "";

  useEffect(() => {
    const video = videoRef.current;
    if (!stream || !video) return;
    const handle: HlsHandle = attachHls(video, stream);
    return () => handle.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachKey, reconnectNonce]);

  useEffect(() => {
    if (!stream) return;
    const R = Math.max(1, stream.mosaic_rows);
    const C = Math.max(1, stream.mosaic_cols);
    let raf = 0;
    const draw = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState >= 2) {
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const cw = canvas.clientWidth;
        const ch = canvas.clientHeight;
        if (vw && vh && cw && ch) {
          if (canvas.width !== cw || canvas.height !== ch) {
            canvas.width = cw;
            canvas.height = ch;
          }
          const ctx = canvas.getContext("2d");
          if (ctx) {
            const sw = vw / C;
            const sh = vh / R;
            const sx = (cell % C) * sw;
            const sy = Math.floor(cell / C) * sh;
            // contain — show the whole camera cell, letterboxed
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
  }, [stream, cell]);

  if (!stream) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-black text-white/40">
        <MonitorPlay className="size-6" />
        <span className="text-[12px]">Stream tidak ditemukan</span>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full bg-black">
      <div
        aria-hidden
        style={{ position: "absolute", width: 0, height: 0, overflow: "hidden", opacity: 0 }}
      >
        <video ref={videoRef} muted playsInline />
      </div>
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
