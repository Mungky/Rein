"use client";

/** Grafik satu sensor untuk baris detail tab Data — bisa ditunjuk.
 *
 *  KENAPA ADA, PADAHAL SUDAH ADA TagSparkline
 *      TagSparkline itu SVG buatan tangan yang dirancang sebagai tanda status
 *      sekilas 120x28 px di dalam sel tabel: satu garis, satu gradien, tanpa
 *      sumbu, tanpa interaksi apa pun. Memakainya lagi sebagai grafik besar
 *      720x110 di dropdown adalah kekeliruan yang membuat grafik terbesar di
 *      halaman itu satu-satunya yang tidak bisa dibaca angkanya — sementara
 *      grafik di Monitor sudah bisa sejak awal.
 *
 *      Sekarang: Recharts, sama seperti Monitor, dengan gaya tooltip yang
 *      diimpor dari sana (chartTooltipProps) supaya keduanya tidak menyimpang.
 *      TagSparkline tetap dipakai untuk tanda kecil di dalam baris tabel — di
 *      ukuran itu Recharts hanya memberatkan tanpa memberi apa pun.
 *
 *  KENAPA BUKAN ChartPanel LANGSUNG
 *      ChartPanel mengambil datanya sendiri dari config.tag_ids + config.range.
 *      Baris detail sudah punya loadRange() sendiri plus penyambungan ekor live
 *      (withLiveTail) — memakai ChartPanel berarti dua permintaan /history untuk
 *      satu grafik, dan ekor live-nya hilang. Jadi komponen ini presentasional
 *      murni: datanya datang dari induknya.
 *
 *  WARNA = STATUS, BUKAN IDENTITAS
 *      Monitor mewarnai per seri (identitas). Di sini selalu satu sensor, jadi
 *      warnanya dipakai untuk hal yang lebih berguna: status alarm sensor itu,
 *      memakai peta warna yang sama dengan sparkline-nya. */

import { useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format } from "date-fns";
import { chartTooltipProps } from "../panels/chart-panel";
import { formatValue } from "../panels/elements";
import { STATUS_COLOR, type SparkStatus } from "./tag-sparkline";
import type { RecentSample } from "../types";

/** Satu titik grafik. `band` hanya ada kalau /history memberi min/maks. */
export interface ChartPoint {
  ts: string;
  value: number;
  min?: number;
  max?: number;
}

function shortTime(t: number): string {
  return format(t, "HH:mm");
}

export function TagChart({
  points,
  status,
  unit,
  decimals = null,
  pending = false,
  height = 180,
}: {
  /** Menaik menurut waktu. */
  points: ChartPoint[] | RecentSample[];
  status: SparkStatus;
  unit?: string;
  /** Angka di belakang koma sensor ini; null = otomatis. */
  decimals?: number | null;
  /** Jendela yang diminta belum tiba dari server — gambar kosong yang diam,
   *  bukan beberapa titik live yang akan tampil sebagai pegunungan liar lalu
   *  berganti drastis begitu data sungguhan datang. */
  pending?: boolean;
  height?: number;
}) {
  const color = STATUS_COLOR[status];

  const rows = useMemo(
    () =>
      points.map((p) => {
        const q = p as ChartPoint;
        return {
          t: new Date(q.ts).getTime(),
          nilai: q.value,
          // Recharts menggambar Area rentang dari pasangan [bawah, atas].
          band:
            q.min !== undefined && q.max !== undefined
              ? ([q.min, q.max] as [number, number])
              : undefined,
        };
      }),
    [points]
  );

  const hasBand = rows.some((r) => r.band !== undefined);
  const label = unit ? `Nilai (${unit})` : "Nilai";

  if (pending || rows.length < 2) {
    return (
      <div
        className="flex items-center justify-center rounded-[var(--r)] border border-dashed border-border-soft text-[11px] text-text-light"
        style={{ height }}
      >
        {pending ? "Memuat…" : "Belum cukup data untuk digambar"}
      </div>
    );
  }

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--rein-border-soft)" />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={shortTime}
            tick={{ fontSize: 10, fill: "var(--rein-text-light)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--rein-border)" }}
            minTickGap={40}
          />
          <YAxis
            width={44}
            domain={["auto", "auto"]}
            tick={{ fontSize: 10, fill: "var(--rein-text-light)" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => formatValue(v, decimals)}
          />
          <Tooltip
            {...chartTooltipProps}
            formatter={(value, name) => {
              if (name === "band" && Array.isArray(value)) {
                return [
                  `${formatValue(Number(value[0]), decimals)} – ${formatValue(
                    Number(value[1]),
                    decimals
                  )}`,
                  "Min–Maks",
                ];
              }
              return [
                typeof value === "number" ? formatValue(value, decimals) : String(value),
                label,
              ];
            }}
          />
          {/* Pita min/maks per bucket. Datanya sudah ikut di /history dan
              selama ini dibuang. Untuk lajur ringkasan 1 menit, pita inilah
              yang membuat "rata-rata" berarti sesuatu — tanpa itu, satu menit
              yang tenang dan satu menit yang berayun liar tampak identik. */}
          {hasBand && (
            <Area
              dataKey="band"
              stroke="none"
              fill={color}
              fillOpacity={0.14}
              isAnimationActive={false}
              connectNulls
            />
          )}
          <Line
            dataKey="nilai"
            type="monotone"
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
