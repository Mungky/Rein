"use client";

/** CropFrame — shows a rectangular CROP of a LIVE element (an iframe or a VNC
 *  canvas) letterboxed to fill its container, the same way CroppedVideoPanel
 *  crops a decoded video. The child is laid out at the full source size
 *  (srcW×srcH) and this frame scales + translates it so only `crop` shows.
 *
 *  Cross-origin note: unlike video we can't read these pixels onto a canvas
 *  (browser security), so the crop is done purely with CSS transforms — no
 *  pixel access needed. Pass crop=null to show the whole source (contain). */

import { useEffect, useRef, useState } from "react";
import type { CropRect } from "../types";

export function CropFrame({
  srcW,
  srcH,
  crop,
  children,
}: {
  srcW: number;
  srcH: number;
  crop?: CropRect | null;
  /** Rendered at the FULL source size (width:100%/height:100% of the inner
   *  box); CropFrame handles all scaling/positioning. */
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

  const region =
    crop && crop.w > 0 && crop.h > 0
      ? crop
      : { x: 0, y: 0, w: srcW, h: srcH };

  // Contain the crop region inside the container (letterbox — never stretch).
  const scale =
    box.w > 0 && box.h > 0
      ? Math.min(box.w / region.w, box.h / region.h)
      : 0;
  // Full source rendered at this scale; positioned so the crop region lands in
  // the centered letterbox.
  const innerW = srcW * scale;
  const innerH = srcH * scale;
  const left = (box.w - region.w * scale) / 2 - region.x * scale;
  const top = (box.h - region.h * scale) / 2 - region.y * scale;

  return (
    <div ref={ref} className="relative h-full w-full overflow-hidden bg-black">
      {scale > 0 && (
        <div
          className="absolute"
          style={{ left, top, width: innerW, height: innerH }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
