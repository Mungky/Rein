"use client";

/** Panel Inspector — gaya Node-RED: klik dua kali komponen di mode Atur
 *  Layout (atau tombol ⚙ di bar bawah) → drawer pengaturan komponen itu.
 *  Setiap perubahan langsung diterapkan ke DRAFT (WYSIWYG); Simpan/Batal
 *  layout tetap yang memutuskan nasibnya. */

import { useRef, useState } from "react";
import {
  Circle,
  ImagePlus,
  Minus,
  Settings2,
  Square,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Drawer } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { importImageAsDataUri } from "./image-import";
import { RANGE_LABELS } from "./panels/chart-panel";
import { METRIC_LABELS } from "./panels/bar-panel";
import type {
  BarPanelConfig,
  ChartPanelConfig,
  ChartRange,
  Channel,
  GaugePanelConfig,
  ImagePanelConfig,
  LedPanelConfig,
  LevelPanelConfig,
  Panel,
  ShapePanelConfig,
  TablePanelConfig,
  AlarmPanelConfig,
  Tag,
  TextPanelConfig,
} from "./types";

export const SWATCHES = [
  "#ffffff",
  "#0f172a",
  "#64748b",
  "#059669",
  "#d97706",
  "#dc2626",
  "#2a78d6",
];

const RANGES = Object.keys(RANGE_LABELS) as ChartRange[];

const labelCls = "text-[12px] font-semibold text-text-muted mb-1.5 block";

/* ── small shared controls ── */

export function ColorPicker({
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

/** Angka opsional: kosong = null (otomatis). */
function NumField({
  label,
  value,
  onChange,
  placeholder = "auto",
  step,
}: {
  label: string;
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  placeholder?: string;
  step?: number;
}) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <input
        type="number"
        className="field-input"
        value={value ?? ""}
        step={step}
        placeholder={placeholder}
        onChange={(e) =>
          onChange(e.target.value === "" ? null : Number(e.target.value))
        }
      />
    </div>
  );
}

