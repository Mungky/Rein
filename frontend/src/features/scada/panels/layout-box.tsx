"use client";

/** Kanvas komponen — mesin tata letak bebas untuk isi panel.
 *
 *  Setiap elemen (judul, nilai, status, gambar, …) punya kotak dalam PERSEN
 *  dari kotak panel, jadi posisi & ukurannya ikut menskala saat panel
 *  dibesar-kecilkan: tidak ada yang terpotong, dan "angkanya sebesar apa"
 *  ditentukan dari tinggi kotaknya (tinggi huruf = tinggi kotak × scale).
 *
 *  LayoutSurface mengukur dirinya sekali (ResizeObserver) lalu membagikan
 *  tinggi piksel itu ke setiap LayoutItem lewat context. */

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { ElementBox } from "../types";

/** Tinggi surface dalam piksel CSS (0 = belum terukur). */
const SurfaceHeight = createContext(0);

export function LayoutSurface({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setH(r.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn("relative h-full w-full overflow-hidden bg-bg", className)}
    >
      <SurfaceHeight.Provider value={h}>
        {h > 0 && children}
      </SurfaceHeight.Provider>
    </div>
  );
}

const JUSTIFY: Record<NonNullable<ElementBox["align"]>, string> = {
  left: "justify-start text-left",
  center: "justify-center text-center",
  right: "justify-end text-right",
};

/** Satu elemen pada kanvas. Isi teks otomatis seukuran kotaknya; isi grafis
 *  (SVG/div) cukup memenuhi kotak. */
export function LayoutItem({
  box,
  text = true,
  className,
  children,
}: {
  box: ElementBox;
  /** true = isi berupa teks (tinggi huruf ikut kotak, tak boleh membungkus). */
  text?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const surfaceH = useContext(SurfaceHeight);
  const fontSize = text
    ? Math.max(6, (surfaceH * box.h) / 100 * (box.scale ?? 0.7))
    : undefined;
  return (
    <div
      className={cn(
        "absolute flex items-center",
        JUSTIFY[box.align ?? "center"],
        text && "overflow-hidden whitespace-nowrap leading-none",
        className
      )}
      style={{
        left: `${box.x}%`,
        top: `${box.y}%`,
        width: `${box.w}%`,
        height: `${box.h}%`,
        fontSize,
      }}
    >
      {text ? (
        <span className="min-w-0 max-w-full truncate">{children}</span>
      ) : (
        children
      )}
    </div>
  );
}
