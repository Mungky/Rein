"use client";

/** Perkakas bersama komponen nilai (gauge / level / LED / bar):
 *  - LAYOUT_PRESETS: kotak bawaan tiap elemen per jenis komponen
 *  - resolveLayout: config.elements + config.layout → daftar elemen siap render
 *  - Status/tagStatusOf/StatusChip: ambang TAG → Normal/Waspada/Kritis (token
 *    REIN, selalu ikon + teks — tidak pernah warna saja)
 *
 *  Semua ukuran teks di sini memakai `em` supaya ikut tinggi kotak elemen
 *  (lihat panels/layout-box.tsx). */

import { AlertOctagon, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { ElementBox, PanelElements, PanelLayout } from "../types";

/* ── Elemen & preset tata letak ── */

export type ElementKey =
  | "title"
  | "value"
  | "status"
  | "device"
  | "footer"
  | "graphic";

/** Jenis tata letak — menentukan elemen apa yang ada & kotak bawaannya. */
export type LayoutKind =
  | "gauge-stat"
  | "gauge-arc"
  | "gauge-donut"
  | "level"
  | "led"
  | "bar";

export interface ElementSpec {
  key: ElementKey;
  /** Nama yang dilihat user di kanvas & daftar centang. */
  label: string;
  box: ElementBox;
  /** Tampil atau tidak sebelum user mengubah apa pun. */
  on: boolean;
}

const LABELS: Record<ElementKey, string> = {
  title: "Judul",
  value: "Nilai",
  status: "Status",
  device: "Perangkat",
  footer: "Info bawah",
  graphic: "Gambar",
};

const spec = (
  key: ElementKey,
  box: ElementBox,
  on = true
): ElementSpec => ({ key, label: LABELS[key], box, on });

/** Kotak bawaan per jenis — dipilih supaya tampilannya sama seperti sebelum
 *  kanvas ada, jadi panel lama tidak berubah rupa. */
export const LAYOUT_PRESETS: Record<LayoutKind, ElementSpec[]> = {
  "gauge-stat": [
    spec("title", { x: 4, y: 6, w: 92, h: 14, align: "center", scale: 0.6 }),
    spec("value", { x: 4, y: 24, w: 92, h: 32, align: "center", scale: 0.95 }),
    spec("status", { x: 20, y: 60, w: 60, h: 13, align: "center", scale: 0.62 }),
    spec("device", { x: 4, y: 75, w: 92, h: 8, align: "center", scale: 0.7 }, false),
    spec("footer", { x: 2, y: 85, w: 96, h: 9, align: "center", scale: 0.62 }),
  ],
  "gauge-arc": [
    spec("title", { x: 4, y: 3, w: 92, h: 11, align: "center", scale: 0.62 }),
    spec("graphic", { x: 6, y: 13, w: 88, h: 52 }),
    spec("value", { x: 22, y: 47, w: 56, h: 15, align: "center", scale: 0.85 }),
    spec("status", { x: 22, y: 68, w: 56, h: 12, align: "center", scale: 0.62 }),
    spec("device", { x: 4, y: 81, w: 92, h: 8, align: "center", scale: 0.68 }, false),
    spec("footer", { x: 2, y: 90, w: 96, h: 8, align: "center", scale: 0.6 }),
  ],
  "gauge-donut": [
    spec("title", { x: 4, y: 3, w: 92, h: 11, align: "center", scale: 0.62 }),
    spec("graphic", { x: 16, y: 13, w: 68, h: 52 }),
    spec("value", { x: 25, y: 30, w: 50, h: 16, align: "center", scale: 0.85 }),
    spec("status", { x: 22, y: 68, w: 56, h: 12, align: "center", scale: 0.62 }),
    spec("device", { x: 4, y: 81, w: 92, h: 8, align: "center", scale: 0.68 }, false),
    spec("footer", { x: 2, y: 90, w: 96, h: 8, align: "center", scale: 0.6 }),
  ],
  level: [
    spec("title", { x: 4, y: 3, w: 92, h: 10, align: "center", scale: 0.62 }),
    spec("graphic", { x: 28, y: 14, w: 44, h: 60 }),
    spec("value", { x: 4, y: 76, w: 92, h: 12, align: "center", scale: 0.8 }),
    spec("device", { x: 4, y: 88, w: 92, h: 6, align: "center", scale: 0.75 }, false),
    spec("footer", { x: 2, y: 93, w: 96, h: 6, align: "center", scale: 0.72 }),
  ],
  led: [
    spec("title", { x: 4, y: 4, w: 92, h: 11, align: "center", scale: 0.62 }),
    spec("graphic", { x: 32, y: 17, w: 36, h: 42 }),
    spec("status", { x: 12, y: 61, w: 76, h: 13, align: "center", scale: 0.75 }),
    spec("value", { x: 4, y: 76, w: 92, h: 9, align: "center", scale: 0.75 }),
    spec("device", { x: 4, y: 85, w: 92, h: 7, align: "center", scale: 0.72 }, false),
    spec("footer", { x: 2, y: 92, w: 96, h: 7, align: "center", scale: 0.7 }),
  ],
  bar: [
    // Judul bawaan MATI: panel bar sejak dulu memakai judul bar panel di luar.
    spec("title", { x: 2, y: 90, w: 96, h: 9, align: "center", scale: 0.65 }, false),
    spec("footer", { x: 2, y: 1.5, w: 96, h: 7, align: "left", scale: 0.72 }),
    spec("graphic", { x: 0, y: 10, w: 100, h: 89 }),
  ],
};

/** Jenis tata letak sebuah panel/komponen. */
export function layoutKindOf(
  type: string,
  config: { style?: string | null } | undefined
): LayoutKind | null {
  switch (type) {
    case "gauge":
      return config?.style === "arc"
        ? "gauge-arc"
        : config?.style === "donut"
          ? "gauge-donut"
          : "gauge-stat";
    case "level":
      return "level";
    case "led":
      return "led";
    case "bar":
      return "bar";
    default:
      return null;
  }
}

export interface ResolvedElement extends ElementSpec {
  visible: boolean;
}

const VISIBILITY_KEY: Record<ElementKey, keyof PanelElements | null> = {
  title: "show_title",
  value: "show_value",
  status: "show_status",
  device: "show_device",
  footer: "show_footer",
  graphic: null, // gambar komponen selalu tampil
};

/** Gabungkan preset + pilihan user jadi daftar elemen siap pakai (urutan
 *  preset dipertahankan supaya urutan render/tumpuk selalu sama). */
export function resolveLayout(
  kind: LayoutKind,
  elements?: PanelElements,
  layout?: PanelLayout
): ResolvedElement[] {
  return LAYOUT_PRESETS[kind].map((s) => {
    const visKey = VISIBILITY_KEY[s.key];
    const chosen = visKey ? elements?.[visKey] : undefined;
    return {
      ...s,
      box: layout?.[s.key] ?? s.box,
      visible: visKey === null ? true : chosen ?? s.on,
    };
  });
}

/** Peta cepat elemen → kotak/visibilitas (untuk renderer panel). */
export function layoutMap(
  kind: LayoutKind,
  elements?: PanelElements,
  layout?: PanelLayout
): Partial<Record<ElementKey, ResolvedElement>> {
  const map: Partial<Record<ElementKey, ResolvedElement>> = {};
  for (const el of resolveLayout(kind, elements, layout)) map[el.key] = el;
  return map;
}

/* ── Status ambang ── */

export type Status = "normal" | "waspada" | "kritis";

/** Ambang status sebuah tag — sumber tunggal, diatur di "Atur Sumber".
 *  Kritis = di luar alarm_min/alarm_max; Waspada = di luar warn_min/warn_max
 *  tapi masih di dalam alarm. Panel gauge/level MEMBACA ini, tidak lagi punya
 *  ambang sendiri (revisi: satu tempat pengaturan alarm). */
export interface TagThresholds {
  warn_min: number | null;
  warn_max: number | null;
  alarm_min: number | null;
  alarm_max: number | null;
}

export function readTagThresholds(
  config: Record<string, unknown> | undefined | null
): TagThresholds {
  const num = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const c = config ?? {};
  return {
    warn_min: num(c.warn_min),
    warn_max: num(c.warn_max),
    alarm_min: num(c.alarm_min),
    alarm_max: num(c.alarm_max),
  };
}

export function tagStatusOf(value: number, t: TagThresholds): Status {
  if (
    (t.alarm_min !== null && value < t.alarm_min) ||
    (t.alarm_max !== null && value > t.alarm_max)
  )
    return "kritis";
  if (
    (t.warn_min !== null && value < t.warn_min) ||
    (t.warn_max !== null && value > t.warn_max)
  )
    return "waspada";
  return "normal";
}

export const STATUS_COLOR: Record<Status, string> = {
  normal: "var(--rein-green)",
  waspada: "var(--rein-amber)",
  kritis: "var(--rein-red)",
};

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

/** Chip status — semua ukuran dalam `em` supaya ikut kotak elemennya. */
export function StatusChip({ status }: { status: Status }) {
  const ui = STATUS_UI[status];
  const StatusIcon = ui.icon;
  return (
    <span
      className={`inline-flex items-center gap-[0.35em] rounded-[var(--r-pill)] px-[0.6em] py-[0.18em] font-semibold ring-1 ${ui.text} ${ui.ring}`}
    >
      <StatusIcon style={{ width: "1.1em", height: "1.1em" }} />
      {ui.label}
    </span>
  );
}
