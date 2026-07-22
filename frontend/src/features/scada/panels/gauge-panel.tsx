"use client";

/** Gauge panel — one tag, three looks (config.style):
 *  "stat"  angka besar + badge status (tampilan lama, bawaan)
 *  "arc"   gauge jarum 240° dengan zona warna normal/waspada/kritis
 *  "donut" cincin terisi sebanding nilai pada skala min–max
 *
 *  Posisi & ukuran tiap bagian (judul, angka, chip status, info) datang dari
 *  kanvas komponen (config.layout) — lihat panels/layout-box.tsx. Status
 *  memakai token status REIN (green/amber/red), tidak pernah palet seri
 *  grafik, dan selalu ikon + teks — bukan warna saja. */

import { format } from "date-fns";
import { Gauge, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GaugePanelConfig, Tag } from "../types";
import { useTagValue } from "./use-tag-value";
import { LayoutItem, LayoutSurface } from "./layout-box";
import {
  STATUS_COLOR,
  StatusChip,
  layoutKindOf,
  layoutMap,
  statusOf,
} from "./elements";
import type { Status } from "./elements";

function fmt(value: number, decimals: number | null | undefined): string {
  return value.toLocaleString(
    "id",
    decimals === null || decimals === undefined
      ? undefined
      : { minimumFractionDigits: decimals, maximumFractionDigits: decimals }
  );
}

/** Zona [f0..f1] (fraksi skala) per status — dihitung dari ambang + arah. */
function zonesOf(config: GaugePanelConfig, min: number, max: number) {
  const span = max - min || 1;
  const frac = (v: number) => Math.min(1, Math.max(0, (v - min) / span));
  const zones: { f0: number; f1: number; status: Status }[] = [];
  const w = config.warning;
  const c = config.critical;
  if (config.direction === "above") {
    const fw = w !== null ? frac(w) : 1;
    const fc = c !== null ? frac(c) : 1;
    if (fw > 0) zones.push({ f0: 0, f1: fw, status: "normal" });
    if (fc > fw) zones.push({ f0: fw, f1: fc, status: "waspada" });
    if (fc < 1) zones.push({ f0: fc, f1: 1, status: "kritis" });
  } else {
    const fc = c !== null ? frac(c) : 0;
    const fw = w !== null ? frac(w) : 0;
    if (fc > 0) zones.push({ f0: 0, f1: fc, status: "kritis" });
    if (fw > fc) zones.push({ f0: fc, f1: fw, status: "waspada" });
    if (fw < 1) zones.push({ f0: fw, f1: 1, status: "normal" });
  }
  return zones.filter((z) => z.f1 - z.f0 > 0.001);
}

export function GaugePanel({ config, tags }: { config: GaugePanelConfig; tags: Tag[] }) {
  const state = useTagValue(config.tag_id ?? null, tags);

  if (!config.tag_id) {
    return (
      <Center icon>
        Gauge belum diatur — buka mode Atur Layout lalu klik dua kali panel ini
        untuk memilih sensor.
      </Center>
    );
  }
  if (state.error && !state.loaded) {
    return <Center>Gagal memuat nilai — mencoba lagi…</Center>;
  }
  if (!state.loaded) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-bg">
        <Loader2 className="size-5 animate-spin text-text-light" />
      </div>
    );
  }

  const label = config.label || state.label;
  const unit = config.unit ?? state.unit;

  if (state.item === null && state.value === null) {
    return <Center>Tag tidak ditemukan (mungkin dinonaktifkan).</Center>;
  }
  if (state.value === null) {
    return <Center icon>Belum ada data untuk {label}.</Center>;
  }

  const value = state.value;
  const status = statusOf(value, config);
  const lastTs = state.valueTs ? new Date(state.valueTs) : null;
  const style = config.style ?? "stat";
  const kind = layoutKindOf("gauge", config) ?? "gauge-stat";
  const el = layoutMap(kind, config.elements, config.layout);
  const device = tags.find((t) => t.id === config.tag_id)?.device_key ?? "";

  const min = config.min ?? 0;
  const max = config.max ?? 100;
  const span = max - min || 1;
  const f = Math.min(1, Math.max(0, (value - min) / span));
  const normalColor = config.color ?? "var(--rein-green)";
  const colorOf = (s: Status) => (s === "normal" ? normalColor : STATUS_COLOR[s]);

  return (
    <LayoutSurface>
      {el.title?.visible && (
        <LayoutItem box={el.title.box} className="font-semibold text-text-muted">
          {label}
        </LayoutItem>
      )}

      {style !== "stat" && el.graphic?.visible && (
        <LayoutItem box={el.graphic.box} text={false}>
          {style === "arc" ? (
            <ArcGauge
              f={f}
              zones={zonesOf(config, min, max)}
              colorOf={colorOf}
              minText={fmt(min, config.decimals)}
              maxText={fmt(max, config.decimals)}
            />
          ) : (
            <DonutGauge f={f} color={colorOf(status)} />
          )}
        </LayoutItem>
      )}

      {el.value?.visible && (
        <LayoutItem
          box={el.value.box}
          className="font-bold tabular-nums text-text"
        >
          {fmt(value, config.decimals)}
          {unit && (
            <span className="ml-[0.25em] text-[0.5em] font-normal text-text-muted">
              {unit}
            </span>
          )}
        </LayoutItem>
      )}

      {el.status?.visible && (
        <LayoutItem box={el.status.box}>
          <StatusChip status={status} />
        </LayoutItem>
      )}

      {el.device?.visible && device && (
        <LayoutItem box={el.device.box} className="font-mono text-text-light">
          {device}
        </LayoutItem>
      )}

      {el.footer?.visible && (
        <LayoutItem
          box={el.footer.box}
          className={cn(state.stale ? "text-amber" : "text-text-light")}
        >
          {state.item !== null &&
            state.item.min !== null &&
            state.item.max !== null && (
              <>
                24 jam: {fmt(state.item.min, config.decimals)}–
                {fmt(state.item.max, config.decimals)}
                {lastTs ? " · " : ""}
              </>
            )}
          {lastTs
            ? state.stale
              ? `Data usang (terakhir ${format(lastTs, "HH:mm")})`
              : `Diperbarui ${format(lastTs, "HH:mm")}`
            : null}
        </LayoutItem>
      )}
    </LayoutSurface>
  );
}

