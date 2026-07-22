"use client";

/** Branded placeholder screens (RePhot orbit animation, served from
 *  /public/orbit): "idle" (maintenance page) when a channel has nothing to
 *  show, "error" (standby page) when something broke — with the cause line.
 *
 *  The orbit pages are designed full-screen 16:9 — rendering them at the
 *  panel's raw shape squishes them ("gepeng"). The iframe is therefore always
 *  letterboxed at 16:9 inside the panel (black bars blend with the page's own
 *  near-black background). Panels too small to read the full page get a
 *  compact inline fallback (logo + status word + reason) instead. */

import { useEffect, useRef, useState } from "react";

/** Below this box size the full orbit page is unreadable → compact mode. */
const COMPACT_W = 260;
const COMPACT_H = 160;

export function OrbitFallback({
  kind,
  reason,
  label,
}: {
  kind: "idle" | "error";
  /** Cause line shown under the status word (error screens should set it). */
  reason?: string;
  /** Override the big status word (default: Maintenance / Standby). */
  label?: string;
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

  const page = kind === "idle" ? "maintenance" : "standby";
  const params = new URLSearchParams();
  if (reason) params.set("reason", reason);
  if (label) params.set("label", label);
  const qs = params.toString();

  const compact = box.w > 0 && (box.w < COMPACT_W || box.h < COMPACT_H);
  // Letterbox 16:9 — the page keeps its designed shape at any panel size.
  const scale = box.w > 0 ? Math.min(box.w / 16, box.h / 9) : 0;
  const w = 16 * scale;
  const h = 9 * scale;

  return (
    <div ref={ref} className="relative h-full w-full overflow-hidden bg-black">
      {scale > 0 &&
        (compact ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-2 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- aset statis lokal */}
            <img
              src="/orbit/RePhot.svg"
              alt=""
              className="size-6 opacity-80"
              aria-hidden
            />
            <span className="text-[11px] font-semibold tracking-wide text-white/90">
              {label ?? (kind === "idle" ? "Maintenance" : "Standby")}
            </span>
            {reason && (
              <span className="line-clamp-2 max-w-full text-[9.5px] leading-tight text-white/45">
                {reason}
              </span>
            )}
          </div>
        ) : (
          <iframe
            src={`/orbit/${page}.html${qs ? `?${qs}` : ""}`}
            title={kind === "idle" ? "Maintenance" : "Standby"}
            className="pointer-events-none absolute border-0 bg-black"
            style={{
              left: (box.w - w) / 2,
              top: (box.h - h) / 2,
              width: w,
              height: h,
            }}
            tabIndex={-1}
            aria-hidden
          />
        ))}
    </div>
  );
}
