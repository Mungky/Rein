"use client";

/** Analisis (tab "Data") — Table Editor ala Supabase.
 *  Rail kiri = daftar "Tabel" (sheet); kanan = grid: satu baris per sensor
 *  dengan nilai live, status Online, grafik mini 100 data terakhir, dan baris
 *  detail (expand) berisi pengaturan penyimpanan + daftar data mentah.
 *  Seleksi baris melahirkan panel Grafik/Gauge/Bar di mode Monitor, plus
 *  Export Data berjangka (hari/minggu/bulan/semua). */

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  BellRing,
  ChevronDown,
  ChevronRight,
  Download,
  Gauge as GaugeIcon,
  Loader2,
  Pencil,
  Plus,
  Server,
  Table2,
  TrendingUp,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { scadaApi } from "@/lib/api/scada";
import type { ChartRange, Panel, RecentSample, Sheet, Tag } from "../types";
import { useScadaStore } from "../store";
import { RANGE_LABELS } from "../panels/chart-panel";
import { usePanelRefresh } from "../panels/use-panel-refresh";
import { HistoryDrawer } from "./history-drawer";
import { SourceDialog } from "./source-dialog";
import { ManageSitesDialog } from "../manage-sites-dialog";
import { AlarmSettingsDialog } from "./alarm-settings-dialog";
import { ExportRangeDialog } from "./export-range-dialog";
import { TagDetailRow } from "./tag-detail-row";
import { TagSparkline, type SparkStatus } from "./tag-sparkline";

type SortKey = "label" | "device_key" | "unit" | "terkini";

type CellField = "label" | "unit" | "device_key";

interface Row {
  tag: Tag;
  /** Live value (seeded from scada_tag_latest, ticked by Realtime). */
  last: number | null;
  lastSeenMs: number | null;
  online: boolean;
  sparkStatus: SparkStatus;
  /** Ascending series for the sparkline (stored samples + live point). */
  series: RecentSample[];
}

function bounds(tag: Tag): { min: number | null; max: number | null } {
  const cfg = tag.config as Record<string, unknown>;
  const num = (v: unknown) =>
    v === undefined || v === null || v === "" || !Number.isFinite(Number(v))
      ? null
      : Number(v);
  return { min: num(cfg.alarm_min), max: num(cfg.alarm_max) };
}

/** Same silence window as the backend alarm engine: ring tags 60 s flat,
 *  interval tags 3× interval with a 60 s floor. */
