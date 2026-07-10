"use client";

/** Analisis — Table Editor ala Supabase/TDengine.
 *  Rail kiri = daftar "Tabel" (sheet); kanan = grid: baris = tag (live via
 *  Supabase Realtime + fallback polling), kolom = built-in stats + kolom
 *  custom per tabel (rumus dihitung parser aman / metadata diketik per sel).
 *  Semua pengelolaan tag terjadi DI SINI (tanpa dialog terpisah); seleksi
 *  baris melahirkan panel Grafik/Gauge/Bar di mode Monitor. */

import { useCallback, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Download,
  Gauge as GaugeIcon,
  Loader2,
  Pencil,
  Plus,
  Server,
  Sigma,
  Table2,
  TrendingUp,
  Trash2,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { scadaApi } from "@/lib/api/scada";
import type {
  ChartRange,
  Panel,
  Sheet,
  SummaryItem,
  Tag,
  WorkbenchColumn,
} from "../types";
import { useScadaStore } from "../store";
import { PRESETS, presetOf } from "../presets";
import { RANGE_LABELS, RANGE_MS } from "../panels/chart-panel";
import { usePanelRefresh } from "../panels/use-panel-refresh";
import { useLiveSamples } from "./use-live-samples";
import { ColumnFormDialog } from "./column-form";
import { HistoryDrawer } from "./history-drawer";
import { SourceDialog } from "./source-dialog";
import { ManageSitesDialog } from "../manage-sites-dialog";
import { exportSheetToExcel } from "./export-excel";
import { compileFormula, evaluateFormula, normalizeRef } from "./formula";

const SUMMARY_CHUNK = 8; // /summary accepts max 8 tags per call

type SortKey =
  | "label"
  | "device_key"
  | "unit"
  | "terkini"
  | "min"
  | "rata"
  | "maks"
  | string; // custom column id

type CellField = "label" | "unit" | "device_key" | `meta:${string}`;

interface Row {
  tag: Tag;
  last: number | null;
  isLive: boolean;
  min: number | null;
  avg: number | null;
  max: number | null;
  /** FORMULA column id → value, null (no data) or "error" (#RUMUS!) */
  formulaValues: Record<string, number | null | "error">;
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
  const columns = useMemo(
    () =>
      store.workbenchColumns
        .filter((c) => c.sheet_id === activeSheet?.id)
        .sort((a, b) => a.position - b.position),
    [store.workbenchColumns, activeSheet?.id]
  );

  const [range, setRange] = useState<ChartRange>("24h");
  const [summary, setSummary] = useState<Record<string, SummaryItem>>({});
  const [sortKey, setSortKey] = useState<SortKey>("label");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingCell, setEditingCell] = useState<{
    tagId: string;
    field: CellField;
    value: string;
  } | null>(null);
  const [columnForm, setColumnForm] = useState<{ column: WorkbenchColumn | null } | null>(null);
  const [drawerTag, setDrawerTag] = useState<Tag | null>(null);
  const [sourceTag, setSourceTag] = useState<Tag | null>(null);
  const [exporting, setExporting] = useState(false);
  const [addingRow, setAddingRow] = useState(false);

  useLiveSamples(true);

  const allTagIds = useMemo(() => store.tags.map((t) => t.id), [store.tags]);
  const load = useCallback(async () => {
    if (allTagIds.length === 0) return;
    try {
      const end = new Date();
      const start = new Date(end.getTime() - RANGE_MS[range]);
      const chunks: string[][] = [];
      for (let i = 0; i < allTagIds.length; i += SUMMARY_CHUNK) {
        chunks.push(allTagIds.slice(i, i + SUMMARY_CHUNK));
      }
      const results = await Promise.all(
        chunks.map((ids) => scadaApi.getSummary(ids, start, end))
      );
      const map: Record<string, SummaryItem> = {};
      for (const res of results) for (const item of res.items) map[item.tag_id] = item;
      setSummary(map);
    } catch {
      // keep the previous snapshot; polling will retry
    }
  }, [allTagIds, range]);

  usePanelRefresh(load);

  const compiled = useMemo(
    () =>
      columns
        .filter((c) => c.kind === "formula")
        .map((col) => {
          try {
            return { col, compiled: compileFormula(col.formula ?? "") };
          } catch {
            return { col, compiled: null };
          }
        }),
    [columns]
  );
  const numberColumns = useMemo(
    () => columns.filter((c) => c.kind === "number"),
    [columns]
  );

  const rows: Row[] = useMemo(() => {
    const built = tags.map((tag) => {
      const s = summary[tag.id];
      const live = store.liveValues[tag.id];
      const liveNewer =
        live && (!s?.last_ts || new Date(live.ts).getTime() > new Date(s.last_ts).getTime());
      const last = liveNewer ? live.value : (s?.last ?? null);

      const vars: Record<string, number | null> = {
        terkini: last,
        min: s?.min ?? null,
        rata: s?.avg ?? null,
        maks: s?.max ?? null,
      };
      // Number-metadata columns are referencable by any formula
      for (const col of numberColumns) {
        const raw = tag.meta?.[col.id];
        const num = raw === undefined || raw === "" ? null : Number(raw);
        vars[normalizeRef(col.name)] = num !== null && Number.isFinite(num) ? num : null;
      }
      const formulaValues: Row["formulaValues"] = {};
      for (const { col, compiled: c } of compiled) {
        if (!c) {
          formulaValues[col.id] = "error";
          continue;
        }
        try {
          const v = evaluateFormula(c, vars);
          formulaValues[col.id] = v;
          vars[normalizeRef(col.name)] = v;
        } catch {
          formulaValues[col.id] = "error";
          vars[normalizeRef(col.name)] = null;
        }
      }
      return {
        tag,
        last,
        isLive: Boolean(liveNewer),
        min: s?.min ?? null,
        avg: s?.avg ?? null,
        max: s?.max ?? null,
        formulaValues,
      };
    });

    const dir = sortDir === "asc" ? 1 : -1;
    const col = columns.find((c) => c.id === sortKey);
    const valueOf = (r: Row): string | number | null => {
      switch (sortKey) {
        case "label": return r.tag.label.toLowerCase();
        case "device_key": return r.tag.device_key.toLowerCase();
        case "unit": return r.tag.unit.toLowerCase();
        case "terkini": return r.last;
        case "min": return r.min;
        case "rata": return r.avg;
        case "maks": return r.max;
        default: {
          if (!col) return null;
          if (col.kind === "formula") {
            const v = r.formulaValues[col.id];
            return v === "error" ? null : (v ?? null);
          }
          const raw = r.tag.meta?.[col.id];
          if (raw === undefined || raw === "") return null;
          return col.kind === "number" ? Number(raw) : String(raw).toLowerCase();
        }
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
  }, [tags, summary, store.liveValues, compiled, numberColumns, columns, sortKey, sortDir]);

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
    if (!window.confirm(`Hapus tabel "${sheet.name}"? Kolom customnya ikut terhapus.`))
      return;
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
      const preset = PRESETS.suhu;
      const tag = await scadaApi.createTag({
        sheet_id: activeSheet.id,
        label: "Tag Baru",
        device_key: "SIM-01",
        unit: preset.unit,
        config: { ...preset.config },
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
      if (field.startsWith("meta:")) {
        const colId = field.slice(5);
        const col = columns.find((c) => c.id === colId);
        let v: string | number = trimmed;
        if (col?.kind === "number" && trimmed !== "") {
          const num = Number(trimmed.replace(",", "."));
          if (!Number.isFinite(num)) {
            toast.error("Isi kolom ini harus angka");
            return;
          }
          v = num;
        }
        const meta = { ...(tag.meta ?? {}) };
        if (trimmed === "") delete meta[colId];
        else meta[colId] = v;
        await scadaApi.updateTag(tagId, { meta });
      } else {
        if (!trimmed && field === "label") return; // nama tidak boleh kosong
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
      return `MQTT · ${site?.name ?? "?"}${short ? ` / ${short}` : ""}`;
    }
    return `Simulator · ${PRESETS[presetOf(tag.config)].label}`;
  }

  async function toggleEnabled(tag: Tag) {
    try {
      await scadaApi.updateTag(tag.id, { enabled: !tag.enabled });
      await store.refreshTags();
    } catch {
      toast.error("Gagal mengubah status tag");
    }
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

  async function removeColumn(col: WorkbenchColumn) {
    if (!window.confirm(`Hapus kolom "${col.name}"?`)) return;
    try {
      await scadaApi.deleteColumn(col.id);
      await store.refreshColumns();
      toast.success("Kolom dihapus");
    } catch {
      toast.error("Gagal menghapus kolom");
    }
  }

  /* ── Spawn panels from selection ── */

  async function spawnPanel(kind: "chart" | "gauge" | "bar") {
    const ids = [...selected];
    const active = store.perspectives.find((p) => p.id === store.activePerspectiveId);
    if (!active) return;
    const firstTag = tags.find((t) => t.id === ids[0]);

    // Placement (rect on the fixed canvas) is handled by addPanelToActive.
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

  async function handleExport() {
    if (!activeSheet || rows.length === 0) return;
    setExporting(true);
    try {
      await exportSheetToExcel({
        sheetName: activeSheet.name,
        rows: rows.map((r) => ({
          tag: r.tag,
          last: r.last,
          min: r.min,
          avg: r.avg,
          max: r.max,
          custom: Object.fromEntries(
            columns.map((c) => {
              if (c.kind === "formula") {
                const v = r.formulaValues[c.id];
                return [c.id, v === "error" ? "#RUMUS!" : (v ?? null)];
              }
              return [c.id, r.tag.meta?.[c.id] ?? null];
            })
          ),
        })),
        columns,
        range,
      });
    } catch {
      toast.error("Gagal membuat file Excel");
    } finally {
      setExporting(false);
    }
  }

  /* ── Render ── */

  const nSel = selected.size;
  const thBase =
    "px-2 py-2 text-left text-[10.5px] font-semibold uppercase tracking-wide text-text-light select-none";
  const thSortable = cn(thBase, "cursor-pointer hover:text-text-muted");

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
      const textual =
        key === "label" || key === "device_key" || key === "unit" ||
        columns.find((c) => c.id === key)?.kind === "text";
      setSortDir(textual ? "asc" : "desc");
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
          <span className="hidden text-[12px] text-text-muted sm:inline">Statistik:</span>
          <select
            className="field-select h-7 w-auto cursor-pointer text-[12px]"
            value={range}
            onChange={(e) => setRange(e.target.value as ChartRange)}
          >
            {(Object.keys(RANGE_LABELS) as ChartRange[]).map((r) => (
              <option key={r} value={r}>
                {RANGE_LABELS[r]} terakhir
              </option>
            ))}
          </select>
          <div className="flex-1" />
          <button
            onClick={handleExport}
            disabled={exporting || rows.length === 0}
            className="btn btn-ghost btn-sm gap-1.5"
          >
            {exporting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Download className="size-3.5" />
            )}
            <span className="hidden sm:inline">Export Excel</span>
          </button>
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
                onClick={() => setColumnForm({ column: null })}
                className="btn btn-secondary btn-sm gap-1.5"
              >
                <Sigma className="size-3.5" />
                <span className="hidden sm:inline">Tambah Kolom</span>
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
            <button onClick={() => setSelected(new Set())} className="btn btn-ghost btn-sm">
              Batal
            </button>
          </div>
        )}

        {/* Grid */}
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[860px] border-collapse text-[12.5px]">
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
                <th className={cn(thSortable, "text-right")} onClick={() => toggleSort("min")}>
                  Min {sortMark("min")}
                </th>
                <th className={cn(thSortable, "text-right")} onClick={() => toggleSort("rata")}>
                  Rata² {sortMark("rata")}
                </th>
                <th className={cn(thSortable, "text-right")} onClick={() => toggleSort("maks")}>
                  Maks {sortMark("maks")}
                </th>
                {columns.map((col) => (
                  <th
                    key={col.id}
                    className={cn(
                      thSortable,
                      "whitespace-nowrap",
                      col.kind !== "text" && "text-right"
                    )}
                    onClick={() => toggleSort(col.id)}
                    title={col.kind === "formula" ? `= ${col.formula}` : "Kolom metadata"}
                  >
                    {col.kind === "formula" && <span className="text-primary">ƒ </span>}
                    {col.name}
                    {col.unit ? ` (${col.unit})` : ""} {sortMark(col.id)}
                    {canManage && (
                      <span className="ml-1 inline-flex gap-0.5 align-middle">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setColumnForm({ column: col });
                          }}
                          className="cursor-pointer text-text-light hover:text-text"
                          title="Ubah kolom"
                        >
                          <Pencil className="size-3" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void removeColumn(col);
                          }}
                          className="cursor-pointer text-text-light hover:text-red"
                          title="Hapus kolom"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </span>
                    )}
                  </th>
                ))}
                <th className={cn(thBase, "w-14 text-center")}>Aktif</th>
                {canManage && <th className={cn(thBase, "w-8 pr-3")} />}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ tag, last, isLive, min, avg, max, formulaValues }) => (
                <tr
                  key={tag.id}
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
                        title="Atur sumber data (Simulator / MQTT)"
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
                    {isLive && (
                      <Zap className="mr-0.5 inline size-3 text-green" aria-label="Live" />
                    )}
                    {fmtNum(last)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-text-muted">
                    {fmtNum(min)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-text-muted">
                    {fmtNum(avg)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-text-muted">
                    {fmtNum(max)}
                  </td>
                  {columns.map((col) => {
                    if (col.kind === "formula") {
                      const v = formulaValues[col.id];
                      return (
                        <td
                          key={col.id}
                          className={cn(
                            "px-2 py-1.5 text-right tabular-nums",
                            v === "error" ? "font-semibold text-red" : "text-text"
                          )}
                        >
                          {v === "error"
                            ? "#RUMUS!"
                            : v === null || v === undefined
                              ? "—"
                              : v.toLocaleString("id", { maximumFractionDigits: col.decimals })}
                        </td>
                      );
                    }
                    const raw = tag.meta?.[col.id];
                    const display =
                      raw === undefined || raw === ""
                        ? ""
                        : col.kind === "number"
                          ? Number(raw).toLocaleString("id", {
                              maximumFractionDigits: col.decimals,
                            })
                          : String(raw);
                    return (
                      <EditableCell
                        key={col.id}
                        value={display}
                        {...cellEditorProps(tag, `meta:${col.id}`, raw === undefined ? "" : String(raw))}
                        className={cn(
                          "text-text",
                          col.kind === "number" && "text-right tabular-nums"
                        )}
                      />
                    );
                  })}
                  <td className="w-14 py-1.5 text-center">
                    <button
                      onClick={() => canManage && toggleEnabled(tag)}
                      disabled={!canManage}
                      className={cn(
                        "inline-block size-3.5 rounded-full border-2",
                        tag.enabled ? "border-green bg-green" : "border-border bg-transparent",
                        canManage && "cursor-pointer"
                      )}
                      title={
                        tag.enabled
                          ? "Aktif — klik untuk nonaktifkan"
                          : "Nonaktif — klik untuk aktifkan"
                      }
                    />
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
              ))}

              {/* "+ Tambah Baris" ala Supabase */}
              {canManage && (
                <tr className="border-t border-border-soft">
                  <td colSpan={11 + columns.length} className="px-3 py-1">
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
                  <td colSpan={10 + columns.length} className="px-4 py-8 text-center text-[12.5px] text-text-muted"
                  >
                    Tabel ini belum berisi tag.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {columnForm && activeSheet && (
        <ColumnFormDialog
          column={columnForm.column}
          columns={columns}
          sheetId={activeSheet.id}
          onChanged={store.refreshColumns}
          onClose={() => setColumnForm(null)}
        />
      )}
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
    </div>
  );
}

function fmtNum(v: number | null): string {
  return v === null ? "—" : v.toLocaleString("id");
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
