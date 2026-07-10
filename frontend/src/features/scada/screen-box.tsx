"use client";

/** ScreenBox — renders a channel's "screen" at its EXACT aspect ratio,
 *  letterboxed inside whatever box it's given (like a physical monitor placed
 *  on a shelf: the shelf can be any size, the monitor keeps its shape).
 *  Measures its container so the fit is correct at any size. */

import { useEffect, useRef, useState } from "react";
import type { CanvasSize, Channel } from "./types";

/** "Resolusi Layar" of a channel — every channel is a screen with a fixed
 *  resolution (default 1920×1080); Monitor only scales it, aspect locked. */
export function channelScreen(channel: Channel): CanvasSize {
  const cfg = channel.config as {
    view_w?: number | null;
    view_h?: number | null;
  };
  return { w: cfg.view_w ?? 1920, h: cfg.view_h ?? 1080 };
}

export function channelAspect(channel: Channel): number {
  const s = channelScreen(channel);
  return s.w / Math.max(1, s.h);
}

export function ScreenBox({
  screen,
  children,
}: {
  screen: CanvasSize;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setBox({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale =
    box.w > 0 && box.h > 0 ? Math.min(box.w / screen.w, box.h / screen.h) : 0;
  const w = screen.w * scale;
  const h = screen.h * scale;

  return (
    <div ref={ref} className="relative h-full w-full overflow-hidden bg-black">
      {scale > 0 && (
        <div
          className="absolute overflow-hidden"
          style={{
            left: (box.w - w) / 2,
            top: (box.h - h) / 2,
            width: w,
            height: h,
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
