"use client";

/** Web-embed panel (DIRECT variant — Channel-page preview & mobile list).
 *  The page is laid out at the channel's native resolution (view_w×view_h,
 *  like an OBS source) and scaled to fit its container — so what you see here
 *  is pixel-identical to the Monitor wall. The monitor wall itself uses the
 *  keep-alive WebLiveLayer instead (iframes survive page flips).
 *
 *  No fullscreen permission: the embedded site's own fullscreen fills its
 *  viewport (= this panel), never the whole monitor. */

import { useEffect, useRef, useState } from "react";
import { Globe, RefreshCw } from "lucide-react";
import type { WebPanelConfig } from "../types";
import { OrbitFallback } from "./orbit-fallback";

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

export function WebPanel({ config }: { config: WebPanelConfig }) {
  const zoom = clamp(config.zoom ?? 1, 0.25, 3);
  const ox = Math.max(0, config.offset_x ?? 0);
  const oy = Math.max(0, config.offset_y ?? 0);
  const vw = config.view_w ?? 1920;
  const vh = config.view_h ?? 1080;
  const [nonce, setNonce] = useState(0);

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

  const url = /^https?:\/\//i.test(config.url) ? config.url : null;
  if (!url) {
    return <OrbitFallback kind="error" reason="Alamat web tidak valid" />;
  }

  const s = box.w > 0 && box.h > 0 ? Math.min(box.w / vw, box.h / vh) : 0;

  return (
    <div ref={ref} className="group relative h-full w-full overflow-hidden bg-black">
      {/* Blank-page hint — visible only when the site refuses embedding
          (X-Frame-Options) and the frame stays transparent. */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-bg-sidebar text-center text-text-muted">
        <Globe className="size-6 opacity-50" />
        <span className="px-4 text-[11.5px]">
          Kalau area ini tetap kosong, situs tersebut menolak ditampilkan di
          dalam REIN (X-Frame-Options).
        </span>
      </div>

      {s > 0 && (
        <div
          className="absolute overflow-hidden"
          style={{
            left: (box.w - vw * s) / 2,
            top: (box.h - vh * s) / 2,
            width: vw,
            height: vh,
            transform: `scale(${s})`,
            transformOrigin: "top left",
          }}
        >
          <iframe
            key={nonce}
            src={url}
            title={url}
            className="absolute left-0 top-0 border-0"
            style={{
              width: `calc(${100 / zoom}% + ${ox}px)`,
              height: `calc(${100 / zoom}% + ${oy}px)`,
              transform: `scale(${zoom}) translate(-${ox}px, -${oy}px)`,
              transformOrigin: "top left",
            }}
            sandbox="allow-scripts allow-same-origin allow-forms"
            referrerPolicy="no-referrer"
          />
        </div>
      )}

      {/* Reload — appears on hover so it never covers the HMI while watching */}
      <button
        type="button"
        onClick={() => setNonce((n) => n + 1)}
        className="absolute right-2 top-2 z-10 flex size-7 items-center justify-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/75 group-hover:opacity-100"
        title="Muat ulang halaman"
      >
        <RefreshCw className="size-3.5" />
      </button>
    </div>
  );
}
