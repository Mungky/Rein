"use client";

/** Image/logo panel — gambar pemanis HMI. `src` is a data URI produced by the
 *  palette's import flow (downscaled client-side) or a direct http(s) URL.
 *  Rendered through <img> only — React escapes the attribute and scripts
 *  inside SVG never execute in an <img>. Transparent background so logos
 *  layer cleanly over shapes/text. */

import { ImageIcon } from "lucide-react";
import type { ImagePanelConfig } from "../types";

export function ImagePanel({ config }: { config: ImagePanelConfig }) {
  if (!config.src) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-bg-sidebar px-4 text-center">
        <ImageIcon className="size-6 text-text-light opacity-60" />
        <span className="text-[12px] text-text-muted">
          Belum ada gambar — klik dua kali panel ini (mode Atur Layout) untuk
          mengimpor.
        </span>
      </div>
    );
  }
  return (
    // Dekorasi HMI berukuran kanvas bebas (src = data URI) — next/image tidak
    // menambah apa-apa di sini.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={config.src}
      alt=""
      draggable={false}
      className="h-full w-full select-none"
      style={{
        objectFit: config.fit === "fill" ? "fill" : config.fit,
        opacity: config.opacity ?? 1,
        borderRadius: config.radius ?? 0,
      }}
    />
  );
}
