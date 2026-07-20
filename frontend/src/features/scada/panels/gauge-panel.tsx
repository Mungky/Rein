"use client";

/** Gauge panel — one tag, three looks (config.style):
 *  "stat"  angka besar + badge status (tampilan lama, bawaan)
 *  "arc"   gauge jarum 240° dengan zona warna normal/waspada/kritis
 *  "donut" cincin terisi sebanding nilai pada skala min–max
 *  Status uses the reserved REIN status tokens (green/amber/red), never the
 *  chart series palette, and always ships icon + text — never color alone. */

import { format } from "date-fns";
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Gauge,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { GaugePanelConfig, Tag } from "../types";
import { useTagValue } from "./use-tag-value";

type Status = "normal" | "waspada" | "kritis";

function statusOf(value: number, config: GaugePanelConfig): Status {
  const bad = (threshold: number) =>
    config.direction === "above" ? value >= threshold : value <= threshold;
  if (config.critical !== null && bad(config.critical)) return "kritis";
  if (config.warning !== null && bad(config.warning)) return "waspada";
  return "normal";
}

const STATUS_UI: Record<
  Status,
  { label: string; icon: typeof CheckCircle2; text: string; ring: string }
> = {
  normal: {
    label: "Normal",
    icon: CheckCircle2,
    text: "text-green",
    ring: "ring-green/30",
  },
  waspada: {
    label: "Waspada",
    icon: AlertTriangle,
    text: "text-amber",
    ring: "ring-amber/40",
  },
  kritis: {
    label: "Kritis",
    icon: AlertOctagon,
    text: "text-red",
    ring: "ring-red/40",
  },
};

const STATUS_COLOR: Record<Status, string> = {
  normal: "var(--rein-green)",
  waspada: "var(--rein-amber)",
  kritis: "var(--rein-red)",
};

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

  const footer = (
    <span className={cn("text-[10px]", state.stale ? "text-amber" : "text-text-light")}>
      {state.item !== null && state.item.min !== null && state.item.max !== null && (
        <>
          24 jam: {fmt(state.item.min, config.decimals)}–{fmt(state.item.max, config.decimals)}
          {" · "}
        </>
      )}
      {lastTs
        ? state.stale
          ? `Data usang (terakhir ${format(lastTs, "HH:mm")})`
          : `Diperbarui ${format(lastTs, "HH:mm")}`
        : null}
    </span>
  );

  if (style === "arc" || style === "donut") {
    const min = config.min ?? 0;
    const max = config.max ?? 100;
    const span = max - min || 1;
    const f = Math.min(1, Math.max(0, (value - min) / span));
    const normalColor = config.color ?? "var(--rein-green)";
    const colorOf = (s: Status) => (s === "normal" ? normalColor : STATUS_COLOR[s]);
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-bg px-3 py-2 text-center">
        <span className="max-w-full truncate text-[11.5px] font-semibold text-text-muted">
          {label}
        </span>
        <div className="min-h-0 w-full flex-1">
          {style === "arc" ? (
            <ArcGauge
              f={f}
              zones={zonesOf(config, min, max)}
              colorOf={colorOf}
              valueText={fmt(value, config.decimals)}
              unit={unit}
              minText={fmt(min, config.decimals)}
              maxText={fmt(max, config.decimals)}
            />
          ) : (
            <DonutGauge
              f={f}
              color={colorOf(status)}
              valueText={fmt(value, config.decimals)}
              unit={unit}
            />
          )}
        </div>
        <StatusChip status={status} />
        {footer}
      </div>
    );
  }

  // "stat" — tampilan lama: angka besar + badge status
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-bg px-3 py-2 text-center">
      <span className="max-w-full truncate text-[11.5px] font-semibold text-text-muted">
        {label}
      </span>

      <div className="flex items-baseline gap-1.5">
        <span className="text-[clamp(24px,12cqh,44px)] font-bold leading-none tabular-nums text-text">
          {fmt(value, config.decimals)}
        </span>
        {unit && <span className="text-[13px] text-text-muted">{unit}</span>}
      </div>

      <StatusChip status={status} />
      {footer}
    </div>
  );
}

function StatusChip({ status }: { status: Status }) {
  const ui = STATUS_UI[status];
  const StatusIcon = ui.icon;
  return (
    <span
      className={cn(
        "flex items-center gap-1 rounded-[var(--r-pill)] px-2 py-0.5 text-[11px] font-semibold ring-1",
        ui.text,
        ui.ring
      )}
    >
      <StatusIcon className="size-3.5" />
      {ui.label}
    </span>
  );
}

/* ── SVG gauges — viewBox scales with the panel (canvas px) ── */

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
  valueText,
  unit,
  minText,
  maxText,
}: {
  f: number;
  zones: { f0: number; f1: number; status: Status }[];
  colorOf: (s: Status) => string;
  valueText: string;
  unit: string;
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
      {/* Nilai + skala */}
      <text
        x={cx}
        y={cy + 32}
        textAnchor="middle"
        fill="var(--rein-text)"
        fontSize={26}
        fontWeight={700}
        className="tabular-nums"
      >
        {valueText}
        {unit && (
          <tspan fontSize={12} fontWeight={400} fill="var(--rein-text-muted)">
            {" "}{unit}
          </tspan>
        )}
      </text>
      <text x={pMin.x} y={pMin.y + 16} textAnchor="middle" fill="var(--rein-text-light)" fontSize={10}>
        {minText}
      </text>
      <text x={pMax.x} y={pMax.y + 16} textAnchor="middle" fill="var(--rein-text-light)" fontSize={10}>
        {maxText}
      </text>
    </svg>
  );
}

function DonutGauge({
  f,
  color,
  valueText,
  unit,
}: {
  f: number;
  color: string;
  valueText: string;
  unit: string;
}) {
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
      <text
        x={80}
        y={80}
        textAnchor="middle"
        dominantBaseline="central"
        fill="var(--rein-text)"
        fontSize={28}
        fontWeight={700}
        className="tabular-nums"
      >
        {valueText}
      </text>
      {unit && (
        <text
          x={80}
          y={104}
          textAnchor="middle"
          fill="var(--rein-text-muted)"
          fontSize={12}
        >
          {unit}
        </text>
      )}
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
