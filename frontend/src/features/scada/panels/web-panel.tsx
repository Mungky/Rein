"use client";

/** Web-embed panel — a live web page (e.g. Wecon V-Net HMI) inside the grid.
 *  No OBS/MediaMTX: the viewer's browser loads the page directly, so it's
 *  pixel-sharp, real-time, and needs zero streaming infra. The catch: sites
 *  that send X-Frame-Options/CSP deny cannot be embedded — they render blank,
 *  hence the hint overlay. Each embed costs about as much as a browser tab. */

import { useState } from "react";
import { Globe, RefreshCw } from "lucide-react";
import type { WebPanelConfig } from "../types";

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

export function WebPanel({ config }: { config: WebPanelConfig }) {
  const zoom = clamp(config.zoom ?? 1, 0.25, 3);
  const ox = clamp(config.offset_x ?? 0, 0, 4000);
  const oy = clamp(config.offset_y ?? 0, 0, 4000);
  const [nonce, setNonce] = useState(0);
  const url = /^https?:\/\//i.test(config.url) ? config.url : null;

  if (!url) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-bg-sidebar text-text-muted">
        <Globe className="size-6 opacity-50" />
        <span className="text-[12px]">Alamat web tidak valid</span>
      </div>
    );
  }

  return (
    <div className="group relative h-full w-full overflow-hidden">
      {/* Blank-page hint — bottom layer; the iframe covers it whenever the
          page actually renders. Visible only when the site refuses embedding
          (X-Frame-Options) and the frame stays transparent. */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-bg-sidebar text-center text-text-muted">
        <Globe className="size-6 opacity-50" />
        <span className="px-4 text-[11.5px]">
          Kalau area ini tetap kosong, situs tersebut menolak ditampilkan di
          dalam REIN (X-Frame-Options).
        </span>
      </div>

      <iframe
        key={nonce}
        src={url}
        title={url}
        className="absolute left-0 top-0 border-0"
        style={{
          // Oversize by the offset, then shift pre-scale — offsets crop away
          // the embedded site's own chrome (navbar/sidebar).
          width: `calc(${100 / zoom}% + ${ox}px)`,
          height: `calc(${100 / zoom}% + ${oy}px)`,
          transform: `scale(${zoom}) translate(-${ox}px, -${oy}px)`,
          transformOrigin: "top left",
        }}
        // Enough for a live HMI session (scripts + login cookies + forms),
        // but no popups and no navigating REIN itself away.
        sandbox="allow-scripts allow-same-origin allow-forms"
        referrerPolicy="no-referrer"
        allow="fullscreen"
      />

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
