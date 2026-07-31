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
  PanelPlaceholder,
  STATUS_COLOR,
  StatusChip,
  formatValue,
  layoutKindOf,
  layoutMap,
  readTagThresholds,
  resolveDecimals,
  tagStatusOf,
} from "./elements";
import type { Status, TagThresholds } from "./elements";

/** Gauge dulu satu-satunya panel yang punya aturan desimal sendiri. Sekarang
 *  aturannya milik semua panel (formatValue/resolveDecimals di elements.tsx),
 *  dan gauge ikut memakainya — bedanya cuma satu: `decimals` yang kosong kini
 *  jatuh ke setelan sensor sebelum ke otomatis. */
const fmt = formatValue;

/** Zona [f0..f1] (fraksi skala) per status — dari ambang TAG (warn/alarm dua
 *  sisi) yang dipetakan ke skala min–max gauge. Ambang yang null dilewati, jadi
 *  tag yang hanya punya batas atas tetap tergambar benar. */
function zonesFromTag(t: TagThresholds, min: number, max: number) {
  const span = max - min || 1;
  const frac = (v: number) => Math.min(1, Math.max(0, (v - min) / span));
  const cuts = Array.from(
    new Set(
      [t.alarm_min, t.warn_min, t.warn_max, t.alarm_max]
        .filter((v): v is number => v !== null)
        .map(frac)
        .concat([0, 1])
    )
  ).sort((a, b) => a - b);
  const zones: { f0: number; f1: number; status: Status }[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const f0 = cuts[i];
    const f1 = cuts[i + 1];
    if (f1 - f0 <= 0.001) continue;
    // Status di tengah segmen menentukan warna seluruh segmen.
    const mid = min + ((f0 + f1) / 2) * span;
    zones.push({ f0, f1, status: tagStatusOf(mid, t) });
  }
  return zones;
}

export function GaugePanel({ config, tags }: { config: GaugePanelConfig; tags: Tag[] }) {
  const state = useTagValue(config.tag_id ?? null, tags);

  if (!config.tag_id) {
    return (
      <PanelPlaceholder icon={Gauge}>
        Gauge belum diatur — buka mode Atur Layout lalu klik dua kali panel ini
        untuk memilih sensor.
      </PanelPlaceholder>
    );
  }
  if (state.error && !state.loaded) {
    return <PanelPlaceholder>Gagal memuat nilai — mencoba lagi…</PanelPlaceholder>;
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
    return <PanelPlaceholder>Tag tidak ditemukan (mungkin dinonaktifkan).</PanelPlaceholder>;
  }
  if (state.value === null) {
    return <PanelPlaceholder icon={Gauge}>Belum ada data untuk {label}.</PanelPlaceholder>;
  }

  const value = state.value;
  const tag = tags.find((t) => t.id === config.tag_id);
  const thresholds = readTagThresholds(tag?.config);
  const dec = resolveDecimals(config.decimals, tag?.config);
  const status = tagStatusOf(value, thresholds);
  const lastTs = state.valueTs ? new Date(state.valueTs) : null;
  const style = config.style ?? "stat";
  const kind = layoutKindOf("gauge", config) ?? "gauge-stat";
  const el = layoutMap(kind, config.elements, config.layout);
  const device = tag?.device_key ?? "";

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
              zones={zonesFromTag(thresholds, min, max)}
              colorOf={colorOf}
              minText={fmt(min, dec)}
              maxText={fmt(max, dec)}
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
          {fmt(value, dec)}
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
                24 jam: {fmt(state.item.min, dec)}–
                {fmt(state.item.max, dec)}
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

