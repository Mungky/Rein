"use client";

/** Expanded detail under one tag row (the "dropdown") — now the ONE place a
 *  sensor is configured.
 *
 *  It used to be three places. Nama/Perangkat/Unit were edited in the table
 *  cells, Penyimpanan here, and Site/Topik/Ambang/Scaling in a separate
 *  right-hand drawer ("Atur Sumber"). Nobody could remember which setting lived
 *  where, and the drawer covered the very row you were configuring. The drawer
 *  is gone; everything it owned moved in here.
 *
 *  TWO BANDS, and it used to be three:
 *
 *   1. the chart, with Min/Rata²/Maks in its header
 *   2. Sumber | Ambang & Kalibrasi | Penyimpanan
 *
 *  The third band held a paginated list of raw samples and an "Info Sensor"
 *  block. Both went, and neither was a trim for its own sake:
 *
 *   - the raw list existed ONLY so you could read an exact value and the time
 *     it arrived. The chart does that now (see tag-chart.tsx — hover gives the
 *     timestamp and the value, same as Monitor), and the Riwayat drawer still
 *     holds the full row-by-row history for when that is what you actually
 *     want. One honest difference: the chart reads BUCKET AVERAGES, so at long
 *     ranges it is coarser than the raw rows were.
 *   - "Info Sensor" printed the alarm/warn bounds as read-only text directly
 *     under the input boxes holding the very same numbers, and repeated
 *     Perangkat from the Sumber zone. It was left over from the older layout.
 *
 *  WHY TWO SAVE BEHAVIOURS. Zones 1-2 are free text: saving per keystroke would
 *  PATCH the tag on every digit and, worse, write half-typed numbers. They get a
 *  draft and a Simpan button. Zone 3 is two discrete controls where the click IS
 *  the decision, so they keep saving instantly — putting them behind the same
 *  button would make "Aktif" feel broken.
 *
 *  STORAGE MODEL — ONE LANE, no choice to make.
 *  Zone 3 used to open with a "Simpan detail mentah & arsipkan ke Drive"
 *  checkbox that moved the sensor between two storage lanes with different
 *  retention, different archives, and a sampling restriction attached. That
 *  second lane is retired (see the retire-store-lane migration), so every
 *  sensor now gets exactly the same treatment:
 *
 *    raw values          ring_window_h (24-48 h), day partitions dropped whole
 *    per-minute summary  ~30 days in scada_rollup_1m, then a per-plant .zip
 *                        on Google Drive
 *
 *  All four sampling levels are legal for every sensor. What the zone shows
 *  now is that retention, read from the live settings rather than described in
 *  prose — the point being that there is nothing here to decide, only
 *  something to know. */

