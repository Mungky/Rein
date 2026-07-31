"use client";

/** Analisis (tab "Data") — Table Editor ala Supabase.
 *  Rail kiri = daftar "Tabel" (sheet); kanan = grid: satu baris per sensor
 *  dengan nilai live, status Online, grafik mini 100 data terakhir, dan baris
 *  detail (expand) berisi grafik penuh yang bisa ditunjuk + seluruh pengaturan
 *  sensor itu.
 *  Seleksi baris melahirkan panel Grafik/Gauge/Bar di mode Monitor, plus
 *  Export Data berjangka (hari/minggu/bulan/semua). */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  BellRing,
  ChevronDown,
  ChevronRight,
  Download,
  FileUp,
  Gauge as GaugeIcon,
  Loader2,
  Pencil,
  Plus,
  RadioTower,
  Server,
  Table2,
  TrendingUp,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { apiErrorText } from "@/lib/api/client";
import { scadaApi } from "@/lib/api/scada";
import type {
  Panel,
  RecentSample,
  RnetSettings,
  Sheet,
  Tag,
} from "../types";
import { useScadaStore } from "../store";
import { useNowMs } from "../use-now";
import { samplingIntervalMs } from "../sampling";
import { RANGE_LABELS, RANGE_MS } from "../panels/chart-panel";
import { usePanelRefresh } from "../panels/use-panel-refresh";
import { RiwayatView } from "./riwayat-view";
import { ManageSitesDialog } from "../manage-sites-dialog";
import { AlarmSettingsDialog } from "./alarm-settings-dialog";
import { ExportRangeDialog } from "./export-range-dialog";
import { ImportTagsDialog } from "./import-tags-dialog";
import { TopicMonitorDialog } from "./topic-monitor-dialog";
import { TagDetailRow } from "./tag-detail-row";
import type { SparkStatus } from "./tag-sparkline";
import { TagSparkCell, buildSeries } from "./tag-spark-cell";
import {
  formatValue,
  readTagThresholds,
  resolveDecimals,
  tagStatusOf,
} from "../panels/elements";

/** Rentang yang boleh dipilih di tab Data. Sengaja berhenti di 24 jam.
 *
 *  Bukan batas tampilan — batas DATA. Nilai mentah hanya hidup selama
 *  `ring_window_h` (laci harian scada_raw dibuang utuh setelahnya), jadi
 *  rentang 7 atau 30 hari di halaman ini hanya bisa menggambar ringkasan
 *  per menit sambil berpura-pura itu hal yang sama. Halaman ini tentang data
 *  mentah; kalau yang dicari jangka panjang, tempatnya panel Monitor — yang
 *  memang membaca ringkasan dan tidak menyamar jadi sesuatu yang lain.
 *
 *  ChartRange (types.ts) tetap punya "7d"/"30d" untuk Monitor; yang dipersempit
 *  cuma pilihan di sini. */
const DATA_RANGES = ["1h", "6h", "24h"] as const;
type DataRange = (typeof DATA_RANGES)[number];

type SortKey = "label" | "device_key" | "unit" | "terkini";

type CellField = "label" | "unit" | "device_key";

interface Row {
  tag: Tag;
  /** Live value (seeded from scada_tag_latest, ticked by Realtime). */
  last: number | null;
  lastSeenMs: number | null;
  online: boolean;
  sparkStatus: SparkStatus;
}

/** Status baris dari ambang tersimpan sensornya.
 *
 *  Memakai readTagThresholds + tagStatusOf dari panels/elements.tsx — logika
 *  yang sudah dipakai panel Monitor. Sebelumnya berkas ini punya salinan
 *  sendiri yang HANYA membaca alarm_min/alarm_max, jadi warn_min/warn_max yang
 *  diisi operator tidak berpengaruh apa pun di tab Data: diisi, tersimpan,
 *  tidak terlihat, dan wajar dilaporkan sebagai "ambang tidak berfungsi". */
function statusOf(tag: Tag, value: number | null, online: boolean): SparkStatus {
  if (!online) return "offline";
  if (value === null) return "normal";
  const s = tagStatusOf(value, readTagThresholds(tag.config as Record<string, unknown>));
  return s === "kritis" ? "alarm" : s === "waspada" ? "waspada" : "normal";
}

/** Same silence window as the backend alarm engine (_silent_after_s): 3× the
 *  tag's own sampling interval, with a 60 s floor, for every tag.
 *
 *  Must stay in step with the backend. It briefly did not: both sides gave
 *  non-store tags a flat 60 s, which meant a `slowest` sensor reporting once a
 *  minute flipped offline between every pair of readings.
 *
 *  `settings` carries the ADMIN-TUNED durations. Passing them matters: with the
 *  old hardcoded table, retuning a level in Panel Administrasi left this
 *  function computing a window from the wrong seconds and painting healthy
 *  sensors as offline. */
function offlineAfterMs(tag: Tag, settings: RnetSettings | null): number {
  const cfg = tag.config as Record<string, unknown>;
  return Math.max(3 * (samplingIntervalMs(cfg, settings) / 1000), 60) * 1000;
}

