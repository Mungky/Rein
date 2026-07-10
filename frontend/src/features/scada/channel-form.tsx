"use client";

/** Create/edit form for ONE TV-style channel (halaman Channel).
 *  A channel = number + nickname + one source definition; every field that
 *  used to live in the old "Tambah Panel" popup is configured here instead. */

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  Bell,
  Gauge,
  Globe,
  Loader2,
  MonitorPlay,
  Table2,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { scadaApi } from "@/lib/api/scada";
import { RANGE_LABELS } from "./panels/chart-panel";
import type {
  Channel,
  ChannelKind,
  ChannelVideoConfig,
  ChartRange,
  GaugePanelConfig,
  Stream,
  Tag,
  WebPanelConfig,
} from "./types";

export const CHANNEL_KINDS: {
  kind: ChannelKind;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { kind: "video", label: "Video Stream", icon: MonitorPlay },
  { kind: "web", label: "Halaman Web / HMI", icon: Globe },
  { kind: "chart", label: "Grafik Sensor", icon: TrendingUp },
  { kind: "table", label: "Tabel Sensor", icon: Table2 },
  { kind: "gauge", label: "Angka / Status", icon: Gauge },
  { kind: "bar", label: "Bar Perbandingan", icon: BarChart3 },
  { kind: "alarm", label: "Alarm", icon: Bell },
  { kind: "activity", label: "Aktivitas", icon: Activity },
];

export function channelKindLabel(kind: ChannelKind): string {
  return CHANNEL_KINDS.find((k) => k.kind === kind)?.label ?? kind;
}

const TAG_LIMITS: Record<"chart" | "table" | "bar" | "alarm", { min: number; max: number }> = {
  chart: { min: 1, max: 4 },
  table: { min: 1, max: 8 },
  bar: { min: 2, max: 8 },
  alarm: { min: 1, max: 8 },
};

const WEB_ZOOMS = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2] as const;

/** Common screen resolutions — a channel IS a screen ("resolusi layar"). */
const SCREEN_PRESETS = [
  { label: "HD", w: 1280, h: 720 },
  { label: "FHD", w: 1920, h: 1080 },
  { label: "2K", w: 2560, h: 1440 },
  { label: "4K", w: 3840, h: 2160 },
] as const;