import { useCallback, useMemo, useState } from "react";
import {
  Download,
  History,
  Loader2,
  Radio,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { scadaApi } from "@/lib/api/scada";
import type {
  ChartRange,
  RecentSample,
  RnetSettings,
  SamplingLevel,
  Site,
  SummaryItem,
  Tag,
} from "../types";
import { TagChart, type ChartPoint } from "./tag-chart";
import type { SparkStatus } from "./tag-sparkline";
import { RANGE_LABELS, RANGE_MS } from "../panels/chart-panel";
import { formatValue, resolveDecimals } from "../panels/elements";
import { getSummaryItem } from "../panels/summary-batch";
import { usePanelRefresh } from "../panels/use-panel-refresh";
import { levelLabel } from "../sampling";
import { withLiveTail } from "./live-tail";

/** Jatah titik grafik DI TAB DATA — jauh lebih besar dari jatah panel Monitor
 *  (RANGE_POINTS), dan itu justru intinya.
 *
 *  Dengan 360 titik, 24 jam jadi bucket 240 detik. Dua akibatnya, dan yang
 *  kedua tidak kelihatan:
 *    1. lonjakan sesaat rata jadi hilang di dalam rata-rata 4 menit,
 *    2. 240 detik melewati ambang 60 detik di /history, jadi datanya diambil
 *       dari ringkasan per-menit — padahal 24 jam persis jendela yang jadi
 *       alasan lajur mentah ada.
 *
 *  1800 titik = bucket 48 detik: tetap di lajur mentah, dan sekitar dua titik
 *  per piksel di lebar grafik ini. Lebih rapat dari itu tidak menambah apa pun
 *  yang bisa dilihat mata, tapi menambah baris yang harus diagregasi server.
 *
 *  Panel Monitor sengaja TIDAK ikut: sebuah ubin di dinding video tidak bisa
 *  menampilkan bedanya, jadi biayanya percuma di sana. */
const DATA_RANGE_POINTS: Partial<Record<ChartRange, number>> = {
  "1h": 600, //   6 dtk
  "6h": 480, //  45 dtk
  "24h": 1800, // 48 dtk — di bawah ambang 60 dtk, jadi lajur mentah
};
const DEFAULT_RANGE_POINTS = 600;

/** All four are legal for every sensor. The slow/slowest-only restriction that
 *  used to apply while storing existed to keep a month of rows under Excel's
 *  sheet limit in the store lane's archive; that lane is retired. */
const LEVEL_OPTIONS: SamplingLevel[] = ["fastest", "fast", "slow", "slowest"];

function fmtTs(iso: string): string {
  return new Date(iso).toLocaleString("id", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** config value → input string. Empty for absent, so "belum diatur" and 0 stay
 *  distinguishable (0 is a legitimate threshold). */
function s(v: unknown): string {
  return v === undefined || v === null ? "" : String(v);
}

/** The editable half of a tag, as strings. */
interface Draft {
  siteId: string;
  topic: string;
  alarmMin: string;
  alarmMax: string;
  warnMin: string;
  warnMax: string;
  scale: string;
  offset: string;
  decimals: string;
}

function draftOf(cfg: Record<string, unknown>, siteId: string): Draft {
  return {
    siteId,
    topic: s(cfg.mqtt_topic),
    alarmMin: s(cfg.alarm_min),
    alarmMax: s(cfg.alarm_max),
    warnMin: s(cfg.warn_min),
    warnMax: s(cfg.warn_max),
    scale: s(cfg.scale),
    offset: s(cfg.offset),
    decimals: s(cfg.decimals),
  };
}

export function TagDetailRow({
  tag,
  sites,
  settings,
  range,
  samples,
  sparkStatus,
  online,
  loading,
  canManage,
  colSpan,
  onChanged,
  onOpenHistory,
  onExport,
}: {
  tag: Tag;
  /** Brokers available for the Sumber zone (was a SourceDialog prop). */
  sites: Site[];
  /** Admin-tuned sampling durations, so the level select can say what each
   *  level actually means instead of a bare word. NULL while loading. */
  settings: RnetSettings | null;
  /** Jendela waktu bersama (selektor "Rentang" di toolbar) — dipakai grafik
   *  besar + statistik Min/Rata/Maks supaya seragam dengan sparkline. */
  range: ChartRange;
  /** Newest first — stored samples + session live points, already merged. */
  samples: RecentSample[];
  sparkStatus: SparkStatus;
  online: boolean;
  loading: boolean;
  canManage: boolean;
  colSpan: number;
  onChanged: () => Promise<void>;
  onOpenHistory: () => void;
  /** Buka drawer Export (kalender Dari/Sampai) untuk sensor ini. */
  onExport: () => void;
}) {
  const cfg = tag.config as Record<string, unknown>;
  const level = (cfg.sampling_level as SamplingLevel) || "fast";
  // Baris detail tidak punya setelan panel, jadi presisinya dari sensor.
  const dec = resolveDecimals(null, cfg);

  /** Ambang yang sudah TERSIMPAN, dirangkai untuk dibaca. Dari `cfg`, bukan
   *  dari `draft` — kalau dari draft ia cuma memantulkan ketikan dan tidak
   *  membuktikan apa pun soal apa yang sampai ke database. */
  const savedBounds = useMemo(() => {
    const u = tag.unit ? ` ${tag.unit}` : "";
    const span = (lo: unknown, hi: unknown) =>
      lo === undefined && hi === undefined
        ? null
        : `${lo ?? "−∞"} – ${hi ?? "∞"}${u}`;
    const parts = [
      ["alarm", span(cfg.alarm_min, cfg.alarm_max)],
      ["waspada", span(cfg.warn_min, cfg.warn_max)],
    ].filter(([, v]) => v) as [string, string][];
    return parts.length
      ? parts.map(([k, v]) => `${k} ${v}`).join(" · ")
      : null;
  }, [cfg, tag.unit]);
  // Jendela retensi mentah yang SEBENARNYA berlaku (admin bisa menyetelnya).
  const retentionHours = settings?.ring_window_h ?? null;

  const [saving, setSaving] = useState(false);

  // A sensor keeps a site that was later disabled — it must stay selectable or
  // saving anything else here would silently reassign the sensor.
  const enabledSites = useMemo(
    () => sites.filter((x) => x.enabled || x.id === tag.site_id),
    [sites, tag.site_id]
  );

  // Zones 1-2 are a draft. The component remounts per expanded row (the parent
  // keys its Fragment on tag.id), so this is always seeded from the right tag.
  const saved = useMemo(
    () => draftOf(cfg, tag.site_id ?? enabledSites[0]?.id ?? ""),
    [cfg, tag.site_id, enabledSites]
  );
  const [draft, setDraft] = useState<Draft>(saved);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const dirty = useMemo(
    () => (Object.keys(saved) as (keyof Draft)[]).some((k) => saved[k] !== draft[k]),
    [saved, draft]
  );

  /** Ada kalibrasi aktif? Dari config TERSIMPAN maupun draft yang sedang
   *  diketik, supaya peringatannya sudah muncul sebelum tombol Simpan ditekan. */
  const hasScaling =
    cfg.scale !== undefined ||
    cfg.offset !== undefined ||
    cfg.decimals !== undefined ||
    draft.scale.trim() !== "" ||
    draft.offset.trim() !== "" ||
    draft.decimals.trim() !== "";


  // `samples` (dari analysis-view) sudah = data tersimpan + titik live sesi ini.
  const ascending = useMemo(() => [...samples].reverse(), [samples]);

  // Grafik besar = jendela "Rentang" terpilih (bucketed dari server), dan
  // statistik Min/Rata/Maks = agregat SUNGGUHAN atas jendela yang sama
  // (getSummary, bukan cuma 100 titik terakhir) — jadi grafik, sparkline, dan
  // statistik semuanya bercerita hal yang sama. Di-fetch ulang pada irama panel
  // (60 dtk); di antara fetch, ekor live ditempel supaya ujung kurva bergerak.
  const [chartPts, setChartPts] = useState<ChartPoint[] | null>(null);
  const [summary, setSummary] = useState<SummaryItem | null>(null);
  // Jendela mana yang sedang ada di chartPts. Selama belum cocok dengan yang
  // diminta (baru dibuka, atau Rentang baru saja diganti), grafik menggambar
  // placeholder diam — bukan ~100 titik mentah terakhir yang jendelanya jauh
  // lebih sempit dan tampil sebagai kurva liar sebelum data asli tiba.
  const chartWindow = `${tag.id}|${range}`;
  const [chartLoadedFor, setChartLoadedFor] = useState<string | null>(null);
  const chartPending = chartLoadedFor !== chartWindow;

  const loadRange = useCallback(async () => {
    const end = new Date();
    const start = new Date(end.getTime() - RANGE_MS[range]);
    const window = `${tag.id}|${range}`;
    try {
      const [hist, sum] = await Promise.all([
        scadaApi.getHistory(
          [tag.id],
          start,
          end,
          DATA_RANGE_POINTS[range] ?? DEFAULT_RANGE_POINTS
        ),
        // Lewat pengumpul: baris detail sering terbuka bersamaan dengan panel
        // Monitor yang menanyakan rentang yang sama — satu permintaan cukup.
        getSummaryItem(tag.id, RANGE_MS[range]),
      ]);
      const pts = hist.series[0]?.points ?? [];
      // min/maks ikut disimpan — /history selalu mengirimnya, dan sampai
      // sekarang keduanya dibuang di baris ini. Itulah pita di grafik.
      setChartPts(
        pts.map((p) => ({ ts: p.t, value: p.avg, min: p.min, max: p.max }))
      );
      setSummary(sum);
      setChartLoadedFor(window);
    } catch {
      /* biarkan tampilan lama; usePanelRefresh coba lagi */
    }
  }, [tag.id, range]);
  usePanelRefresh(loadRange);

  // Grafik rentang + ekor live bila datanya cukup; sensor baru (< 2 titik dalam
  // rentang) pakai data live sesi ini supaya langsung tergambar & bergerak.
  const chartSamples = useMemo(
    () =>
      chartPts && chartPts.length >= 2
        ? withLiveTail(chartPts, ascending)
        : ascending,
    [chartPts, ascending]
  );

  // Statistik: agregat server atas rentang bila tersedia; selagi memuat,
  // fallback ke data terkini supaya tile tidak kosong.
  const stats = useMemo(() => {
    if (
      summary &&
      summary.min !== null &&
      summary.max !== null &&
      summary.avg !== null
    ) {
      return { min: summary.min, max: summary.max, avg: summary.avg };
    }
    if (samples.length === 0) return null;
    const values = samples.map((x) => x.value);
    return {
      min: Math.min(...values),
      max: Math.max(...values),
      avg: values.reduce((a, b) => a + b, 0) / values.length,
    };
  }, [summary, samples]);

  // Pratinjau scaling — dipindahkan utuh dari SourceDialog; bagian terbaiknya.
  const num = (v: string, fallback: number) =>
    v.trim() === "" ? fallback : Number(v.trim().replace(",", "."));
  const scaleNum = num(draft.scale, 1);
  const offsetNum = num(draft.offset, 0);
  const decNum = draft.decimals.trim() === "" ? null : Number(draft.decimals.trim());
  const previewValid = Number.isFinite(scaleNum) && Number.isFinite(offsetNum);
  const previewStored = previewValid
    ? (() => {
        const v = 100 * scaleNum + offsetNum;
        return decNum !== null && Number.isFinite(decNum)
          ? v.toFixed(Math.max(0, Math.min(6, decNum)))
          : String(v);
      })()
    : "—";

  async function patchConfig(patch: Record<string, unknown>) {
    setSaving(true);
    try {
      const config = { ...cfg, ...patch };
      // Keep config clean: drop keys explicitly set to undefined
      for (const k of Object.keys(config)) {
        if (config[k] === undefined) delete config[k];
      }
      await scadaApi.updateTag(tag.id, { config });
      await onChanged();
    } catch {
      toast.error("Gagal menyimpan pengaturan");
    } finally {
      setSaving(false);
    }
  }

  /** Zones 1-2. Ported from SourceDialog.save DELIBERATELY UNCHANGED in one
   *  respect: it DELETES each optional key before conditionally re-adding it.
   *  A merge-style patch (like patchConfig above) can only ever set values, so
   *  clearing a threshold field would leave the old number in config and the
   *  bound would be uncloseable. That asymmetry is the whole reason this is a
   *  separate function rather than another patchConfig call. */
  async function saveSource() {
    const siteId = draft.siteId;
    if (siteId === "") return;
    if (tag.source === "mqtt" && draft.topic.trim() === "") return;
    setSaving(true);
    try {
      const config: Record<string, unknown> = {
        ...cfg,
        mqtt_topic: draft.topic.trim(),
      };
      // "Field" sudah tidak ada — nama nilai di sumbernya sekarang tinggal di
      // kolom Perangkat. Sisa mqtt_field dari versi lama dibuang saat sensor
      // ini disimpan, supaya tidak ada dua tempat yang mengaku benar.
      delete config.mqtt_field;
      delete config.alarm_min;
      delete config.alarm_max;
      delete config.warn_min;
      delete config.warn_max;
      delete config.scale;
      delete config.offset;
      delete config.decimals;
      delete config.silent_alarm; // sensor-bisu is automatic now

      const dec = (v: string) => v.trim().replace(",", ".");
      const min = dec(draft.alarmMin);
      const max = dec(draft.alarmMax);
      const wmin = dec(draft.warnMin);
      const wmax = dec(draft.warnMax);
      if (min !== "" && Number.isFinite(Number(min))) config.alarm_min = Number(min);
      if (max !== "" && Number.isFinite(Number(max))) config.alarm_max = Number(max);
      if (wmin !== "" && Number.isFinite(Number(wmin))) config.warn_min = Number(wmin);
      if (wmax !== "" && Number.isFinite(Number(wmax))) config.warn_max = Number(wmax);
      // Scaling / calibration — omit no-op values to keep config clean
      const sc = dec(draft.scale);
      const of = dec(draft.offset);
      const dc = draft.decimals.trim();
      if (sc !== "" && Number.isFinite(Number(sc)) && Number(sc) !== 1)
        config.scale = Number(sc);
      if (of !== "" && Number.isFinite(Number(of)) && Number(of) !== 0)
        config.offset = Number(of);
      if (dc !== "" && Number.isInteger(Number(dc))) config.decimals = Number(dc);

      // `source` dan `site_id` HANYA dikirim kalau memang berubah. Sebelumnya
      // `source: "mqtt"` selalu ikut, dan pada tag ber-source "simulator" itu
      // memicu source_changed di router → PURGE_TAG_HISTORY: menekan Simpan
      // pada sebuah ambang menghapus seluruh riwayat sensor itu.
      const patch: Record<string, unknown> = { config };
      if (tag.source !== "mqtt" && draft.topic.trim() !== "") patch.source = "mqtt";
      if (siteId !== (tag.site_id ?? "")) patch.site_id = siteId;
      await scadaApi.updateTag(tag.id, patch);
      // Re-seed from what was actually PERSISTED, not from what was typed.
      // Otherwise a no-op value the save deliberately dropped (skala 1, offset
      // 0) stays in the draft and the row reads "belum disimpan" forever.
      setDraft(draftOf(config, siteId));
      await onChanged();
      toast.success(
        hasScaling
          ? "Tersimpan. Kalibrasi berlaku untuk data yang masuk setelah ini."
          : "Sumber & ambang tersimpan"
      );
    } catch {
      toast.error("Gagal menyimpan sumber");
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled() {
    setSaving(true);
    try {
      await scadaApi.updateTag(tag.id, { enabled: !tag.enabled });
      await onChanged();
    } catch {
      toast.error("Gagal mengubah status tag");
    } finally {
      setSaving(false);
    }
  }

  /** Kenapa Simpan tidak bisa ditekan — null berarti bisa.
   *
   *  Dulu ini cuma boolean, jadi tag tanpa topik/site menampilkan kolom yang
   *  bisa diketik, bar Simpan yang muncul, dan tombol mati tanpa sepatah kata:
   *  jalan buntu senyap. Dan syarat topik hanya masuk akal untuk tag MQTT —
   *  memblokir ambang sebuah sensor simulator karena ia tidak punya topik itu
   *  menghukum hal yang tidak ada hubungannya. */
  const blockedReason: string | null = !canManage
    ? "Butuh izin scada:manage"
    : enabledSites.length === 0
      ? "Belum ada site (broker) — buat dulu lewat Kelola Site"
      : tag.source === "mqtt" && draft.topic.trim() === ""
        ? "Topik wajib diisi untuk sensor MQTT"
        : draft.siteId === ""
          ? "Pilih site (broker) dulu"
          : null;
  const canSaveSource = blockedReason === null;
  const ro = !canManage || saving;
  const zone =
    "rounded-[var(--r-lg)] border border-border-soft bg-bg p-3 flex flex-col gap-2.5";
  const zoneTitle =
    "flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-text-light";
  const fieldLabel = "mb-1 block text-[11px] font-semibold text-text-muted";

  return (
    <tr className="border-t border-border-soft bg-bg-sidebar/60">
      <td colSpan={colSpan} className="px-4 py-3">
        {/* ── BARIS 1: grafik ──
            Min/Rata²/Maks ikut di header, bukan di kotak terpisah di bawah:
            ketiganya merangkum persis jendela yang digambar grafik ini, jadi
            memisahkannya membuat dua tempat untuk satu keterangan. */}
        <div className="mb-3 rounded-[var(--r-lg)] border border-border-soft bg-bg p-2">
          <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 px-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-text-light">
              {RANGE_LABELS[range]} terakhir
            </span>
            {online ? (
              <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-green">
                <span className="inline-block size-1.5 rounded-full bg-green" /> live
              </span>
            ) : (
              <span className="text-[10.5px] text-text-light">offline</span>
            )}
            {(loading || chartPending) && (
              <Loader2 className="size-3 animate-spin text-text-light" />
            )}
            <div className="flex-1" />
            {stats && (
              <span className="flex items-center gap-2 text-[10.5px] tabular-nums">
                {(
                  [
                    ["Min", stats.min],
                    ["Rata²", stats.avg],
                    ["Maks", stats.max],
                  ] as const
                ).map(([label, v]) => (
                  <span key={label} className="text-text-light">
                    {label}{" "}
                    <span className="font-semibold text-text">
                      {formatValue(v, dec)}
                    </span>
                  </span>
                ))}
                {tag.unit && <span className="text-text-light">{tag.unit}</span>}
              </span>
            )}
            {/* Rentang waktu hanya ditampilkan kalau yang tergambar memang
                jendela yang diminta — kalau tidak, angkanya menyesatkan. */}
            {!chartPending && chartSamples.length > 0 && (
              <span className="text-[10.5px] tabular-nums text-text-light">
                {fmtTs(chartSamples[0].ts)} —{" "}
                {fmtTs(chartSamples[chartSamples.length - 1].ts)}
              </span>
            )}
          </div>
          <TagChart
            points={chartSamples}
            status={sparkStatus}
            unit={tag.unit}
            decimals={dec}
            pending={chartPending}
            height={180}
          />
        </div>

        {/* ── Pengaturan: tiga zona sejajar ── */}
        <div className="mb-3 grid gap-3 lg:grid-cols-3">
          {/* ── 1. Sumber ── */}
          <div className={zone}>
            <div className={zoneTitle}>
              <Radio className="size-3" /> Sumber
            </div>
            {enabledSites.length === 0 ? (
              <p className="rounded-[var(--r)] border border-border-soft bg-bg-sidebar px-3 py-2.5 text-[12px] text-text-muted">
                Belum ada site (broker). Buat dulu lewat tombol{" "}
                <span className="font-semibold">Kelola Site</span> di toolbar —
                isi alamat broker yang sama dengan yang dipakai Node-RED.
              </p>
            ) : (
              <>
                <div>
                  <label className={fieldLabel}>
                    Site (Broker) <span className="text-red">*</span>
                  </label>
                  <select
                    className="field-select h-8 cursor-pointer text-[12px]"
                    value={draft.siteId}
                    disabled={ro}
                    onChange={(e) => set("siteId", e.target.value)}
                  >
                    {enabledSites.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name} ({x.mqtt_host})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={fieldLabel}>
                    Topik <span className="text-red">*</span>
                  </label>
                  <input
                    className="field-input h-8 font-mono text-[12px]"
                    placeholder="rnet/lombok/gw/lombok1"
                    value={draft.topic}
                    disabled={ro}
                    maxLength={300}
                    onChange={(e) => set("topic", e.target.value)}
                  />
                  <p className="mt-1 text-[10.5px] leading-snug text-text-light">
                    Samakan persis dengan topik di node{" "}
                    <span className="font-mono">mqtt out</span> Node-RED. Satu
                    topik boleh dipakai banyak sensor.
                  </p>
                </div>
                {/* Perangkat dibaca-saja di sini: satu kotak, dan tempatnya di
                    kolom tabel. Ditampilkan supaya pasangan topik+perangkat
                    terlihat bersama — itu yang menentukan nilai mana yang
                    diambil sensor ini. */}
                <div className="rounded-[var(--r)] border border-border-soft bg-bg-sidebar px-2.5 py-2 text-[11px] text-text-muted">
                  <div className="flex gap-2">
                    <span className="shrink-0 text-text-light">Perangkat</span>
                    <span
                      className="min-w-0 truncate font-mono text-text"
                      title={tag.device_key}
                    >
                      {tag.device_key || "— belum diisi"}
                    </span>
                  </div>
                  <p className="mt-1 leading-snug">
                    Nama nilai di dalam payload. Diubah di kolom{" "}
                    <span className="font-semibold text-text">Perangkat</span> pada
                    tabel. Untuk topik yang membawa beberapa gateway, tulis
                    lengkap:{" "}
                    <span className="font-mono text-text">lombok1.waterlevel1</span>.
                  </p>
                </div>
              </>
            )}
          </div>

          {/* ── 2. Ambang & Kalibrasi ── */}
          <div className={zone}>
            <div className={zoneTitle}>
              <SlidersHorizontal className="size-3" /> Ambang &amp; Kalibrasi
              <div className="flex-1" />
              <span className="flex items-center gap-2 text-[10px] font-semibold normal-case tracking-normal">
                <span className="text-amber">● Waspada</span>
                <span className="text-red">● Alarm</span>
              </span>
            </div>
            {/* Urut nilai: Alarm bawah < Waspada bawah < aman < Waspada atas <
                Alarm atas. Dipakai SEMUA panel gauge/level sensor ini. */}
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              {(
                [
                  ["alarmMin", "Alarm bila <", "(bawah)", "text-red", "min"],
                  ["alarmMax", "Alarm bila >", "(atas)", "text-red", "maks"],
                  ["warnMin", "Waspada bila <", "(bawah)", "text-amber", "mendekati min"],
                  ["warnMax", "Waspada bila >", "(atas)", "text-amber", "mendekati maks"],
                ] as const
              ).map(([key, label, side, color, ph]) => (
                <div key={key}>
                  <label className={fieldLabel}>
                    {label} <span className={color}>{side}</span>
                  </label>
                  <input
                    type="number"
                    step="any"
                    className="field-input h-8 text-[12px]"
                    placeholder={ph}
                    value={draft[key]}
                    disabled={ro}
                    onChange={(e) => set(key, e.target.value)}
                  />
                </div>
              ))}
            </div>
            <p className="text-[10.5px] leading-snug text-text-light">
              Waspada = kuning saat nilai mulai mendekati batas; Alarm = merah saat
              melewatinya (memicu notifikasi). Kosongkan yang tidak perlu.
            </p>

            {/* Apa yang BENAR-BENAR tersimpan, bukan isi kotak di atasnya.
                Ringkasan seperti ini pernah ada lalu terhapus saat dropdown
                dirampingkan, dan ternyata itu satu-satunya konfirmasi bahwa
                Simpan mendarat: ambang tersimpan diam-diam, tidak ada yang
                berubah di layar, dan wajar dilaporkan sebagai tidak berfungsi. */}
            <div className="rounded-[var(--r)] border border-border-soft bg-bg-sidebar px-2.5 py-1.5 text-[10.5px] leading-snug">
              <span className="text-text-light">Tersimpan: </span>
              {savedBounds ? (
                <span className="tabular-nums text-text-muted">{savedBounds}</span>
              ) : (
                <span className="text-text-light">belum ada ambang</span>
              )}
            </div>

            <div className="mt-0.5 border-t border-border-soft pt-2.5">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-semibold text-text">
                  Scaling / Kalibrasi{" "}
                  <span className="font-normal text-text-light">(opsional)</span>
                </span>
                <code className="text-[10px] text-text-muted">
                  tersimpan = mentah × skala + offset
                </code>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ["scale", "Skala", "1", "any", undefined],
                    ["offset", "Offset", "0", "any", undefined],
                    ["decimals", "Desimal disimpan", "auto", "1", [0, 6]],
                  ] as const
                ).map(([key, label, ph, step, range2]) => (
                  <div key={key}>
                    <label className={fieldLabel}>{label}</label>
                    <input
                      type="number"
                      step={step}
                      min={range2?.[0]}
                      max={range2?.[1]}
                      className="field-input h-8 text-[12px]"
                      placeholder={ph}
                      value={draft[key]}
                      disabled={ro}
                      onChange={(e) => set(key, e.target.value)}
                    />
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-[10.5px] leading-snug text-text-light">
                {previewValid ? (
                  <>
                    Contoh: nilai mentah{" "}
                    <span className="font-mono text-text-muted">100</span> tersimpan
                    jadi{" "}
                    <span className="font-mono font-semibold text-text">
                      {previewStored}
                    </span>{" "}
                    {tag.unit}.
                  </>
                ) : (
                  <span className="text-red">Skala/offset harus berupa angka.</span>
                )}{" "}
                Contoh 4–20&nbsp;mA → 0–100: skala 6.25, offset −25. Kosong =
                tanpa perubahan (skala 1 dan offset 0 sengaja tidak disimpan).
              </p>

              {/* "Desimal" dulu terbaca seperti setelan tampilan, padahal ia
                  membulatkan yang DISIMPAN. Orang mengisinya, angka di Monitor
                  tidak berubah, dan menyimpulkan fiturnya rusak. Sekarang
                  angka itu memang juga jadi bawaan tampilan — tapi kalimat ini
                  tetap perlu, karena pembulatan penyimpanan tidak bisa
                  dibatalkan sedangkan tampilan bisa. */}
              <p className="mt-1 text-[10.5px] leading-snug text-text-light">
                <span className="font-semibold">Desimal</span> membulatkan angka
                yang <span className="font-semibold">disimpan</span> (berlaku
                untuk data baru saja — yang lama tidak diubah), dan sekaligus
                jadi bawaan jumlah angka di belakang koma di Monitor. Tiap panel
                masih bisa menimpanya sendiri lewat “Angka di Belakang Koma”.
              </p>

              {/* Peringatan yang paling sering hilang: kalibrasi diterapkan
                  JEMBATAN saat nilai masuk, bukan saat ditampilkan. Tanpa
                  kalimat ini orang mengubah skala, melihat angka lama tidak
                  bergerak, dan menyimpulkan fiturnya rusak — persis yang
                  terjadi. */}
              {hasScaling && (
                <p className="mt-1.5 rounded-[var(--r)] border border-amber/40 bg-amber/5 px-2 py-1.5 text-[10.5px] leading-snug text-text-muted">
                  <span className="font-semibold text-text">
                    Berlaku untuk data yang MASUK setelah ini
                  </span>{" "}
                  — jembatan menyusul dalam ~30 detik. Nilai yang sudah tersimpan
                  tetap memakai kalibrasi lama, jadi grafiknya akan terlihat
                  melompat di titik perubahan. Itu wajar, bukan kerusakan.
                </p>
              )}
            </div>
          </div>

          {/* ── 3. Penyimpanan ── */}
          <div className={zone}>
            <div className={zoneTitle}>Penyimpanan</div>

            {/* Dulu di sini ada centang "Simpan detail mentah & arsipkan ke
                Drive" yang memilih antara dua lajur penyimpanan. Lajur keduanya
                sudah pensiun — setiap sensor kini dapat perlakuan yang sama,
                jadi tidak ada lagi yang perlu dipilih. */}
            <div className="rounded-[var(--r)] border border-border-soft bg-bg-sidebar px-2.5 py-2 text-[11px] leading-snug text-text-muted">
              <div className="mb-1 font-semibold text-text">
                Semua sensor diperlakukan sama
              </div>
              <div className="flex gap-2">
                <span className="w-24 shrink-0 text-text-light">Nilai mentah</span>
                <span>
                  {retentionHours ? `±${retentionHours} jam terakhir` : "±24 jam terakhir"}
                </span>
              </div>
              <div className="flex gap-2">
                <span className="w-24 shrink-0 text-text-light">Ringkasan/menit</span>
                <span>±30 hari, lalu diarsipkan ke Google Drive</span>
              </div>
            </div>

            <div>
              <label className={fieldLabel}>Kecepatan Sampling</label>
              <select
                className="field-select h-8 cursor-pointer text-[12px]"
                value={level}
                disabled={ro}
                onChange={(e) => void patchConfig({ sampling_level: e.target.value })}
              >
                {LEVEL_OPTIONS.map((o) => (
                  // Durasi ikut dicetak: "Fast — 5 detik". Tanpa ini, memilih
                  // level berarti menebak, lalu pergi mencari artinya.
                  <option key={o} value={o}>
                    {levelLabel(o, settings)}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[10.5px] leading-snug text-text-light">
                Durasi tiap level diatur di{" "}
                {canManage ? (
                  // Tautan sungguhan, bukan petunjuk arah. Sebelumnya kalimat
                  // ini menyebut Panel Administrasi tanpa cara ke sana, dan
                  // orang tidak menemukannya.
                  <a
                    href="/admin?tab=rnet"
                    className="font-medium text-primary hover:underline"
                  >
                    Panel Administrasi → R-Net
                  </a>
                ) : (
                  "Panel Administrasi → R-Net"
                )}
                .
              </p>
            </div>

            <label
              className={cn(
                "flex items-center gap-2",
                canManage ? "cursor-pointer" : "cursor-default"
              )}
            >
              <span
                className={cn(
                  "inline-block size-3.5 rounded-full border-2",
                  tag.enabled ? "border-green bg-green" : "border-border bg-transparent"
                )}
              />
              <button
                type="button"
                onClick={() => canManage && void toggleEnabled()}
                disabled={ro}
                className={cn(
                  "text-[12px] font-medium text-text",
                  canManage && "cursor-pointer hover:underline"
                )}
              >
                {tag.enabled
                  ? "Aktif — klik untuk nonaktifkan"
                  : "Nonaktif — klik untuk aktifkan"}
              </button>
              {saving && <Loader2 className="size-3 animate-spin text-text-light" />}
            </label>

            <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
              <button
                type="button"
                onClick={onOpenHistory}
                className="btn btn-secondary btn-sm h-7 gap-1 px-2 text-[11px]"
                title="Riwayat lengkap + grafik 24 jam"
              >
                <History className="size-3" /> Riwayat
              </button>
              <button
                type="button"
                onClick={onExport}
                className="btn btn-secondary btn-sm h-7 gap-1 px-2 text-[11px]"
                title="Export data sensor ini (pilih rentang Dari/Sampai)"
              >
                <Download className="size-3" /> Export
              </button>
            </div>
          </div>
        </div>

        {/* Bar simpan — hanya muncul saat ada perubahan yang belum disimpan,
            jadi baris yang cuma dilihat tidak menampilkan tombol sama sekali. */}
        {canManage && dirty && (
          <div className="mb-3 flex items-center gap-2 rounded-[var(--r-lg)] border border-primary/40 bg-primary/5 px-3 py-2">
            <span className="text-[11.5px] text-text">
              Perubahan Sumber / Ambang / Kalibrasi belum disimpan.
              {/* Kalau tombolnya mati, katakan kenapa di tempat yang sama.
                  Tombol mati tanpa alasan membuat orang menekan berulang kali
                  lalu menyimpulkan fiturnya rusak. */}
              {blockedReason && (
                <span className="ml-1 font-semibold text-amber">
                  {blockedReason}.
                </span>
              )}
            </span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => setDraft(saved)}
              disabled={saving}
              className="btn btn-ghost btn-sm h-7 px-2 text-[11px]"
            >
              Batalkan
            </button>
            <button
              type="button"
              onClick={() => void saveSource()}
              disabled={!canSaveSource || saving}
              className="btn btn-primary btn-sm h-7 gap-1 px-3 text-[11px]"
            >
              {saving && <Loader2 className="size-3 animate-spin" />}
              Simpan
            </button>
          </div>
        )}

      </td>
    </tr>
  );
}