/* ── SVG gauges — mengisi kotak "Gambar" di kanvas, aspek terjaga ── */

const ARC_START = 150; // derajat; sapuan 240° searah jarum jam lewat atas
const ARC_SWEEP = 240;

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r: number, f0: number, f1: number) {
  const a0 = ARC_START + ARC_SWEEP * f0;
  const a1 = ARC_START + ARC_SWEEP * f1;
  const p0 = polar(cx, cy, r, a0);
  const p1 = polar(cx, cy, r, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${p0.x} ${p0.y} A ${r} ${r} 0 ${large} 1 ${p1.x} ${p1.y}`;
}

function ArcGauge({
  f,
  zones,
  colorOf,
  minText,
  maxText,
}: {
  f: number;
  zones: { f0: number; f1: number; status: Status }[];
  colorOf: (s: Status) => string;
  minText: string;
  maxText: string;
}) {
  const cx = 100;
  const cy = 102;
  const r = 76;
  const needle = polar(cx, cy, r - 18, ARC_START + ARC_SWEEP * f);
  const pMin = polar(cx, cy, r, ARC_START);
  const pMax = polar(cx, cy, r, ARC_START + ARC_SWEEP);
  return (
    <svg viewBox="0 0 200 150" className="h-full w-full" preserveAspectRatio="xMidYMid meet">
      {/* Latar skala + zona warna */}
      <path
        d={arcPath(cx, cy, r, 0, 1)}
        fill="none"
        stroke="var(--rein-border-soft)"
        strokeWidth={13}
        strokeLinecap="round"
      />
      {zones.map((z) => (
        <path
          key={`${z.f0}-${z.status}`}
          d={arcPath(cx, cy, r, z.f0, z.f1)}
          fill="none"
          stroke={colorOf(z.status)}
          strokeWidth={13}
          strokeLinecap="butt"
        />
      ))}
      {/* Jarum */}
      <line
        x1={cx}
        y1={cy}
        x2={needle.x}
        y2={needle.y}
        stroke="var(--rein-text)"
        strokeWidth={3.5}
        strokeLinecap="round"
      />
      <circle cx={cx} cy={cy} r={5.5} fill="var(--rein-text)" />
      {/* Skala min/maks (angka nilainya = elemen "Nilai" di kanvas) */}
      <text x={pMin.x} y={pMin.y + 16} textAnchor="middle" fill="var(--rein-text-light)" fontSize={10}>
        {minText}
      </text>
      <text x={pMax.x} y={pMax.y + 16} textAnchor="middle" fill="var(--rein-text-light)" fontSize={10}>
        {maxText}
      </text>
    </svg>
  );
}

function DonutGauge({ f, color }: { f: number; color: string }) {
  const r = 62;
  const C = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 160 160" className="h-full w-full" preserveAspectRatio="xMidYMid meet">
      <circle
        cx={80}
        cy={80}
        r={r}
        fill="none"
        stroke="var(--rein-border-soft)"
        strokeWidth={14}
      />
      <circle
        cx={80}
        cy={80}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={14}
        strokeLinecap="round"
        strokeDasharray={`${C * f} ${C}`}
        transform="rotate(-90 80 80)"
      />
    </svg>
  );
}

function Center({ children, icon = false }: { children: React.ReactNode; icon?: boolean }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-bg px-4 text-center">
      {icon && <Gauge className="size-6 text-text-light opacity-60" />}
      <span className="text-[12px] text-text-muted">{children}</span>
    </div>
  );
}