export function ChannelForm({
  initial,
  channels,
  streams,
  tags,
  onSaved,
  onCancel,
  onDraftChange,
}: {
  /** Existing channel when editing; null when creating. */
  initial: Channel | null;
  channels: Channel[];
  streams: Stream[];
  tags: Tag[];
  onSaved: () => Promise<void>;
  onCancel: () => void;
  /** Live draft — fired on every field change so the preview above updates
   *  immediately (WYSIWYG editing). */
  onDraftChange?: (draft: Channel) => void;
}) {
  const enabledStreams = streams.filter((s) => s.enabled);
  const enabledTags = tags.filter((t) => t.enabled);

  const nextFreeNumber = useMemo(() => {
    const used = new Set(channels.map((c) => c.number));
    let n = 1;
    while (used.has(n)) n += 1;
    return n;
  }, [channels]);

  const init = initial;
  const [number, setNumber] = useState<number>(init?.number ?? nextFreeNumber);
  const [name, setName] = useState(init?.name ?? "");
  const [kind, setKind] = useState<ChannelKind>(init?.kind ?? "video");
  const [enabled, setEnabled] = useState(init?.enabled ?? true);
  const [saving, setSaving] = useState(false);

  // --- kind-specific state, seeded from the existing config when editing ---
  const vidCfg = init?.kind === "video" ? (init.config as ChannelVideoConfig) : null;
  const [streamId, setStreamId] = useState(
    vidCfg?.stream_id ?? enabledStreams[0]?.id ?? ""
  );
  const [cell, setCell] = useState<number | null>(vidCfg?.cell ?? null);

  const webCfg = init?.kind === "web" ? (init.config as WebPanelConfig) : null;
  const [url, setUrl] = useState(webCfg?.url ?? "");
  const [zoom, setZoom] = useState<number>(webCfg?.zoom ?? 1);
  const [offsetX, setOffsetX] = useState<number>(webCfg?.offset_x ?? 0);
  const [offsetY, setOffsetY] = useState<number>(webCfg?.offset_y ?? 0);

  // "Resolusi Layar" — universal: every channel is a screen (any kind)
  const initScreen = init?.config as
    | { view_w?: number | null; view_h?: number | null }
    | undefined;
  const [viewW, setViewW] = useState<number>(initScreen?.view_w ?? 1920);
  const [viewH, setViewH] = useState<number>(initScreen?.view_h ?? 1080);

  const dataCfg =
    init && ["chart", "table", "bar", "alarm"].includes(init.kind)
      ? (init.config as { tag_ids: string[]; range: ChartRange })
      : null;
  const [tagIds, setTagIds] = useState<string[]>(dataCfg?.tag_ids ?? []);
  const [range, setRange] = useState<ChartRange>(dataCfg?.range ?? "24h");

  const gaugeCfg = init?.kind === "gauge" ? (init.config as GaugePanelConfig) : null;
  const [gaugeTagId, setGaugeTagId] = useState(
    gaugeCfg?.tag_id ?? enabledTags[0]?.id ?? ""
  );
  const [warning, setWarning] = useState(
    gaugeCfg?.warning != null ? String(gaugeCfg.warning) : ""
  );
  const [critical, setCritical] = useState(
    gaugeCfg?.critical != null ? String(gaugeCfg.critical) : ""
  );
  const [direction, setDirection] = useState<"above" | "below">(
    gaugeCfg?.direction ?? "above"
  );

  const selectedStream = enabledStreams.find((s) => s.id === streamId);
  const mosaicCells = selectedStream
    ? Math.max(1, selectedStream.mosaic_rows) * Math.max(1, selectedStream.mosaic_cols)
    : 1;

  const isTagKind =
    kind === "chart" || kind === "table" || kind === "bar" || kind === "alarm";
  const limits = isTagKind ? TAG_LIMITS[kind] : null;

  function toggleTag(id: string) {
    setTagIds((prev) =>
      prev.includes(id)
        ? prev.filter((t) => t !== id)
        : limits && prev.length >= limits.max
          ? prev
          : [...prev, id]
    );
  }

  const numberTaken = channels.some(
    (c) => c.number === number && c.id !== init?.id
  );
  const webUrlOk = /^https?:\/\/.{4,}/i.test(url.trim());
  const canSubmit =
    !numberTaken &&
    number >= 1 &&
    name.trim() !== "" &&
    (kind === "video"
      ? streamId !== ""
      : kind === "web"
        ? webUrlOk
        : kind === "gauge"
          ? gaugeTagId !== ""
          : kind === "activity"
            ? true
            : limits !== null && tagIds.length >= limits.min);

  function buildConfig(): Record<string, unknown> {
    // Every channel is a screen — resolution rides along on all kinds.
    const screen = {
      view_w: Math.min(7680, Math.max(320, viewW || 1920)),
      view_h: Math.min(4320, Math.max(180, viewH || 1080)),
    };
    switch (kind) {
      case "video":
        return { ...screen, stream_id: streamId, cell };
      case "web":
        return {
          ...screen,
          url: url.trim(),
          zoom,
          offset_x: Math.max(0, offsetX || 0),
          offset_y: Math.max(0, offsetY || 0),
        };
      case "gauge":
        return {
          ...screen,
          tag_id: gaugeTagId,
          warning: warning.trim() === "" ? null : Number(warning),
          critical: critical.trim() === "" ? null : Number(critical),
          direction,
        };
      case "activity":
        return { ...screen };
      case "chart":
        return {
          ...screen,
          tag_ids: tagIds,
          range,
          show_minmax: tagIds.length === 1,
        };
      case "bar":
        return { ...screen, tag_ids: tagIds, range, metric: "avg" };
      default: // table, alarm
        return { ...screen, tag_ids: tagIds, range };
    }
  }

  // Live draft → the preview above updates as you type (WYSIWYG)
  const draftKey = JSON.stringify([
    number, name, kind, enabled, streamId, cell, url, zoom, offsetX, offsetY,
    viewW, viewH, tagIds, range, gaugeTagId, warning, critical, direction,
  ]);
  useEffect(() => {
    onDraftChange?.({
      id: init?.id ?? "draft",
      number,
      name: name || "(belum diberi nama)",
      kind,
      config: buildConfig(),
      enabled,
      created_at: null,
      updated_at: null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    try {
      const payload = {
        number,
        name: name.trim(),
        kind,
        config: buildConfig(),
        enabled,
      };
      if (init) {
        await scadaApi.updateChannel(init.id, payload);
        toast.success(`Channel ${number} diperbarui`);
      } else {
        await scadaApi.createChannel(payload);
        toast.success(`Channel ${number} dibuat`);
      }
      await onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      toast.error(
        msg.includes("dipakai")
          ? `Nomor channel ${number} sudah dipakai`
          : "Gagal menyimpan channel"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-[var(--r-lg)] border border-primary/40 bg-primary/5 p-4"
    >
      <div className="text-[13px] font-bold text-text">
        {init ? `Ubah Channel ${init.number}` : "Channel Baru"}
      </div>

      <div className="grid grid-cols-[110px_1fr] gap-3">
        <div>
          <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
            Nomor <span className="text-red">*</span>
          </label>
          <input
            type="number"
            min={1}
            max={100000}
            className={cn("field-input", numberTaken && "border-red")}
            value={number}
            onChange={(e) => setNumber(Math.max(1, Number(e.target.value) || 1))}
          />
          {numberTaken && (
            <p className="mt-1 text-[11px] text-red">Nomor sudah dipakai</p>
          )}
        </div>
        <div>
          <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
            Nama Channel <span className="text-red">*</span>
          </label>
          <input
            required
            className="field-input"
            placeholder="Mis. HMI Lombok · Tangki A Line 2"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
          />
        </div>
      </div>

      <div>
        <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
          Jenis Sumber
        </label>
        <div className="grid grid-cols-4 gap-1.5">
          {CHANNEL_KINDS.map(({ kind: k, label, icon: Icon }) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={cn(
                "flex flex-col items-center gap-1 rounded-[var(--r)] border px-1.5 py-2",
                kind === k
                  ? "border-primary bg-primary/5 text-text"
                  : "border-border-soft bg-bg text-text-muted cursor-pointer hover:border-border"
              )}
            >
              <Icon className="size-4" />
              <span className="text-center text-[10.5px] font-semibold leading-tight">
                {label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Kind-specific source fields ── */}

      {kind === "video" && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
              Sumber Stream <span className="text-red">*</span>
            </label>
            {enabledStreams.length === 0 ? (
              <p className="text-[11.5px] text-text-muted">
                Belum ada stream — tambah lewat &ldquo;Sumber Stream (HLS)&rdquo;.
              </p>
            ) : (
              <select
                className="field-select cursor-pointer"
                value={streamId}
                onChange={(e) => {
                  setStreamId(e.target.value);
                  setCell(null);
                }}
              >
                {enabledStreams.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
              Bagian Mosaic
            </label>
            <select
              className="field-select cursor-pointer"
              value={cell === null ? "" : cell}
              onChange={(e) =>
                setCell(e.target.value === "" ? null : Number(e.target.value))
              }
              disabled={mosaicCells <= 1}
            >
              <option value="">Utuh (seluruh layar)</option>
              {Array.from({ length: mosaicCells }).map((_, i) => (
                <option key={i} value={i}>
                  Kotak {i + 1}
                </option>
              ))}
            </select>
            {mosaicCells <= 1 && (
              <p className="mt-1 text-[11px] text-text-light">
                Stream ini 1×1 — tidak ada potongan.
              </p>
            )}
          </div>
        </div>
      )}

      {kind === "web" && (
        <>
          <div>
            <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
              Alamat Halaman <span className="text-red">*</span>
            </label>
            <input
              className="field-input font-mono"
              placeholder="https://vnet.wecon.com.cn/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              maxLength={2048}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
                Zoom
              </label>
              <select
                className="field-select cursor-pointer"
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
              >
                {WEB_ZOOMS.map((z) => (
                  <option key={z} value={z}>
                    {Math.round(z * 100)}%
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
                Geser Kiri (px)
              </label>
              <input
                type="number"
                min={0}
                max={4000}
                className="field-input"
                value={offsetX}
                onChange={(e) => setOffsetX(Number(e.target.value) || 0)}
              />
            </div>
            <div>
              <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
                Geser Atas (px)
              </label>
              <input
                type="number"
                min={0}
                max={4000}
                className="field-input"
                value={offsetY}
                onChange={(e) => setOffsetY(Number(e.target.value) || 0)}
              />
            </div>
          </div>
          <p className="text-[11px] text-text-light rounded-[var(--r)] border border-border-soft bg-bg-sidebar px-3 py-2">
            &ldquo;Geser&rdquo; memotong sisi kiri/atas halaman — pakai untuk
            membuang navbar/sidebar situs (mis. menu V-Net) tanpa fullscreen.
          </p>
        </>
      )}

      {/* Resolusi Layar — universal: channel = monitor dengan resolusi tetap */}
      <div className="rounded-[var(--r)] border border-border-soft bg-bg p-3">
        <div className="text-[12px] font-semibold text-text mb-0.5">
          Resolusi Layar
        </div>
        <p className="text-[11px] text-text-light mb-2.5">
          Seperti resolusi source di OBS: channel ini adalah &ldquo;layar&rdquo;
          dengan bentuk tetap. Di Monitor dia hanya diperbesar/diperkecil utuh —
          tidak pernah gepeng. Fullscreen milik situs web juga hanya mengisi
          layar ini.
        </p>
        <div className="mb-2 flex gap-1.5">
          {SCREEN_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                setViewW(p.w);
                setViewH(p.h);
              }}
              className={cn(
                "flex-1 rounded-[var(--r)] border px-1 py-1.5 text-[11px] font-semibold",
                viewW === p.w && viewH === p.h
                  ? "border-primary bg-primary/5 text-text"
                  : "border-border-soft text-text-muted cursor-pointer hover:border-border"
              )}
            >
              {p.label}
              <span className="block text-[9.5px] font-normal text-text-light">
                {p.w}×{p.h}
              </span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className="text-[11px] font-semibold text-text-muted mb-1 block">
              Lebar (px)
            </label>
            <input
              type="number"
              min={320}
              max={7680}
              className="field-input"
              value={viewW}
              onChange={(e) => setViewW(Number(e.target.value) || 1920)}
            />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-text-muted mb-1 block">
              Tinggi (px)
            </label>
            <input
              type="number"
              min={180}
              max={4320}
              className="field-input"
              value={viewH}
              onChange={(e) => setViewH(Number(e.target.value) || 1080)}
            />
          </div>
        </div>
      </div>

      {isTagKind && (
        <>
          <div>
            <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
              Tag Sensor (
              {kind === "bar" ? `2–${limits!.max}` : `maks. ${limits!.max}`})
              <span className="text-red"> *</span>
            </label>
            {enabledTags.length === 0 ? (
              <p className="text-[11.5px] text-text-muted">
                Belum ada tag — tambahkan lewat tab Data.
              </p>
            ) : (
              <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-[var(--r)] border border-border-soft bg-bg p-1.5">
                {enabledTags.map((t) => {
                  const checked = tagIds.includes(t.id);
                  const full = !checked && limits !== null && tagIds.length >= limits.max;
                  return (
                    <label
                      key={t.id}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-[var(--r-sm)] px-2 py-1.5 text-[12.5px]",
                        checked
                          ? "bg-primary/5 text-text"
                          : full
                            ? "cursor-not-allowed text-text-light"
                            : "text-text-muted hover:bg-bg-hover"
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={full}
                        onChange={() => toggleTag(t.id)}
                        className="accent-[var(--rein-primary)]"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {t.label}
                        {t.unit ? ` (${t.unit})` : ""}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
          <div>
            <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
              Rentang Waktu
            </label>
            <select
              className="field-select cursor-pointer"
              value={range}
              onChange={(e) => setRange(e.target.value as ChartRange)}
            >
              {(Object.keys(RANGE_LABELS) as ChartRange[]).map((r) => (
                <option key={r} value={r}>
                  {RANGE_LABELS[r]} terakhir
                </option>
              ))}
            </select>
          </div>
        </>
      )}

      {kind === "gauge" && (
        <>
          <div>
            <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
              Tag Sensor <span className="text-red">*</span>
            </label>
            {enabledTags.length === 0 ? (
              <p className="text-[11.5px] text-text-muted">
                Belum ada tag — tambahkan lewat tab Data.
              </p>
            ) : (
              <select
                className="field-select cursor-pointer"
                value={gaugeTagId}
                onChange={(e) => setGaugeTagId(e.target.value)}
              >
                {enabledTags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                    {t.unit ? ` (${t.unit})` : ""}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
                Ambang Waspada
              </label>
              <input
                type="number"
                step="any"
                className="field-input"
                placeholder="Kosong = tanpa"
                value={warning}
                onChange={(e) => setWarning(e.target.value)}
              />
            </div>
            <div>
              <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
                Ambang Kritis
              </label>
              <input
                type="number"
                step="any"
                className="field-input"
                placeholder="Kosong = tanpa"
                value={critical}
                onChange={(e) => setCritical(e.target.value)}
              />
            </div>
            <div>
              <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
                Arah Bahaya
              </label>
              <select
                className="field-select cursor-pointer"
                value={direction}
                onChange={(e) => setDirection(e.target.value as "above" | "below")}
              >
                <option value="above">Terlalu tinggi</option>
                <option value="below">Terlalu rendah</option>
              </select>
            </div>
          </div>
        </>
      )}

      {kind === "activity" && (
        <p className="text-[11.5px] text-text-light rounded-[var(--r)] border border-border-soft bg-bg-sidebar px-3 py-2">
          Menampilkan siapa yang sedang membuka REIN & sudah berapa lama —
          tanpa pengaturan tambahan.
        </p>
      )}

      <label className="flex cursor-pointer items-center gap-2 text-[12px] font-semibold text-text-muted">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        Channel aktif
      </label>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn btn-ghost btn-sm">
          Batal
        </button>
        <button
          type="submit"
          disabled={!canSubmit || saving}
          className="btn btn-primary btn-sm"
        >
          {saving && <Loader2 className="size-3.5 animate-spin" />}
          Simpan
        </button>
      </div>
    </form>
  );
}