function offlineAfterMs(tag: Tag): number {
  const cfg = tag.config as Record<string, unknown>;
  if (!cfg.store_enabled) return 60_000;
  const interval = Number(cfg.storage_interval_s) || 60;
  return Math.max(3 * interval, 60) * 1000;
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

  const [range, setRange] = useState<ChartRange>("24h");
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
  const [sourceTag, setSourceTag] = useState<Tag | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [addingRow, setAddingRow] = useState(false);
  const [showAlarmSettings, setShowAlarmSettings] = useState(false);

  // 100 data terakhir per tag — feeds the sparkline AND the detail dropdown.
  // Refreshed on the shared panel cadence + the manual refresh button (nonce).
  const [recent, setRecent] = useState<Record<string, RecentSample[]>>({});
  const [recentLoading, setRecentLoading] = useState(false);
  const tagIdsKey = useMemo(() => tags.map((t) => t.id).join(","), [tags]);

  const loadRecent = useCallback(async () => {
    if (tagIdsKey === "") return;
    setRecentLoading(true);
    try {
      const ids = tagIdsKey.split(",");
      const results = await Promise.all(
        ids.map((id) =>
          scadaApi
            .getRecentSamples(id, 100)
            .then((res) => [id, res.items] as const)
            .catch(() => [id, []] as const)
        )
      );
      setRecent(Object.fromEntries(results));
    } finally {
      setRecentLoading(false);
    }
  }, [tagIdsKey]);

  usePanelRefresh(loadRecent);

  // Manual refresh (tombol di samping lonceng) re-pulls the raw lists too
  useEffect(() => {
    if (store.dataRefreshNonce === 0) return;
    const t = setTimeout(() => void loadRecent(), 0);
    return () => clearTimeout(t);
  }, [store.dataRefreshNonce, loadRecent]);

  // Wall-clock for Online/last-online aging: held in STATE (never Date.now()
  // in render — purity rule) and refreshed every 10 s.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setNowMs(Date.now());
    const first = setTimeout(update, 0);
    const t = setInterval(update, 10_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);

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
        lastSeenMs !== null && now - lastSeenMs < offlineAfterMs(tag);

      // Series = stored samples (asc) + every SESSION-buffered live point
      // newer than the newest stored row → the chart & data list tick in
      // realtime between refetches, no refresh needed.
      const series = [...stored].reverse();
      const buffer = store.liveBuffers[tag.id] ?? [];
      for (const p of buffer) {
        if (newestStoredMs === null || new Date(p.ts).getTime() > newestStoredMs) {
          series.push({ ts: p.ts, value: p.value });
        }
      }
      if (series.length > 100) series.splice(0, series.length - 100);

      const b = bounds(tag);
      let sparkStatus: SparkStatus = "normal";
      if (!online) sparkStatus = "offline";
      else if (last !== null && b.max !== null && last > b.max) sparkStatus = "high";
      else if (last !== null && b.min !== null && last < b.min) sparkStatus = "low";

      return { tag, last, lastSeenMs, online, sparkStatus, series };
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
  }, [tags, store.liveValues, store.liveBuffers, recent, sortKey, sortDir, nowMs]);

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
      await Promise.all([store.refreshSheets(), store.refreshColumns()]);
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
        device_key: "DEV-01",
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
      const topic = String((tag.config as Record<string, unknown>).mqtt_topic ?? "");
      const short = topic.split("/").pop() || topic;
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
        config: { tag_id: ids[0], warning: null, critical: null, direction: "above" },
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
      await store.addPanelToActive(panel);
      toast.success(`Panel ditambahkan ke "${active.name}" — lihat di mode Monitor`);
      setSelected(new Set());
    } catch {
      toast.error("Gagal menambahkan panel");
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
            Rentang panel:
          </span>
          <select
            className="field-select h-7 w-auto cursor-pointer text-[12px]"
            value={range}
            onChange={(e) => setRange(e.target.value as ChartRange)}
            title="Rentang waktu untuk panel Grafik/Bar yang dibuat dari seleksi"
          >
            {(Object.keys(RANGE_LABELS) as ChartRange[]).map((r) => (
              <option key={r} value={r}>
                {RANGE_LABELS[r]} terakhir
              </option>
            ))}
          </select>
          <div className="flex-1" />
          {canManage && (
            <>
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
              onClick={() => setShowExport(true)}
              className="btn btn-secondary btn-sm gap-1.5"
              title="Unduh data sensor terpilih sebagai Excel"
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
                  Perangkat {sortMark("device_key")}
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
              {rows.map(({ tag, last, lastSeenMs, online, sparkStatus, series }) => (
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
                    {/* Sumber: "data diambil melalui apa" — klik untuk mengatur */}
                    <td className="px-2 py-1.5">
                      {canManage ? (
                        <button
                          onClick={() => setSourceTag(tag)}
                          className={cn(
                            "flex max-w-[190px] cursor-pointer items-center gap-1 rounded-[var(--r-sm)] border px-1.5 py-0.5 text-[11px] font-medium",
                            tag.source === "mqtt"
                              ? "border-primary/40 bg-primary/5 text-text"
                              : "border-border-soft text-text-muted hover:border-border hover:text-text"
                          )}
                          title="Atur sumber data (Node-RED)"
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
                      {last === null ? "—" : last.toLocaleString("id")}
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
                      {/* Tabel = 50 titik terakhir; versi 100 titik ada di dropdown */}
                      <TagSparkline samples={series.slice(-50)} status={sparkStatus} />
                    </td>
                    <td className="w-8 py-1.5 text-center">
                      <button
                        onClick={() =>
                          setExpandedTagId((cur) => (cur === tag.id ? null : tag.id))
                        }
                        className="cursor-pointer p-1 text-text-light hover:text-text"
                        title="Detail, pengaturan penyimpanan & 100 data terakhir"
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
                      samples={[...series].reverse()}
                      sparkStatus={sparkStatus}
                      online={online}
                      loading={recentLoading}
                      canManage={canManage}
                      colSpan={colSpan}
                      onChanged={store.refreshTags}
                      onOpenSource={canManage ? () => setSourceTag(tag) : undefined}
                      onOpenHistory={() => setDrawerTag(tag)}
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
      </div>

      {drawerTag && <HistoryDrawer tag={drawerTag} onClose={() => setDrawerTag(null)} />}
      {sourceTag && (
        <SourceDialog
          tag={sourceTag}
          sites={store.sites}
          onSaved={store.refreshTags}
          onClose={() => setSourceTag(null)}
        />
      )}
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
      {showExport && activeSheet && (
        <ExportRangeDialog
          tags={selectedTags.length > 0 ? selectedTags : tags}
          sheetName={activeSheet.name}
          onClose={() => setShowExport(false)}
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
