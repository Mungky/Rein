"use client";

/** Status sparkline for one tag — the last ≤100 samples as a thin line with
 *  a soft gradient area underneath (stock-chart look; no glow/drop-shadow —
 *  user: garis ketebalan 1.5px, glow dihapus). Color is a STATUS encoding
 *  (reserved status tokens, theme-aware), never a series identity:
 *    hijau  = normal
 *    merah  = nilai terkini menembus batas atas (alarm_max)
 *    kuning = nilai terkini di bawah batas bawah (alarm_min)
 *    abu    = sensor offline (tidak ada data baru)
 *  Color is never the only signal: the Online column + alarm badges carry the
 *  same state in text, and the row's dropdown holds the full data table. */

import { useId, useMemo } from "react";
import { cn } from "@/lib/utils";
import type { RecentSample } from "../types";

export type SparkStatus = "normal" | "high" | "low" | "offline";

const COLOR: Record<SparkStatus, string> = {
  normal: "var(--rein-green)",
  high: "var(--rein-red)",
  low: "var(--rein-amber)",
  offline: "var(--rein-text-light, #9ca3af)",
};

export function TagSparkline({
  samples,
  status,
  pending = false,
  width = 120,
  height = 28,
  className,
}: {
  /** Ascending by time; at most ~100 points. */
  samples: RecentSample[];
  status: SparkStatus;
  /** Jendela waktu yang diminta belum tiba dari server. Selama true, kotak ini
   *  menggambar garis datar diam — BUKAN data live beberapa detik terakhir.
   *  Alasannya: sparkline selalu diregangkan ke min/maks isinya, jadi 2–4 titik
   *  live yang cuma berjarak beberapa detik tampil sebagai pegunungan liar,
   *  lalu berganti drastis begitu data rentang penuh tiba. */
  pending?: boolean;
  width?: number;
  height?: number;
  className?: string;
}) {
  const gradId = useId().replace(/[^a-zA-Z0-9]/g, "");

  const geom = useMemo(() => {
    if (samples.length < 2) return null;
    const values = samples.map((s) => s.value);
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (min === max) {
      // Flat line — center it instead of dividing by zero
      min -= 1;
      max += 1;
    }
    const pad = 3; // keep the 2px stroke + glow inside the box
    const n = samples.length;
    const pts = samples.map((s, i) => {
      const x = pad + (i / (n - 1)) * (width - pad * 2);
      const y = pad + (1 - (s.value - min) / (max - min)) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const firstX = pad.toFixed(1);
    const lastX = (width - pad).toFixed(1);
    return {
      line: pts.join(" "),
      area: `${firstX},${height} ${pts.join(" ")} ${lastX},${height}`,
    };
  }, [samples, width, height]);

  // Placeholder ukurannya IDENTIK dengan grafik jadinya, supaya tinggi baris
  // tidak melompat saat data tiba.
  if (pending || !geom) {
    const label = pending
      ? "memuat…"
      : samples.length === 0
        ? "—"
        : "menunggu data…";
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={pending ? "Memuat grafik" : label}
        className={cn("block", pending && "animate-pulse", className)}
      >
        <line
          x1={3}
          y1={height / 2}
          x2={width - 3}
          y2={height / 2}
          stroke="var(--rein-border)"
          strokeWidth={1}
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
        <text
          x={width / 2}
          y={height / 2 - 3}
          textAnchor="middle"
          fontSize={10.5}
          fill="var(--rein-text-light, #9ca3af)"
        >
          {label}
        </text>
      </svg>
    );
  }

  const color = COLOR[status];
  const dim = status === "offline";

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Grafik ${samples.length} data terakhir`}
      className={cn("block", className)}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={dim ? 0.15 : 0.35} />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Glow area under the line */}
      <polygon points={geom.area} fill={`url(#${gradId})`} />
      <polyline
        points={geom.line}
        fill="none"
        stroke={color}
        strokeWidth={1}
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={dim ? 0.6 : 1}
        vectorEffect="non-scaling-stroke"
      />
      {/* vectorEffect keeps the 1.5px line thin even when the big detail
          chart is stretched to full width */}
    </svg>
  );
}
