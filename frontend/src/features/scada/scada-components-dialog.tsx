"use client";

/** "Komponen SCADA" — dropped onto the layout DRAFT while in Atur Layout.
 *  Langkah awal membangun HMI sendiri: teks custom, bentuk (kotak/lingkaran/
 *  garis), plus komponen data (grafik/gauge/bar/tabel/alarm) langsung dari
 *  sini tanpa lewat tab Data. Panel ditambahkan ke draft — atur posisinya
 *  lalu Simpan seperti biasa. */

import { useMemo, useState } from "react";
import {
  BarChart3,
  Bell,
  Circle,
  Gauge as GaugeIcon,
  Minus,
  Shapes,
  Square,
  Table2,
  TrendingUp,
  Type,
} from "lucide-react";
import { toast } from "sonner";
import { Drawer } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { useScadaStore } from "./store";
import type { CanvasSize, Panel } from "./types";
import { DEFAULT_CANVAS } from "./types";

const SWATCHES = [
  "#ffffff",
  "#0f172a",
  "#64748b",
  "#059669",
  "#d97706",
  "#dc2626",
  "#2a78d6",
];

const TAG_LIMITS = {
  chart: { min: 1, max: 4, label: "Grafik" },
  gauge: { min: 1, max: 1, label: "Gauge" },
  bar: { min: 2, max: 8, label: "Bar" },
  table: { min: 1, max: 8, label: "Tabel" },
  alarm: { min: 1, max: 8, label: "Alarm" },
} as const;

type DataKind = keyof typeof TAG_LIMITS;

function ColorPicker({
  value,
  onChange,
  allowNone,
  noneLabel = "Tanpa",
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  allowNone?: boolean;
  noneLabel?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {allowNone && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className={cn(
            "h-6 rounded-[var(--r-sm)] border px-1.5 text-[10px] font-semibold",
            value === null
              ? "border-primary text-text"
              : "border-border-soft text-text-light cursor-pointer hover:border-border"
          )}
        >
          {noneLabel}
        </button>
      )}
      {SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={cn(
            "size-6 cursor-pointer rounded-[var(--r-sm)] border-2",
            value === c ? "border-primary" : "border-border-soft"
          )}
          style={{ background: c }}
          title={c}
        />
      ))}
      <input
        type="color"
        value={value ?? "#ffffff"}
        onChange={(e) => onChange(e.target.value)}
        className="size-6 cursor-pointer rounded-[var(--r-sm)] border border-border-soft bg-transparent p-0"
        title="Warna lain"
      />
    </div>
  );
}