export function AnalysisView({
  canEdit,
  canManage,
}: {
  canEdit: boolean;
  canManage: boolean;
}) {
  const store = useScadaStore();
  const sheets = useMemo(
    () => [...store.sheets].sort((a, b) => a.position - b.position),
    [store.sheets]
  );
  const activeSheet = sheets.find((s) => s.id === store.activeSheetId) ?? sheets[0];
  const tags = useMemo(
    () => store.tags.filter((t) => t.sheet_id === activeSheet?.id),
    [store.tags, activeSheet?.id]
  );

  const [range, setRange] = useState<DataRange>("24h");
  const [sortKey, setSortKey] = useState<SortKey>("label");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedTagId, setExpandedTagId] = useState<string | null>(null);
  const [editingCell, setEditingCell] = useState<{
    tagId: string;
    field: CellField;
    value: string;
  } | null>(null);
  const [drawerTag, setDrawerTag] = useState<Tag | null>(null);
  // Stabil, bukan arrow inline: RiwayatView mendorong satu entri riwayat
  // browser saat dibuka (supaya tombol Back HP menutupnya, bukan keluar dari
  // R-Net). Kalau callback ini berganti identitas setiap render, effect itu
  // ikut dipasang ulang dan mendorong satu entri palsu per render.
  const closeRiwayat = useCallback(() => setDrawerTag(null), []);
  // Drawer Export terbuka untuk kumpulan tag ini (null = tertutup). Dipakai
  // baik oleh tombol "Export Data" di action-bar seleksi maupun tombol Export
  // di dropdown detail (satu tag) — keduanya membuka drawer kalender yang sama.
  const [exportTags, setExportTags] = useState<Tag[] | null>(null);
  const [addingRow, setAddingRow] = useState(false);
  const [showAlarmSettings, setShowAlarmSettings] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showMonitor, setShowMonitor] = useState(false);
  // Paginasi. Bukan hiasan: SEMUA yang di bawah ini dibatasi oleh halaman —
  // sparkline (server memotong di 60 tag) dan pengambilan data mentah. Tanpa
  // paginasi, plant 300 sensor berarti 300 permintaan HTTP tiap 60 detik dan
  // 240 baris tanpa sparkline.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // 100 data mentah terakhir — HANYA untuk baris yang sedang dibuka.
  //
  // Dulu ini diambil untuk SETIAP tag: `tags.map(id => getRecentSamples(id))`,
  // satu permintaan HTTP per sensor, tiap 60 detik. Di 14 sensor tidak terasa;
  // di 300 sensor itu 300 permintaan serentak tiap menit — cukup untuk
  // menabrak pembatas laju sebelum sempat menggambar apa pun. Padahal isinya
  // cuma dipakai dua hal: daftar mentah di dropdown detail (satu baris saja
  // yang terbuka) dan nilai/status live per baris — dan yang kedua itu memang
  // tugasnya scada_tag_latest, yang sudah mengalir lewat Realtime ke
  // store.liveValues. Jadi sekarang: satu permintaan, untuk baris yang dibuka.
  const [recent, setRecent] = useState<Record<string, RecentSample[]>>({});
  // 12 jam terakhir (bucketed, satu request untuk SEMUA baris di halaman ini)
  const [sparkMap, setSparkMap] = useState<Record<string, RecentSample[]>>({});
  const [recentLoading, setRecentLoading] = useState(false);
  // Rentang -> jam untuk endpoint sparkline (dibulatkan ke atas, minimal 1 jam)
  // supaya sparkline mini mengikuti selektor Rentang, sama seperti grafik.
  const sparkRangeH = Math.max(1, Math.ceil(RANGE_MS[range] / 3_600_000));
  const [sparkLoadedFor, setSparkLoadedFor] = useState<string | null>(null);

  // Wall-clock for Online/last-online aging: held in STATE (never Date.now()
  // in render — purity rule) and refreshed every 10 s.
  const nowMs = useNowMs(10_000);

  /* ── Rows ── */

  const rows: Row[] = useMemo(() => {
    const now = nowMs ?? 0; // one pre-tick frame renders as offline, then corrects
    const built = tags.map((tag) => {
      const live = store.liveValues[tag.id];
      const stored = recent[tag.id] ?? [];
      const newestStoredMs =
        stored.length > 0 ? new Date(stored[0].ts).getTime() : null;
      const liveMs = live ? new Date(live.ts).getTime() : null;
      const lastSeenMs =
        liveMs !== null && (newestStoredMs === null || liveMs > newestStoredMs)
          ? liveMs
          : newestStoredMs;
      const last =
        liveMs !== null && (newestStoredMs === null || liveMs >= newestStoredMs)
          ? live!.value
          : stored[0]?.value ?? null;
      const online =
        lastSeenMs !== null &&
        now - lastSeenMs < offlineAfterMs(tag, store.rnetSettings);

      const sparkStatus = statusOf(tag, last, online);

      // Deret sparkline TIDAK dibangun di sini — lihat TagSparkCell. Dulu
      // dibangun untuk SETIAP sensor di lembar ini pada setiap sampel masuk,
      // karena `store.liveBuffers` ikut jadi dependensi memo ini dan berganti
      // identitas tiap kali sensor mana pun berdetak. Menyalin 100 baris lalu
      // memparse hingga 400 timestamp, dikali jumlah sensor, beberapa kali per
      // detik — untuk menghasilkan gambar yang hampir semuanya sama persis
      // dengan sebelumnya. Sekarang tiap sel mengurus ekornya sendiri.
      return { tag, last, lastSeenMs, online, sparkStatus };
    });

    const dir = sortDir === "asc" ? 1 : -1;
    const valueOf = (r: Row): string | number | null => {
      switch (sortKey) {
        case "label": return r.tag.label.toLowerCase();
        case "device_key": return r.tag.device_key.toLowerCase();
        case "unit": return r.tag.unit.toLowerCase();
        case "terkini": return r.last;
      }
    };
    return built.sort((a, b) => {
      const va = valueOf(a);
      const vb = valueOf(b);
      if (va === null && vb === null) return 0;
      if (va === null) return 1; // nulls last regardless of direction
      if (vb === null) return -1;
      if (typeof va === "string" && typeof vb === "string")
        return va.localeCompare(vb, "id") * dir;
      return (Number(va) - Number(vb)) * dir;
    });
    // store.rnetSettings: the Online column is computed from the admin-tuned
    // sampling durations, so the rows must recompute once they arrive (they
    // land one tick after the first paint) and again if an admin retunes them.
  }, [
    tags,
    store.liveValues,
    store.rnetSettings,
    recent,
    sortKey,
    sortDir,
    nowMs,
  ]);

  /* ── Halaman ── */

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  // Dijepit, bukan di-set: menghapus sensor sampai halaman 5 lenyap tidak boleh
  // membuat tabel kosong tanpa penjelasan.
  const curPage = Math.min(page, totalPages);
  const pageRows = useMemo(
    () => rows.slice((curPage - 1) * pageSize, curPage * pageSize),
    [rows, curPage, pageSize]
  );
  // Kunci ID halaman ini, DIURUTKAN. Diurutkan supaya mengganti kolom/arah
  // pengurutan tabel tidak dianggap "halaman lain" dan memicu ambil ulang
  // sparkline — isinya tetap sensor yang sama.
  const visibleIdsKey = useMemo(
    () => pageRows.map((r) => r.tag.id).sort().join(","),
    [pageRows]
  );
  // Jendela mana yang SEDANG ada di sparkMap. Selama belum cocok dengan yang
  // diminta (buka halaman pertama kali, ganti halaman/tabel/Rentang), sparkline
  // menggambar placeholder — bukan ekor live beberapa detik terakhir yang
  // diregangkan penuh sehingga tampak seperti grafik liar (lihat pending di
  // TagSparkline). Refresh 60 detik TIDAK mengosongkan ini, jadi tidak berkedip.
  const sparkWindow = `${visibleIdsKey}|${sparkRangeH}`;

  const loadPage = useCallback(async () => {
    if (visibleIdsKey === "") return;
    setRecentLoading(true);
    try {
      const ids = visibleIdsKey.split(",");
      const [spark, detail] = await Promise.all([
        // Satu permintaan untuk seluruh halaman. Server memotong di 60 tag,
        // jadi ukuran halaman sengaja tidak melebihi itu.
        scadaApi.getSparklines(sparkRangeH, 120, ids).catch(() => null),
        // Data mentah hanya untuk baris yang benar-benar dibuka.
        expandedTagId
          ? scadaApi
              .getRecentSamples(expandedTagId, 100)
              .then((res) => [expandedTagId, res.items] as [string, RecentSample[]])
              .catch(() => [expandedTagId, []] as [string, RecentSample[]])
          : Promise.resolve(null),
      ]);
      // Gagal ambil sparkline → biarkan gambar lama & status "memuat" apa
      // adanya; usePanelRefresh mencoba lagi 60 detik kemudian.
      if (spark) {
        setSparkMap(
          Object.fromEntries(
            spark.items.map((s) => [
              s.tag_id,
              s.points.map((p) => ({ ts: p.t, value: p.v })),
            ])
          )
        );
        setSparkLoadedFor(`${visibleIdsKey}|${sparkRangeH}`);
      }
      // Hanya baris yang dibuka yang disimpan: menahan 300 daftar mentah di
      // memori tidak ada gunanya kalau 299 di antaranya tidak terlihat.
      setRecent(detail ? { [detail[0]]: detail[1] } : {});
    } finally {
      setRecentLoading(false);
    }
  }, [visibleIdsKey, sparkRangeH, expandedTagId]);

  usePanelRefresh(loadPage);

  // Manual refresh (tombol di samping lonceng) re-pulls the raw lists too.
  //
  // Bergantung pada NONCE-nya saja. Dulu `loadPage` ikut jadi dependensi — dan
  // loadPage berganti identitas setiap kali `expandedTagId` berubah, jadi
  // begitu tombol refresh manual ditekan SEKALI (nonce ≠ 0 selamanya sesudah
  // itu), setiap buka/tutup baris sensor menembakkan pasangan permintaan
  // /sparklines + /recent DUA KALI: sekali dari usePanelRefresh yang memang
  // sudah menanganinya, sekali lagi dari sini.
  const loadPageRef = useRef(loadPage);
  useEffect(() => {
    loadPageRef.current = loadPage;
  }, [loadPage]);
  useEffect(() => {
    if (store.dataRefreshNonce === 0) return;
    const t = setTimeout(() => void loadPageRef.current(), 0);
    return () => clearTimeout(t);
  }, [store.dataRefreshNonce]);

  /* ── Sheet actions ── */

  async function createSheet() {
    const name = window.prompt("Nama tabel baru:");
    if (!name?.trim()) return;
    try {
      const sheet = await scadaApi.createSheet(name.trim());
      await store.refreshSheets();
      store.selectSheet(sheet.id);
    } catch {
      toast.error("Gagal membuat tabel");
    }
  }

  async function renameSheet(sheet: Sheet) {
    const name = window.prompt("Nama tabel:", sheet.name);
    if (!name?.trim() || name.trim() === sheet.name) return;
    try {
      await scadaApi.updateSheet(sheet.id, { name: name.trim() });
      await store.refreshSheets();
    } catch {
      toast.error("Gagal mengubah nama tabel");
    }
  }

  async function removeSheet(sheet: Sheet) {
    if (!window.confirm(`Hapus tabel "${sheet.name}"?`)) return;
    try {
      await scadaApi.deleteSheet(sheet.id);
      await store.refreshSheets();
      toast.success("Tabel dihapus");
    } catch (e) {
      const msg = e instanceof Error && e.message.includes("berisi tag")
        ? "Tabel masih berisi tag — hapus atau pindahkan barisnya dulu"
        : "Gagal menghapus tabel";
      toast.error(msg);
    }
  }

  /* ── Row (tag) actions ── */

  async function addRow() {
    if (!activeSheet) return;
    setAddingRow(true);
    try {
      // Baris baru lahir KOSONG (tanpa sumber, tanpa data tiruan) — nilai baru
      // muncul setelah sumbernya diatur ke Node-RED lewat sel Sumber.
      const tag = await scadaApi.createTag({
        sheet_id: activeSheet.id,
        label: "Tag Baru",
        // Diisi nama nilai di sumbernya begitu sensor dipasang ke
        // topik gabungan; untuk topik bernilai tunggal ini cuma label.
        device_key: "-",
        unit: "",
        config: {},
      });
      await store.refreshTags();
      setEditingCell({ tagId: tag.id, field: "label", value: tag.label });
    } catch {
      toast.error("Gagal menambah baris");
    } finally {
      setAddingRow(false);
    }
  }

  async function saveCell() {
    if (!editingCell) return;
    const { tagId, field, value } = editingCell;
    const trimmed = value.trim();
    setEditingCell(null);
    const tag = store.tags.find((t) => t.id === tagId);
    if (!tag) return;
    try {
      if (field === "unit") {
        await scadaApi.updateTag(tagId, { unit: trimmed });
      } else if (trimmed !== "") {
        await scadaApi.updateTag(tagId, { [field]: trimmed });
      }
      await store.refreshTags();
    } catch {
      toast.error("Gagal menyimpan perubahan");
    }
  }

  function sourceLabel(tag: Tag): string {
    if (tag.source === "mqtt") {
      const site = store.sites.find((s) => s.id === tag.site_id);
      const cfg = tag.config as Record<string, unknown>;
      const topic = String(cfg.mqtt_topic ?? "");
      // Kalau satu topik dipakai bersama (paket gabungan), ujung topiknya sama
      // untuk semua sensor — yang membedakan justru kolom Perangkat, jadi itu
      // yang ditampilkan.
      const short = tag.device_key || topic.split("/").pop() || topic;
      return `Node-RED · ${site?.name ?? "?"}${short ? ` / ${short}` : ""}`;
    }
    return "Belum diatur";
  }

  async function removeRow(tag: Tag) {
    if (!window.confirm(`Hapus tag "${tag.label}" beserta seluruh riwayat datanya?`))
      return;
    try {
      await scadaApi.deleteTag(tag.id);
      await store.refreshTags();
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(tag.id);
        return next;
      });
    } catch {
      toast.error("Gagal menghapus tag");
    }
  }

  /* ── Spawn panels from selection ── */

  async function spawnPanel(kind: "chart" | "gauge" | "bar") {
    const ids = [...selected];
    const active = store.perspectives.find((p) => p.id === store.activePerspectiveId);
    if (!active) return;
    const firstTag = tags.find((t) => t.id === ids[0]);

    let panel: Panel;
    if (kind === "gauge") {
      if (!firstTag) return;
      panel = {
        id: crypto.randomUUID(),
        type: "gauge",
        title: firstTag.label,
        config: { tag_id: ids[0] },
      };
    } else if (kind === "bar") {
      panel = {
        id: crypto.randomUUID(),
        type: "bar",
        title: `Perbandingan (${ids.length} tag)`,
        config: { tag_ids: ids, range, metric: "avg" },
      };
    } else {
      panel = {
        id: crypto.randomUUID(),
        type: "chart",
        title:
          ids.length === 1 && firstTag
            ? `Tren ${firstTag.label}`
            : `Tren Sensor (${ids.length} tag)`,
        config: { tag_ids: ids, range, show_minmax: ids.length === 1 },
      };
    }

    try {
      const { pageName, forked } = await store.addPanelToActive(panel);
      toast.success(
        forked
          ? `Panel ditambahkan ke halaman baru "${pageName}" — halaman bawaan admin tidak bisa diubah, jadi dibuatkan salinan milik Anda. Lihat di mode Monitor.`
          : `Panel ditambahkan ke "${pageName}" — lihat di mode Monitor`
      );
      setSelected(new Set());
    } catch (e) {
      // Pesan asli dari server, bukan "Gagal menambahkan panel" untuk segala
      // sebab. Toast buta itulah yang menyembunyikan 404 read-only selama ini:
      // tombolnya gagal setiap kali dan tidak ada yang tahu kenapa.
      toast.error(apiErrorText(e, "Gagal menambahkan panel"));
    }
  }

  /* ── Render ── */

  const nSel = selected.size;
  const thBase =
    "px-2 py-2 text-left text-[10.5px] font-semibold uppercase tracking-wide text-text-light select-none";
  const thSortable = cn(thBase, "cursor-pointer hover:text-text-muted");
  // select | nama | perangkat | sumber | unit | terkini | online | grafik | expand | buang?
  const colSpan = canManage ? 10 : 9;

  const sortMark = (k: SortKey) =>
    sortKey === k ? (
      sortDir === "asc" ? (
        <ArrowUp className="ml-0.5 inline size-3" />
      ) : (
        <ArrowDown className="ml-0.5 inline size-3" />
      )
    ) : null;

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "terkini" ? "desc" : "asc");
    }
  }

  function cellEditorProps(tag: Tag, field: CellField, current: string) {
    return {
      canEdit: canManage,
      editing: editingCell?.tagId === tag.id && editingCell.field === field,
      editValue: editingCell?.value ?? "",
      onStart: () => setEditingCell({ tagId: tag.id, field, value: current }),
      onChange: (v: string) => setEditingCell((c) => (c ? { ...c, value: v } : c)),
      onCommit: saveCell,
      onCancel: () => setEditingCell(null),
    };
  }

  function fmtLastSeen(ms: number | null): string {
    if (ms === null) return "belum pernah";
    return new Date(ms).toLocaleString("id", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  /** Deret lengkap untuk baris yang SEDANG DIBUKA saja.
   *
   *  Baris detail butuh daftar mentah; ke-49 baris lain tidak. Dulu deret ini
   *  dibangun untuk semua baris di memo `rows` supaya satu baris bisa
   *  memakainya. */
  const expandedBuffer = useScadaStore((s) =>
    expandedTagId ? s.liveBuffers[expandedTagId] : undefined
  );
  const expandedSeriesNewestFirst = useMemo(() => {
    if (!expandedTagId) return [];
    return buildSeries(recent[expandedTagId] ?? [], expandedBuffer).reverse();
  }, [expandedTagId, recent, expandedBuffer]);

  const selectedTags = tags.filter((t) => selected.has(t.id));

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* Rail kiri — daftar tabel (ala Supabase Table Editor) */}
      <aside className="hidden w-44 shrink-0 flex-col border-r border-border-soft bg-bg-sidebar md:flex">
        <div className="px-3 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-wide text-text-light">
          Tabel
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-1.5">
          {sheets.map((sheet) => (
            <div
              key={sheet.id}
              className={cn(
                "group flex items-center gap-1 rounded-[var(--r-sm)] px-2 py-1.5",
                sheet.id === activeSheet?.id
                  ? "bg-bg-sel text-text"
                  : "text-text-muted hover:bg-bg-hover hover:text-text"
              )}
            >
              <button
                onClick={() => store.selectSheet(sheet.id)}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
              >
                <Table2 className="size-3.5 shrink-0 opacity-70" />
                <span className="truncate text-[12.5px] font-medium">{sheet.name}</span>
              </button>
              {canManage && (
                <span className="hidden shrink-0 gap-0.5 group-hover:flex">
                  <button
                    onClick={() => renameSheet(sheet)}
                    className="cursor-pointer p-0.5 text-text-light hover:text-text"
                    title="Ubah nama"
                  >
                    <Pencil className="size-3" />
                  </button>
                  <button
                    onClick={() => removeSheet(sheet)}
                    className="cursor-pointer p-0.5 text-text-light hover:text-red"
                    title="Hapus tabel"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
        {canManage && (
          <button
            onClick={createSheet}
            className="m-2 flex cursor-pointer items-center gap-1.5 rounded-[var(--r-sm)] px-2 py-1.5 text-[12px] font-semibold text-text-muted hover:bg-bg-hover hover:text-text"
          >
            <Plus className="size-3.5" /> Tabel Baru
          </button>
        )}
      </aside>

      {/* Konten tabel aktif */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Toolbar Analisis */}
        <div className="flex h-11 min-h-11 items-center gap-2 border-b border-border-soft bg-bg px-3">
          {/* Pemilih tabel di mobile */}
          <select
            className="field-select h-7 w-auto max-w-[140px] cursor-pointer text-[12px] md:hidden"
            value={activeSheet?.id ?? ""}
            onChange={(e) => store.selectSheet(e.target.value)}
          >
            {sheets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <span className="hidden text-[12px] text-text-muted sm:inline">
            Rentang:
          </span>
          <select
            className="field-select h-7 w-auto cursor-pointer text-[12px]"
            value={range}
            onChange={(e) => setRange(e.target.value as DataRange)}
            title="Rentang waktu untuk grafik, sparkline, statistik Min/Rata/Maks, dan panel yang dibuat dari seleksi. Maksimal 24 jam — di atas itu nilai mentahnya sudah dibuang."
          >
            {DATA_RANGES.map((r) => (
              <option key={r} value={r}>
                {RANGE_LABELS[r]} terakhir
              </option>
            ))}
          </select>
          <div className="flex-1" />
          {canManage && (
            <>
              <button
                onClick={() => setShowMonitor(true)}
                className="btn btn-ghost btn-sm gap-1.5"
                title="Lihat isi terakhir tiap topik MQTT — sumber nama untuk kolom Field"
              >
                <RadioTower className="size-3.5" />
                <span className="hidden sm:inline">Pemantau Topik</span>
              </button>
              <button
                onClick={() => setShowImport(true)}
                disabled={!activeSheet}
                className="btn btn-ghost btn-sm gap-1.5"
                title="Buat banyak sensor sekaligus dari daftar CSV"
              >
                <FileUp className="size-3.5" />
                <span className="hidden sm:inline">Impor Sensor</span>
              </button>
              <button
                onClick={() => store.setShowManageSites(true)}
                className="btn btn-ghost btn-sm gap-1.5"
                title="Kelola broker MQTT (site)"
              >
                <Server className="size-3.5" />
                <span className="hidden sm:inline">Kelola Site</span>
              </button>
              <button
                onClick={() => setShowAlarmSettings(true)}
                className="btn btn-ghost btn-sm gap-1.5"
                title="Pengaturan notifikasi alarm (email/Telegram)"
              >
                <BellRing className="size-3.5" />
                <span className="hidden sm:inline">Notifikasi Alarm</span>
              </button>
            </>
          )}
        </div>

        {/* Action bar seleksi */}
        {nSel > 0 && canEdit && (
          <div className="flex items-center gap-2 border-b border-primary/30 bg-primary/5 px-4 py-1.5">
            <span className="text-[12px] font-semibold text-text">{nSel} tag dipilih</span>
            <div className="flex-1" />
            <button
              onClick={() => spawnPanel("chart")}
              disabled={nSel > 4}
              className="btn btn-secondary btn-sm gap-1.5"
              title={nSel > 4 ? "Grafik maksimal 4 tag" : undefined}
            >
              <TrendingUp className="size-3.5" /> Buat Grafik
            </button>
            <button
              onClick={() => spawnPanel("gauge")}
              disabled={nSel !== 1}
              className="btn btn-secondary btn-sm gap-1.5"
              title={nSel !== 1 ? "Gauge untuk satu tag" : undefined}
            >
              <GaugeIcon className="size-3.5" /> Buat Gauge
            </button>
            <button
              onClick={() => spawnPanel("bar")}
              disabled={nSel < 2 || nSel > 8}
              className="btn btn-secondary btn-sm gap-1.5"
              title={
                nSel < 2
                  ? "Perbandingan butuh minimal 2 tag"
                  : nSel > 8
                    ? "Bar maksimal 8 tag"
                    : undefined
              }
            >
              <BarChart3 className="size-3.5" /> Buat Bar
            </button>
            <button
              onClick={() => setExportTags(selectedTags)}
              className="btn btn-secondary btn-sm gap-1.5"
              title="Unduh data sensor terpilih sebagai CSV"
            >
              <Download className="size-3.5" /> Export Data
            </button>
            <button onClick={() => setSelected(new Set())} className="btn btn-ghost btn-sm">
              Batal
            </button>
          </div>
        )}

        {/* Grid */}
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[900px] border-collapse text-[12.5px]">
            <thead className="sticky top-0 z-10 bg-bg-sidebar shadow-[0_1px_0_var(--rein-border-soft)]">
              <tr>
                <th className={cn(thBase, "w-8 pl-3")}>
                  <input
                    type="checkbox"
                    className="accent-[var(--rein-primary)]"
                    checked={nSel > 0 && nSel === tags.length}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked ? new Set(tags.map((t) => t.id)) : new Set()
                      )
                    }
                  />
                </th>
                <th className={thSortable} onClick={() => toggleSort("label")}>
                  Nama {sortMark("label")}
                </th>
                <th className={thSortable} onClick={() => toggleSort("device_key")}>
                  <span title="Nama nilai ini di sumbernya — dipakai untuk mengambil satu nilai dari topik yang membawa banyak nilai sekaligus">
                    Perangkat
                  </span>{" "}
                  {sortMark("device_key")}
                </th>
                <th className={thBase}>Sumber</th>
                <th className={thSortable} onClick={() => toggleSort("unit")}>
                  Unit {sortMark("unit")}
                </th>
                <th className={cn(thSortable, "text-right")} onClick={() => toggleSort("terkini")}>
                  Terkini {sortMark("terkini")}
                </th>
                <th className={thBase}>Online</th>
                <th className={thBase}>Grafik</th>
                <th className={cn(thBase, "w-8")} title="Detail & pengaturan penyimpanan" />
                {canManage && <th className={cn(thBase, "w-8 pr-3")} />}
              </tr>
            </thead>
            <tbody>
              {pageRows.map(({ tag, last, lastSeenMs, online, sparkStatus }) => (
                <Fragment key={tag.id}>
                  <tr
                    className={cn(
                      "group border-t border-border-soft hover:bg-bg-hover",
                      !tag.enabled && "opacity-50"
                    )}
                  >
                    <td className="w-8 py-1.5 pl-3">
                      <input
                        type="checkbox"
                        className="accent-[var(--rein-primary)]"
                        checked={selected.has(tag.id)}
                        onChange={() =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (next.has(tag.id)) next.delete(tag.id);
                            else next.add(tag.id);
                            return next;
                          })
                        }
                      />
                    </td>
                    {/* Nama: teks = buka drawer Riwayat; pensil = edit inline */}
                    {editingCell?.tagId === tag.id && editingCell.field === "label" ? (
                      <EditableCell value={tag.label} {...cellEditorProps(tag, "label", tag.label)} />
                    ) : (
                      <td className="px-2 py-1.5">
                        <span className="flex items-center gap-1">
                          <button
                            onClick={() => setDrawerTag(tag)}
                            className="cursor-pointer truncate text-left font-medium text-text hover:text-primary hover:underline"
                            title="Lihat riwayat data"
                          >
                            {tag.label}
                          </button>
                          {canManage && (
                            <button
                              onClick={() =>
                                setEditingCell({ tagId: tag.id, field: "label", value: tag.label })
                              }
                              className="shrink-0 cursor-pointer p-0.5 text-text-light opacity-0 hover:text-text group-hover:opacity-100"
                              title="Ubah nama"
                            >
                              <Pencil className="size-3" />
                            </button>
                          )}
                        </span>
                      </td>
                    )}
                    <EditableCell
                      value={tag.device_key}
                      {...cellEditorProps(tag, "device_key", tag.device_key)}
                      className="font-mono text-[11px] text-text-muted"
                    />
                    {/* Sumber: "data diambil melalui apa" — klik untuk mengatur.
                        Dulu ini membuka drawer terpisah yang justru menutupi
                        baris yang sedang diatur; sekarang ia membuka baris
                        detailnya, tempat Sumber sekarang tinggal. */}
                    <td className="px-2 py-1.5">
                      {canManage ? (
                        <button
                          onClick={() =>
                            setExpandedTagId((cur) =>
                              cur === tag.id ? null : tag.id
                            )
                          }
                          className={cn(
                            "flex max-w-[190px] cursor-pointer items-center gap-1 rounded-[var(--r-sm)] border px-1.5 py-0.5 text-[11px] font-medium",
                            tag.source === "mqtt"
                              ? "border-primary/40 bg-primary/5 text-text"
                              : "border-border-soft text-text-muted hover:border-border hover:text-text"
                          )}
                          title="Atur sumber data (Node-RED) — membuka baris detail"
                        >
                          <span className="truncate">{sourceLabel(tag)}</span>
                        </button>
                      ) : (
                        <span className="text-[11.5px] text-text-muted">
                          {sourceLabel(tag)}
                        </span>
                      )}
                    </td>
                    <EditableCell
                      value={tag.unit}
                      {...cellEditorProps(tag, "unit", tag.unit)}
                      className="text-text-muted"
                    />
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-text">
                      {last === null
                        ? "—"
                        : formatValue(last, resolveDecimals(null, tag.config))}
                    </td>
                    {/* Online / last online — pendamping teks untuk warna grafik */}
                    <td className="whitespace-nowrap px-2 py-1.5">
                      {online ? (
                        <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-green">
                          <span className="inline-block size-2 rounded-full bg-green" />
                          Online
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center gap-1.5 text-[11px] text-text-light"
                          title="Terakhir kali sensor mengirim data"
                        >
                          <span className="inline-block size-2 rounded-full border border-border bg-transparent" />
                          {fmtLastSeen(lastSeenMs)}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      {/* Tabel = jendela Rentang (bucketed) + ekor live sesi
                          ini supaya ujungnya bergerak. Selama jendela itu belum
                          tiba → placeholder diam. Sesudah tiba tapi sensornya
                          memang baru (< 2 bucket) → pakai data live saja. */}
                      <TagSparkCell
                        tagId={tag.id}
                        stored={recent[tag.id]}
                        base={sparkMap[tag.id]}
                        pending={sparkLoadedFor !== sparkWindow}
                        status={sparkStatus}
                      />
                    </td>
                    <td className="w-8 py-1.5 text-center">
                      <button
                        onClick={() =>
                          setExpandedTagId((cur) => (cur === tag.id ? null : tag.id))
                        }
                        className="cursor-pointer p-1 text-text-light hover:text-text"
                        title="Detail, pengaturan penyimpanan & grafik 24 jam"
                      >
                        {expandedTagId === tag.id ? (
                          <ChevronDown className="size-4" />
                        ) : (
                          <ChevronRight className="size-4" />
                        )}
                      </button>
                    </td>
                    {canManage && (
                      <td className="w-8 py-1.5 pr-3 text-right">
                        <button
                          onClick={() => removeRow(tag)}
                          className="cursor-pointer p-0.5 text-text-light hover:text-red"
                          title="Hapus baris"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                  {expandedTagId === tag.id && (
                    <TagDetailRow
                      tag={tag}
                      sites={store.sites}
                      settings={store.rnetSettings}
                      range={range}
                      samples={expandedSeriesNewestFirst}
                      sparkStatus={sparkStatus}
                      online={online}
                      loading={recentLoading}
                      canManage={canManage}
                      colSpan={colSpan}
                      onChanged={store.refreshTags}
                      onOpenHistory={() => setDrawerTag(tag)}
                      onExport={() => setExportTags([tag])}
                    />
                  )}
                </Fragment>
              ))}

              {/* "+ Tambah Baris" ala Supabase */}
              {canManage && (
                <tr className="border-t border-border-soft">
                  <td colSpan={colSpan} className="px-3 py-1">
                    <button
                      onClick={addRow}
                      disabled={addingRow || !activeSheet}
                      className="flex cursor-pointer items-center gap-1.5 rounded-[var(--r-sm)] px-2 py-1 text-[12px] font-semibold text-text-muted hover:bg-bg-hover hover:text-text"
                    >
                      {addingRow ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Plus className="size-3.5" />
                      )}
                      Tambah Baris
                    </button>
                  </td>
                </tr>
              )}

              {rows.length === 0 && !canManage && (
                <tr>
                  <td colSpan={colSpan} className="px-4 py-8 text-center text-[12.5px] text-text-muted">
                    Tabel ini belum berisi tag.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pager. Sengaja menghilang saat semuanya muat dalam satu halaman,
            supaya tabel 14 sensor terlihat persis seperti sebelumnya. */}
        {rows.length > pageSize && (
          <div className="flex h-10 min-h-10 items-center gap-2 border-t border-border-soft bg-bg px-3 text-[12px]">
            <span className="text-text-muted">
              {(curPage - 1) * pageSize + 1}–
              {Math.min(curPage * pageSize, rows.length)} dari {rows.length} sensor
            </span>
            <div className="flex-1" />
            <select
              className="field-select h-7 w-auto cursor-pointer text-[12px]"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              title="Sensor per halaman"
            >
              {/* Tidak ada opsi di atas 50: server memberi sparkline maksimal
                  60 tag per permintaan, dan satu halaman harus selalu muat. */}
              {[25, 50].map((n) => (
                <option key={n} value={n}>
                  {n} / halaman
                </option>
              ))}
            </select>
            <button
              onClick={() => setPage(Math.max(1, curPage - 1))}
              disabled={curPage <= 1}
              className="btn btn-ghost btn-sm"
            >
              Sebelumnya
            </button>
            <span className="tabular-nums text-text-muted">
              {curPage} / {totalPages}
            </span>
            <button
              onClick={() => setPage(Math.min(totalPages, curPage + 1))}
              disabled={curPage >= totalPages}
              className="btn btn-ghost btn-sm"
            >
              Berikutnya
            </button>
          </div>
        )}
      </div>

      {drawerTag && <RiwayatView tag={drawerTag} onClose={closeRiwayat} />}
      {store.showManageSites && (
        <ManageSitesDialog
          sites={store.sites}
          onChanged={store.refreshSites}
          onClose={() => store.setShowManageSites(false)}
        />
      )}
      {showAlarmSettings && (
        <AlarmSettingsDialog onClose={() => setShowAlarmSettings(false)} />
      )}
      {showMonitor && <TopicMonitorDialog onClose={() => setShowMonitor(false)} />}
      {showImport && activeSheet && (
        <ImportTagsDialog
          sheetId={activeSheet.id}
          sites={store.sites}
          onImported={store.refreshTags}
          onClose={() => setShowImport(false)}
        />
      )}
      {exportTags && activeSheet && (
        <ExportRangeDialog
          tags={exportTags}
          sheetName={exportTags.length === 1 ? exportTags[0].label : activeSheet.name}
          onClose={() => setExportTags(null)}
        />
      )}
    </div>
  );
}

function EditableCell({
  value,
  canEdit,
  editing,
  editValue,
  onStart,
  onChange,
  onCommit,
  onCancel,
  className,
}: {
  value: string;
  canEdit: boolean;
  editing: boolean;
  editValue: string;
  onStart: () => void;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  className?: string;
}) {
  if (editing) {
    return (
      <td className="px-2 py-1">
        <input
          autoFocus
          className="field-input h-7 w-full min-w-20 text-[12.5px]"
          value={editValue}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onCommit}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommit();
            if (e.key === "Escape") onCancel();
          }}
        />
      </td>
    );
  }
  return (
    <td
      className={cn("px-2 py-1.5", canEdit && "cursor-text hover:bg-bg-sel/50", className)}
      onClick={canEdit ? onStart : undefined}
      title={canEdit ? "Klik untuk mengubah" : undefined}
    >
      {value || <span className="text-text-light">—</span>}
    </td>
  );
}