function TagSelect({
  label = "Sensor",
  value,
  tags,
  onChange,
}: {
  label?: string;
  value: string | null;
  tags: Tag[];
  onChange: (id: string | null) => void;
}) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <select
        className="field-select cursor-pointer"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">— pilih sensor —</option>
        {tags.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
            {t.unit ? ` (${t.unit})` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

function TagMultiPick({
  label = "Sensor",
  hint,
  value,
  max,
  tags,
  onChange,
}: {
  label?: string;
  hint?: string;
  value: string[];
  max: number;
  tags: Tag[];
  onChange: (ids: string[]) => void;
}) {
  function toggle(id: string) {
    if (value.includes(id)) onChange(value.filter((t) => t !== id));
    else if (value.length < max) onChange([...value, id]);
    else toast.error(`Maksimal ${max} sensor untuk komponen ini`);
  }
  return (
    <div>
      <label className={labelCls}>
        {label}
        {hint && <span className="ml-1 font-normal text-text-light">({hint})</span>}
      </label>
      {tags.length === 0 ? (
        <p className="text-[11.5px] text-text-muted">
          Belum ada sensor — tambahkan lewat tab Data.
        </p>
      ) : (
        <div className="flex max-h-44 flex-col gap-1 overflow-y-auto rounded-[var(--r)] border border-border-soft bg-bg p-1.5">
          {tags.map((t) => (
            <label
              key={t.id}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-[var(--r-sm)] px-2 py-1.5 text-[12.5px]",
                value.includes(t.id)
                  ? "bg-primary/5 text-text"
                  : "text-text-muted hover:bg-bg-hover"
              )}
            >
              <input
                type="checkbox"
                checked={value.includes(t.id)}
                onChange={() => toggle(t.id)}
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
  );
}

function RangeSelect({
  value,
  onChange,
}: {
  value: ChartRange;
  onChange: (r: ChartRange) => void;
}) {
  return (
    <div>
      <label className={labelCls}>Rentang Waktu</label>
      <select
        className="field-select cursor-pointer"
        value={value}
        onChange={(e) => onChange(e.target.value as ChartRange)}
      >
        {RANGES.map((r) => (
          <option key={r} value={r}>
            {RANGE_LABELS[r]} terakhir
          </option>
        ))}
      </select>
    </div>
  );
}

function OptionButtons<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { v: T; label: string; icon?: React.ComponentType<{ className?: string }> }[];
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}
      >
        {options.map(({ v, label: l, icon: Icon }) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={cn(
              "flex flex-col items-center gap-1 rounded-[var(--r)] border px-1.5 py-2",
              value === v
                ? "border-primary bg-primary/5 text-text"
                : "border-border-soft bg-bg text-text-muted cursor-pointer hover:border-border"
            )}
          >
            {Icon && <Icon className="size-4" />}
            <span className="text-[10.5px] font-semibold">{l}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const THRESHOLD_HINT =
  '"Di atas ambang" = nilai tinggi berbahaya; "Di bawah" = nilai rendah berbahaya.';

function ThresholdFields({
  warning,
  critical,
  direction,
  onPatch,
}: {
  warning: number | null;
  critical: number | null;
  direction: "above" | "below";
  onPatch: (p: {
    warning?: number | null;
    critical?: number | null;
    direction?: "above" | "below";
  }) => void;
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <NumField
          label="Ambang Waspada"
          value={warning}
          placeholder="tanpa"
          onChange={(v) => onPatch({ warning: v })}
        />
        <NumField
          label="Ambang Kritis"
          value={critical}
          placeholder="tanpa"
          onChange={(v) => onPatch({ critical: v })}
        />
      </div>
      <div>
        <label className={labelCls}>Arah Bahaya</label>
        <select
          className="field-select cursor-pointer"
          value={direction}
          onChange={(e) => onPatch({ direction: e.target.value as "above" | "below" })}
        >
          <option value="above">Di atas ambang = bahaya</option>
          <option value="below">Di bawah ambang = bahaya</option>
        </select>
        <p className="mt-1 text-[11px] text-text-light">{THRESHOLD_HINT}</p>
      </div>
    </>
  );
}

/* ── the inspector ── */

export function PanelInspector({
  panel,
  tags,
  channels,
  onChange,
  onClose,
}: {
  panel: Panel;
  tags: Tag[];
  channels: Channel[];
  /** Merge patch into the DRAFT panel (live WYSIWYG). */
  onChange: (patch: { title?: string; config?: Panel["config"] }) => void;
  onClose: () => void;
}) {
  const enabledTags = tags.filter((t) => t.enabled);
  const patchCfg = (partial: object) =>
    onChange({ config: { ...panel.config, ...partial } as Panel["config"] });

  return (
    <Drawer
      title="Atur Komponen"
      subtitle={TYPE_LABELS[panel.type] ?? panel.type}
      icon={<Settings2 className="size-5" />}
      onClose={onClose}
      footer={
        <button type="button" onClick={onClose} className="btn btn-primary btn-sm">
          Selesai
        </button>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Judul — semua jenis panel */}
        <div>
          <label className={labelCls}>Judul Panel</label>
          <input
            className="field-input"
            value={panel.title}
            maxLength={120}
            placeholder="Tanpa judul"
            onChange={(e) => onChange({ title: e.target.value })}
          />
        </div>

        {panel.type === "gauge" && (
          <GaugeForm config={panel.config} tags={enabledTags} patch={patchCfg} />
        )}
        {panel.type === "level" && (
          <LevelForm config={panel.config} tags={enabledTags} patch={patchCfg} />
        )}
        {panel.type === "led" && (
          <LedForm config={panel.config} tags={enabledTags} patch={patchCfg} />
        )}
        {panel.type === "chart" && (
          <ChartForm config={panel.config} tags={enabledTags} patch={patchCfg} />
        )}
        {panel.type === "bar" && (
          <BarForm config={panel.config} tags={enabledTags} patch={patchCfg} />
        )}
        {panel.type === "table" && (
          <>
            <TagMultiPick
              value={(panel.config as TablePanelConfig).tag_ids}
              max={8}
              tags={enabledTags}
              onChange={(tag_ids) => patchCfg({ tag_ids })}
            />
            <RangeSelect
              value={(panel.config as TablePanelConfig).range}
              onChange={(range) => patchCfg({ range })}
            />
          </>
        )}
        {panel.type === "alarm" && (
          <>
            <TagMultiPick
              hint="ambang alarm diatur per sensor di tab Data"
              value={(panel.config as AlarmPanelConfig).tag_ids}
              max={8}
              tags={enabledTags}
              onChange={(tag_ids) => patchCfg({ tag_ids })}
            />
            <RangeSelect
              value={(panel.config as AlarmPanelConfig).range}
              onChange={(range) => patchCfg({ range })}
            />
          </>
        )}
        {panel.type === "text" && (
          <TextForm config={panel.config} patch={patchCfg} />
        )}
        {panel.type === "shape" && (
          <ShapeForm config={panel.config} patch={patchCfg} />
        )}
        {panel.type === "image" && (
          <ImageForm config={panel.config} patch={patchCfg} />
        )}
        {panel.type === "channel" && (
          <div>
            <label className={labelCls}>Channel</label>
            <select
              className="field-select cursor-pointer"
              value={panel.config.channel_id}
              onChange={(e) => patchCfg({ channel_id: e.target.value })}
            >
              {channels
                .filter((c) => c.enabled)
                .sort((a, b) => a.number - b.number)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    CH {c.number} · {c.name}
                  </option>
                ))}
            </select>
            <p className="mt-1.5 text-[11px] text-text-light">
              Sumber &amp; crop channel diatur di tab Channel — panel ini hanya
              memilih channel mana yang tampil.
            </p>
          </div>
        )}
        {!(panel.type in FORMED_TYPES) && (
          <p className="text-[12px] text-text-muted">
            Panel jenis ini tidak punya pengaturan tambahan.
          </p>
        )}
      </div>
    </Drawer>
  );
}

const TYPE_LABELS: Partial<Record<Panel["type"], string>> = {
  gauge: "Gauge / Angka Status",
  level: "Level / Tangki",
  led: "LED Indikator",
  chart: "Grafik Tren",
  bar: "Bar Perbandingan",
  table: "Tabel Ringkasan",
  alarm: "Alarm",
  text: "Teks",
  shape: "Bentuk",
  image: "Gambar / Logo",
  channel: "Channel (Layar)",
};

// Types that render a real form above — used to show the "no settings" note.
const FORMED_TYPES: Partial<Record<Panel["type"], true>> = {
  gauge: true,
  level: true,
  led: true,
  chart: true,
  bar: true,
  table: true,
  alarm: true,
  text: true,
  shape: true,
  image: true,
  channel: true,
};

/* ── per-type forms ── */

function GaugeForm({
  config,
  tags,
  patch,
}: {
  config: GaugePanelConfig;
  tags: Tag[];
  patch: (p: object) => void;
}) {
  const style = config.style ?? "stat";
  return (
    <>
      <TagSelect value={config.tag_id} tags={tags} onChange={(tag_id) => patch({ tag_id })} />
      <OptionButtons
        label="Bentuk Tampilan"
        value={style}
        options={[
          { v: "stat", label: "Angka" },
          { v: "arc", label: "Jarum" },
          { v: "donut", label: "Donat" },
        ]}
        onChange={(v) => patch({ style: v })}
      />
      {style !== "stat" && (
        <div className="grid grid-cols-2 gap-3">
          <NumField
            label="Skala Min"
            value={config.min}
            placeholder="0"
            onChange={(v) => patch({ min: v })}
          />
          <NumField
            label="Skala Maks"
            value={config.max}
            placeholder="100"
            onChange={(v) => patch({ max: v })}
          />
        </div>
      )}
      <ThresholdFields
        warning={config.warning}
        critical={config.critical}
        direction={config.direction}
        onPatch={patch}
      />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Label (opsional)</label>
          <input
            className="field-input"
            value={config.label ?? ""}
            maxLength={120}
            placeholder="ikut nama sensor"
            onChange={(e) => patch({ label: e.target.value || null })}
          />
        </div>
        <div>
          <label className={labelCls}>Satuan (opsional)</label>
          <input
            className="field-input"
            value={config.unit ?? ""}
            maxLength={30}
            placeholder="ikut sensor"
            onChange={(e) => patch({ unit: e.target.value || null })}
          />
        </div>
      </div>
      <div>
        <label className={labelCls}>Warna Zona Normal</label>
        <ColorPicker
          value={config.color ?? null}
          onChange={(color) => patch({ color })}
          allowNone
          noneLabel="Hijau tema"
        />
      </div>
      <div>
        <label className={labelCls}>Angka di Belakang Koma</label>
        <select
          className="field-select cursor-pointer"
          value={config.decimals ?? ""}
          onChange={(e) =>
            patch({ decimals: e.target.value === "" ? null : Number(e.target.value) })
          }
        >
          <option value="">Otomatis</option>
          {[0, 1, 2, 3].map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}

function LevelForm({
  config,
  tags,
  patch,
}: {
  config: LevelPanelConfig;
  tags: Tag[];
  patch: (p: object) => void;
}) {
  return (
    <>
      <TagSelect value={config.tag_id} tags={tags} onChange={(tag_id) => patch({ tag_id })} />
      <div className="grid grid-cols-2 gap-3">
        <NumField
          label="Skala Min (kosong)"
          value={config.min}
          placeholder="0"
          onChange={(v) => patch({ min: v ?? 0 })}
        />
        <NumField
          label="Skala Maks (penuh)"
          value={config.max}
          placeholder="100"
          onChange={(v) => patch({ max: v ?? 100 })}
        />
      </div>
      {config.max <= config.min && (
        <p className="text-[11px] font-medium text-red">
          Skala maks harus lebih besar dari min — perbaiki sebelum Simpan.
        </p>
      )}
      <ThresholdFields
        warning={config.warning}
        critical={config.critical}
        direction={config.direction}
        onPatch={patch}
      />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Label (opsional)</label>
          <input
            className="field-input"
            value={config.label ?? ""}
            maxLength={120}
            placeholder="ikut nama sensor"
            onChange={(e) => patch({ label: e.target.value || null })}
          />
        </div>
        <div>
          <label className={labelCls}>Satuan (opsional)</label>
          <input
            className="field-input"
            value={config.unit ?? ""}
            maxLength={30}
            placeholder="ikut sensor"
            onChange={(e) => patch({ unit: e.target.value || null })}
          />
        </div>
      </div>
      <div>
        <label className={labelCls}>Warna Cairan</label>
        <ColorPicker
          value={config.color ?? null}
          onChange={(color) => patch({ color })}
          allowNone
          noneLabel="Biru tema"
        />
      </div>
    </>
  );
}

function LedForm({
  config,
  tags,
  patch,
}: {
  config: LedPanelConfig;
  tags: Tag[];
  patch: (p: object) => void;
}) {
  return (
    <>
      <TagSelect value={config.tag_id} tags={tags} onChange={(tag_id) => patch({ tag_id })} />
      <div className="grid grid-cols-2 gap-3">
        <NumField
          label="Ambang"
          value={config.threshold}
          placeholder="0"
          onChange={(v) => patch({ threshold: v ?? 0 })}
        />
        <div>
          <label className={labelCls}>LED Menyala Saat</label>
          <select
            className="field-select cursor-pointer"
            value={config.direction}
            onChange={(e) => patch({ direction: e.target.value })}
          >
            <option value="above">Nilai ≥ ambang</option>
            <option value="below">Nilai ≤ ambang</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Teks Saat Menyala</label>
          <input
            className="field-input"
            value={config.on_label ?? "AKTIF"}
            maxLength={40}
            onChange={(e) => patch({ on_label: e.target.value })}
          />
        </div>
        <div>
          <label className={labelCls}>Teks Saat Mati</label>
          <input
            className="field-input"
            value={config.off_label ?? "MATI"}
            maxLength={40}
            onChange={(e) => patch({ off_label: e.target.value })}
          />
        </div>
      </div>
      <div>
        <label className={labelCls}>Warna Saat Menyala</label>
        <ColorPicker
          value={config.on_color ?? null}
          onChange={(on_color) => patch({ on_color })}
          allowNone
          noneLabel="Hijau tema"
        />
      </div>
      <div>
        <label className={labelCls}>Warna Saat Mati</label>
        <ColorPicker
          value={config.off_color ?? null}
          onChange={(off_color) => patch({ off_color })}
          allowNone
          noneLabel="Abu redup"
        />
      </div>
      <div>
        <label className={labelCls}>Label (opsional)</label>
        <input
          className="field-input"
          value={config.label ?? ""}
          maxLength={120}
          placeholder="ikut nama sensor"
          onChange={(e) => patch({ label: e.target.value || null })}
        />
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-[12px] font-semibold text-text-muted">
        <input
          type="checkbox"
          checked={config.show_value !== false}
          onChange={(e) => patch({ show_value: e.target.checked })}
        />
        Tampilkan nilai sensor di bawah LED
      </label>
    </>
  );
}

function ChartForm({
  config,
  tags,
  patch,
}: {
  config: ChartPanelConfig;
  tags: Tag[];
  patch: (p: object) => void;
}) {
  return (
    <>
      <TagMultiPick
        hint="1–4 garis"
        value={config.tag_ids}
        max={4}
        tags={tags}
        onChange={(tag_ids) =>
          // colors sejajar dengan tag_ids — susun ulang mengikuti pilihan baru
          patch({
            tag_ids,
            colors: tag_ids.map(
              (id) => config.colors?.[config.tag_ids.indexOf(id)] ?? null
            ),
          })
        }
      />
      {config.tag_ids.length > 0 && (
        <div>
          <label className={labelCls}>Warna Garis</label>
          <div className="flex flex-col gap-2">
            {config.tag_ids.map((id, i) => (
              <div key={id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[12px] text-text-muted">
                  {tags.find((t) => t.id === id)?.label ?? `Tag ${i + 1}`}
                </span>
                <ColorPicker
                  value={config.colors?.[i] ?? null}
                  onChange={(c) => {
                    const colors = config.tag_ids.map(
                      (_, j) => config.colors?.[j] ?? null
                    );
                    colors[i] = c;
                    patch({ colors });
                  }}
                  allowNone
                  noneLabel="Bawaan"
                />
              </div>
            ))}
          </div>
        </div>
      )}
      <RangeSelect value={config.range} onChange={(range) => patch({ range })} />
      <OptionButtons
        label="Gaya Garis"
        value={config.line_style ?? "linear"}
        options={[
          { v: "linear", label: "Patah" },
          { v: "smooth", label: "Halus" },
          { v: "step", label: "Tangga" },
        ]}
        onChange={(v) => patch({ line_style: v })}
      />
      <div className="grid grid-cols-2 gap-3">
        <NumField
          label="Sumbu Y Min"
          value={config.y_min}
          onChange={(v) => patch({ y_min: v })}
        />
        <NumField
          label="Sumbu Y Maks"
          value={config.y_max}
          onChange={(v) => patch({ y_max: v })}
        />
      </div>
      <div className="flex flex-col gap-2">
        <label className="flex cursor-pointer items-center gap-2 text-[12px] font-semibold text-text-muted">
          <input
            type="checkbox"
            checked={config.show_minmax}
            onChange={(e) => patch({ show_minmax: e.target.checked })}
          />
          Pita min–maks (hanya saat 1 sensor)
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-[12px] font-semibold text-text-muted">
          <input
            type="checkbox"
            checked={config.show_legend !== false}
            onChange={(e) => patch({ show_legend: e.target.checked })}
          />
          Tampilkan legend
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-[12px] font-semibold text-text-muted">
          <input
            type="checkbox"
            checked={config.show_grid !== false}
            onChange={(e) => patch({ show_grid: e.target.checked })}
          />
          Tampilkan garis bantu (grid)
        </label>
      </div>
    </>
  );
}

function BarForm({
  config,
  tags,
  patch,
}: {
  config: BarPanelConfig;
  tags: Tag[];
  patch: (p: object) => void;
}) {
  return (
    <>
      <TagMultiPick
        hint="2–8 batang, minimal 2 agar bisa dibandingkan"
        value={config.tag_ids}
        max={8}
        tags={tags}
        onChange={(tag_ids) => patch({ tag_ids })}
      />
      <div>
        <label className={labelCls}>Ukuran yang Dibandingkan</label>
        <select
          className="field-select cursor-pointer"
          value={config.metric}
          onChange={(e) => patch({ metric: e.target.value })}
        >
          {(Object.keys(METRIC_LABELS) as (keyof typeof METRIC_LABELS)[]).map((m) => (
            <option key={m} value={m}>
              {METRIC_LABELS[m]}
            </option>
          ))}
        </select>
      </div>
      <RangeSelect value={config.range} onChange={(range) => patch({ range })} />
      <OptionButtons
        label="Arah Batang"
        value={config.orientation ?? "horizontal"}
        options={[
          { v: "horizontal", label: "Mendatar" },
          { v: "vertical", label: "Tegak" },
        ]}
        onChange={(v) => patch({ orientation: v })}
      />
      <div>
        <label className={labelCls}>Warna Batang</label>
        <ColorPicker
          value={config.color ?? null}
          onChange={(color) => patch({ color })}
          allowNone
          noneLabel="Bawaan"
        />
      </div>
    </>
  );
}

function TextForm({
  config,
  patch,
}: {
  config: TextPanelConfig;
  patch: (p: object) => void;
}) {
  return (
    <>
      <div>
        <label className={labelCls}>Isi Teks</label>
        <input
          className="field-input"
          value={config.content}
          maxLength={500}
          onChange={(e) => patch({ content: e.target.value })}
        />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={labelCls}>Ukuran</label>
          <select
            className="field-select cursor-pointer"
            value={config.size}
            onChange={(e) => patch({ size: Number(e.target.value) })}
          >
            {[16, 24, 36, 48, 72, 96, 128].map((s) => (
              <option key={s} value={s}>
                {s}px
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Perataan</label>
          <select
            className="field-select cursor-pointer"
            value={config.align}
            onChange={(e) => patch({ align: e.target.value })}
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
              checked={config.bold}
              onChange={(e) => patch({ bold: e.target.checked })}
            />
            Tebal
          </label>
        </div>
      </div>
      <div>
        <label className={labelCls}>Warna</label>
        <ColorPicker
          value={config.color}
          onChange={(color) => patch({ color })}
          allowNone
          noneLabel="Ikut tema"
        />
      </div>
    </>
  );
}

function ShapeForm({
  config,
  patch,
}: {
  config: ShapePanelConfig;
  patch: (p: object) => void;
}) {
  return (
    <>
      <OptionButtons
        label="Bentuk"
        value={config.shape}
        options={[
          { v: "rect", label: "Kotak", icon: Square },
          { v: "circle", label: "Lingkaran", icon: Circle },
          { v: "line", label: "Garis", icon: Minus },
        ]}
        onChange={(v) => patch({ shape: v })}
      />
      {config.shape !== "line" && (
        <div>
          <label className={labelCls}>Warna Isi</label>
          <ColorPicker
            value={config.fill}
            onChange={(fill) => patch({ fill })}
            allowNone
            noneLabel="Transparan"
          />
        </div>
      )}
      <div>
        <label className={labelCls}>
          {config.shape === "line" ? "Warna Garis" : "Garis Tepi"}
        </label>
        <ColorPicker
          value={config.stroke}
          onChange={(stroke) => patch({ stroke })}
          allowNone={config.shape !== "line"}
          noneLabel="Tanpa tepi"
        />
      </div>
      <div>
        <label className={labelCls}>Tebal Garis ({config.stroke_w}px)</label>
        <input
          type="range"
          min={1}
          max={20}
          value={config.stroke_w}
          onChange={(e) => patch({ stroke_w: Number(e.target.value) })}
          className="w-full"
        />
      </div>
      {config.shape === "rect" && (
        <div>
          <label className={labelCls}>Lengkung Sudut ({config.radius}px)</label>
          <input
            type="range"
            min={0}
            max={100}
            value={config.radius}
            onChange={(e) => patch({ radius: Number(e.target.value) })}
            className="w-full"
          />
        </div>
      )}
    </>
  );
}

function ImageForm({
  config,
  patch,
}: {
  config: ImagePanelConfig;
  patch: (p: object) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setImporting(true);
    try {
      const src = await importImageAsDataUri(file);
      patch({ src });
      toast.success("Gambar dimuat");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mengimpor gambar");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <>
      {config.src ? (
        <div className="overflow-hidden rounded-[var(--r)] border border-border-soft bg-bg-sidebar p-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- pratinjau data URI */}
          <img src={config.src} alt="" className="mx-auto max-h-40 object-contain" />
        </div>
      ) : (
        <p className="rounded-[var(--r)] border border-dashed border-border bg-bg-sidebar px-3 py-4 text-center text-[12px] text-text-muted">
          Belum ada gambar — pilih file atau tempel URL di bawah.
        </p>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      <button
        type="button"
        disabled={importing}
        onClick={() => fileRef.current?.click()}
        className="btn btn-secondary btn-sm gap-1.5 self-start"
      >
        <Upload className="size-3.5" />
        {importing ? "Memuat…" : config.src ? "Ganti Gambar" : "Pilih Gambar"}
      </button>
      <div>
        <label className={labelCls}>Atau URL Gambar (http/https)</label>
        <input
          className="field-input"
          placeholder="https://…/logo.png"
          defaultValue={/^https?:\/\//i.test(config.src) ? config.src : ""}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (!v) return;
            if (!/^https?:\/\//i.test(v)) {
              toast.error("URL gambar harus diawali http:// atau https://");
              return;
            }
            patch({ src: v });
          }}
        />
      </div>
      <OptionButtons
        label="Cara Mengisi Panel"
        value={config.fit}
        options={[
          { v: "contain", label: "Utuh", icon: ImagePlus },
          { v: "cover", label: "Penuhi" },
          { v: "fill", label: "Rentang" },
        ]}
        onChange={(v) => patch({ fit: v })}
      />
      <div>
        <label className={labelCls}>
          Transparansi ({Math.round((config.opacity ?? 1) * 100)}%)
        </label>
        <input
          type="range"
          min={10}
          max={100}
          value={Math.round((config.opacity ?? 1) * 100)}
          onChange={(e) => patch({ opacity: Number(e.target.value) / 100 })}
          className="w-full"
        />
      </div>
      <div>
        <label className={labelCls}>Lengkung Sudut ({config.radius ?? 0}px)</label>
        <input
          type="range"
          min={0}
          max={100}
          value={config.radius ?? 0}
          onChange={(e) => patch({ radius: Number(e.target.value) })}
          className="w-full"
        />
      </div>
    </>
  );
}