export function ScadaComponentsDialog({ onClose }: { onClose: () => void }) {
  const store = useScadaStore();
  const canvas: CanvasSize = store.draftCanvas ?? DEFAULT_CANVAS;
  const enabledTags = useMemo(
    () => store.tags.filter((t) => t.enabled),
    [store.tags]
  );

  const [tab, setTab] = useState<"text" | "shape" | "data">("text");

  // Teks
  const [content, setContent] = useState("");
  const [size, setSize] = useState(36);
  const [bold, setBold] = useState(true);
  const [align, setAlign] = useState<"left" | "center" | "right">("center");
  const [textColor, setTextColor] = useState<string | null>(null);

  // Bentuk
  const [shape, setShape] = useState<"rect" | "circle" | "line">("rect");
  const [fill, setFill] = useState<string | null>("#2a78d6");
  const [stroke, setStroke] = useState<string | null>(null);
  const [strokeW, setStrokeW] = useState(2);

  // Data
  const [tagIds, setTagIds] = useState<string[]>([]);

  /** Cascade placement so new components never hide each other. */
  function place(w: number, h: number) {
    const n = (store.draftPanels ?? []).filter((p) => p.rect).length;
    const off = Math.min(32 * n, Math.max(0, canvas.h - h), Math.max(0, canvas.w - w));
    return {
      x: Math.max(0, Math.min(off, canvas.w - w)),
      y: Math.max(0, Math.min(off, canvas.h - h)),
      w: Math.min(w, canvas.w),
      h: Math.min(h, canvas.h),
    };
  }

  function add(panel: Panel) {
    store.addPanel(panel);
    toast.success("Komponen ditambahkan — geser & atur ukurannya, lalu Simpan");
  }

  function addText() {
    if (!content.trim()) return;
    add({
      id: crypto.randomUUID(),
      type: "text",
      title: "",
      rect: place(Math.min(canvas.w, Math.max(200, content.length * size * 0.6)), size * 2.2),
      config: {
        content: content.trim(),
        size,
        color: textColor,
        align,
        bold,
      },
    });
    setContent("");
  }

  function addShape() {
    const rect =
      shape === "line"
        ? place(Math.round(canvas.w / 3), 40)
        : shape === "circle"
          ? place(220, 220)
          : place(320, 200);
    add({
      id: crypto.randomUUID(),
      type: "shape",
      title: "",
      rect,
      config: {
        shape,
        fill: shape === "line" ? null : fill,
        stroke: shape === "line" ? (stroke ?? "#64748b") : stroke,
        stroke_w: strokeW,
        radius: 8,
      },
    });
  }

  function addData(kind: DataKind) {
    const lim = TAG_LIMITS[kind];
    if (tagIds.length < lim.min || tagIds.length > lim.max) return;
    const firstTag = enabledTags.find((t) => t.id === tagIds[0]);
    const rect = place(Math.round(canvas.w / 2), Math.round(canvas.h / 2));
    let panel: Panel;
    if (kind === "gauge") {
      panel = {
        id: crypto.randomUUID(),
        type: "gauge",
        title: firstTag?.label ?? "Gauge",
        rect,
        config: { tag_id: tagIds[0], warning: null, critical: null, direction: "above" },
      };
    } else if (kind === "chart") {
      panel = {
        id: crypto.randomUUID(),
        type: "chart",
        title:
          tagIds.length === 1 && firstTag
            ? `Tren ${firstTag.label}`
            : `Tren Sensor (${tagIds.length} tag)`,
        rect,
        config: { tag_ids: tagIds, range: "24h", show_minmax: tagIds.length === 1 },
      };
    } else if (kind === "bar") {
      panel = {
        id: crypto.randomUUID(),
        type: "bar",
        title: `Perbandingan (${tagIds.length} tag)`,
        rect,
        config: { tag_ids: tagIds, range: "24h", metric: "avg" },
      };
    } else if (kind === "table") {
      panel = {
        id: crypto.randomUUID(),
        type: "table",
        title: "Ringkasan Sensor",
        rect,
        config: { tag_ids: tagIds, range: "24h" },
      };
    } else {
      panel = {
        id: crypto.randomUUID(),
        type: "alarm",
        title: "Alarm",
        rect,
        config: { tag_ids: tagIds, range: "24h" },
      };
    }
    add(panel);
    setTagIds([]);
  }

  function toggleTag(id: string) {
    setTagIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  }

  const label = "text-[12px] font-semibold text-text-muted mb-1.5 block";

  return (
    <Drawer
      title="Komponen SCADA"
      subtitle="Teks, bentuk, dan komponen data untuk membangun tampilan HMI"
      icon={<Shapes className="size-5" />}
      onClose={onClose}
    >
        {/* Tabs */}
        <div className="-mx-5 flex gap-1 border-b border-border-soft px-5">
          {(
            [
              { id: "text", label: "Teks", icon: Type },
              { id: "shape", label: "Bentuk", icon: Square },
              { id: "data", label: "Data Sensor", icon: TrendingUp },
            ] as const
          ).map(({ id, label: l, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "flex items-center gap-1.5 rounded-t-[var(--r)] border border-b-0 px-3 py-1.5 text-[12px] font-semibold",
                tab === id
                  ? "border-border-soft bg-bg text-text"
                  : "border-transparent text-text-muted cursor-pointer hover:text-text"
              )}
            >
              <Icon className="size-3.5" /> {l}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-4 py-4">
          {tab === "text" && (
            <>
              <div>
                <label className={label}>Isi Teks</label>
                <input
                  className="field-input"
                  placeholder="Mis. BOILER 1 — LINE 2"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  maxLength={500}
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={label}>Ukuran</label>
                  <select
                    className="field-select cursor-pointer"
                    value={size}
                    onChange={(e) => setSize(Number(e.target.value))}
                  >
                    {[16, 24, 36, 48, 72, 96, 128].map((s) => (
                      <option key={s} value={s}>
                        {s}px
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={label}>Perataan</label>
                  <select
                    className="field-select cursor-pointer"
                    value={align}
                    onChange={(e) => setAlign(e.target.value as typeof align)}
                  >
                    <option value="left">Kiri</option>
                    <option value="center">Tengah</option>
                    <option value="right">Kanan</option>
                  </select>
                </div>
                <div className="flex items-end pb-2">
                  <label className="flex cursor-pointer items-center gap-2 text-[12px] font-semibold text-text-muted">
                    <input
                      type="checkbox"
                      checked={bold}
                      onChange={(e) => setBold(e.target.checked)}
                    />
                    Tebal
                  </label>
                </div>
              </div>
              <div>
                <label className={label}>Warna</label>
                <ColorPicker
                  value={textColor}
                  onChange={setTextColor}
                  allowNone
                  noneLabel="Ikut tema"
                />
              </div>
              <button
                type="button"
                onClick={addText}
                disabled={!content.trim()}
                className="btn btn-primary btn-sm gap-1.5 self-end"
              >
                <Type className="size-3.5" /> Tambah Teks
              </button>
            </>
          )}

          {tab === "shape" && (
            <>
              <div>
                <label className={label}>Bentuk</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {(
                    [
                      { s: "rect", label: "Kotak", icon: Square },
                      { s: "circle", label: "Lingkaran", icon: Circle },
                      { s: "line", label: "Garis", icon: Minus },
                    ] as const
                  ).map(({ s, label: l, icon: Icon }) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setShape(s)}
                      className={cn(
                        "flex flex-col items-center gap-1 rounded-[var(--r)] border px-1.5 py-2",
                        shape === s
                          ? "border-primary bg-primary/5 text-text"
                          : "border-border-soft bg-bg text-text-muted cursor-pointer hover:border-border"
                      )}
                    >
                      <Icon className="size-4" />
                      <span className="text-[10.5px] font-semibold">{l}</span>
                    </button>
                  ))}
                </div>
                {shape === "line" && (
                  <p className="mt-1.5 text-[11px] text-text-light">
                    Garis mendatar — untuk garis tegak, pakai Kotak tipis.
                  </p>
                )}
              </div>
              {shape !== "line" && (
                <div>
                  <label className={label}>Warna Isi</label>
                  <ColorPicker value={fill} onChange={setFill} allowNone noneLabel="Transparan" />
                </div>
              )}
              <div>
                <label className={label}>
                  {shape === "line" ? "Warna Garis" : "Garis Tepi"}
                </label>
                <ColorPicker
                  value={stroke}
                  onChange={setStroke}
                  allowNone={shape !== "line"}
                  noneLabel="Tanpa tepi"
                />
              </div>
              <div>
                <label className={label}>Tebal Garis ({strokeW}px)</label>
                <input
                  type="range"
                  min={1}
                  max={20}
                  value={strokeW}
                  onChange={(e) => setStrokeW(Number(e.target.value))}
                  className="w-full"
                />
              </div>
              <button
                type="button"
                onClick={addShape}
                className="btn btn-primary btn-sm gap-1.5 self-end"
              >
                <Shapes className="size-3.5" /> Tambah Bentuk
              </button>
            </>
          )}

          {tab === "data" && (
            <>
              <div>
                <label className={label}>Pilih Sensor</label>
                {enabledTags.length === 0 ? (
                  <p className="text-[11.5px] text-text-muted">
                    Belum ada sensor — tambahkan lewat tab Data.
                  </p>
                ) : (
                  <div className="flex max-h-44 flex-col gap-1 overflow-y-auto rounded-[var(--r)] border border-border-soft bg-bg p-1.5">
                    {enabledTags.map((t) => (
                      <label
                        key={t.id}
                        className={cn(
                          "flex cursor-pointer items-center gap-2 rounded-[var(--r-sm)] px-2 py-1.5 text-[12.5px]",
                          tagIds.includes(t.id)
                            ? "bg-primary/5 text-text"
                            : "text-text-muted hover:bg-bg-hover"
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={tagIds.includes(t.id)}
                          onChange={() => toggleTag(t.id)}
                          className="accent-[var(--rein-primary)]"
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {t.label}
                          {t.unit ? ` (${t.unit})` : ""}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {(
                  [
                    { k: "chart", icon: TrendingUp },
                    { k: "gauge", icon: GaugeIcon },
                    { k: "bar", icon: BarChart3 },
                    { k: "table", icon: Table2 },
                    { k: "alarm", icon: Bell },
                  ] as const
                ).map(({ k, icon: Icon }) => {
                  const lim = TAG_LIMITS[k];
                  const ok = tagIds.length >= lim.min && tagIds.length <= lim.max;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => addData(k)}
                      disabled={!ok}
                      className="btn btn-secondary btn-sm flex-col gap-0.5 py-2"
                      title={
                        ok
                          ? undefined
                          : lim.min === lim.max
                            ? `${lim.label}: pilih tepat ${lim.min} sensor`
                            : `${lim.label}: pilih ${lim.min}–${lim.max} sensor`
                      }
                    >
                      <Icon className="size-3.5" />
                      <span className="text-[10.5px]">{lim.label}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
    </Drawer>
  );
}
