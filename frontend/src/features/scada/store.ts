/** Zustand store for the R-Net module.
 *
 *  Edit mode works on `draftPanels` (a copy of the active perspective's
 *  panels): Simpan persists via PATCH, Batal discards — the saved layout can
 *  never be corrupted by accident, which is the core of "tanpa setup ulang".
 */

import { create } from "zustand";
import { scadaApi } from "@/lib/api/scada";
import type {
  Panel,
  PanelGridPos,
  Perspective,
  Sheet,
  Stream,
  Tag,
  WorkbenchColumn,
} from "./types";

const LAST_PERSPECTIVE_KEY = "scada:last-perspective";
const LAST_SHEET_KEY = "scada:last-sheet";

export interface LiveValue {
  value: number;
  ts: string;
}

interface ScadaState {
  perspectives: Perspective[];
  activePerspectiveId: string | null;
  streams: Stream[];
  tags: Tag[];
  loading: boolean;
  loadError: string | null;

  /** "monitor" = panel wall, "analysis" = Excel-like tag workbench */
  viewMode: "monitor" | "analysis";
  sheets: Sheet[];
  activeSheetId: string | null;
  workbenchColumns: WorkbenchColumn[];
  /** tag_id → freshest sample, fed by the Supabase Realtime hook */
  liveValues: Record<string, LiveValue>;
  /** Bumped by "Segarkan Stream" to force every VideoPanel to tear down and
   *  reconnect — needed after start-scada rotates the tunnel URL, even if a
   *  stream's hls_url string happens to be unchanged. */
  streamReconnectNonce: number;

  editMode: boolean;
  draftPanels: Panel[] | null;

  showAddPanel: boolean;
  showManageStreams: boolean;

  loadAll: () => Promise<void>;
  selectPerspective: (id: string) => void;
  enterEdit: () => void;
  cancelEdit: () => void;
  updateGrid: (positions: { id: string; grid: PanelGridPos }[]) => void;
  addPanel: (panel: Panel) => void;
  removePanel: (panelId: string) => void;
  save: () => Promise<void>;
  saveAs: (name: string) => Promise<void>;
  setDefault: (id: string) => Promise<void>;
  deletePerspective: (id: string) => Promise<void>;
  refreshStreams: () => Promise<void>;
  /** Re-fetch streams from the DB AND force all video players to reconnect. */
  reconnectStreams: () => Promise<void>;
  refreshTags: () => Promise<void>;
  refreshColumns: () => Promise<void>;
  refreshSheets: () => Promise<void>;
  selectSheet: (id: string) => void;
  setViewMode: (v: "monitor" | "analysis") => void;
  setLiveValue: (tagId: string, value: LiveValue) => void;
  /** Append a panel to the active perspective and persist immediately —
   *  used by the Analisis action bar ("Buat Grafik/Gauge/Bar"). */
  addPanelToActive: (panel: Panel) => Promise<void>;
  setShowAddPanel: (v: boolean) => void;
  setShowManageStreams: (v: boolean) => void;
}

function pickActive(perspectives: Perspective[]): string | null {
  if (perspectives.length === 0) return null;
  const lastId =
    typeof window !== "undefined"
      ? window.localStorage.getItem(LAST_PERSPECTIVE_KEY)
      : null;
  if (lastId && perspectives.some((p) => p.id === lastId)) return lastId;
  return (perspectives.find((p) => p.is_default) ?? perspectives[0]).id;
}

function pickActiveSheet(sheets: Sheet[]): string | null {
  if (sheets.length === 0) return null;
  const lastId =
    typeof window !== "undefined"
      ? window.localStorage.getItem(LAST_SHEET_KEY)
      : null;
  if (lastId && sheets.some((s) => s.id === lastId)) return lastId;
  return sheets[0].id;
}

export const useScadaStore = create<ScadaState>((set, get) => ({
  perspectives: [],
  activePerspectiveId: null,
  streams: [],
  tags: [],
  loading: true,
  loadError: null,

  viewMode: "monitor",
  sheets: [],
  activeSheetId: null,
  workbenchColumns: [],
  liveValues: {},
  streamReconnectNonce: 0,

  editMode: false,
  draftPanels: null,

  showAddPanel: false,
  showManageStreams: false,

  loadAll: async () => {
    set({ loading: true, loadError: null });
    try {
      const [perspectivesRes, streamsRes, tagsRes, columnsRes, sheetsRes] =
        await Promise.all([
          scadaApi.listPerspectives(),
          scadaApi.listStreams(),
          scadaApi.listTags(),
          scadaApi.listColumns(),
          scadaApi.listSheets(),
        ]);
      const perspectives = perspectivesRes.items;
      set({
        perspectives,
        streams: streamsRes.items,
        tags: tagsRes.items,
        workbenchColumns: columnsRes.items,
        sheets: sheetsRes.items,
        activeSheetId: pickActiveSheet(sheetsRes.items),
        activePerspectiveId: pickActive(perspectives),
        loading: false,
      });
    } catch {
      set({
        loading: false,
        loadError: "Gagal memuat data R-Net. Coba muat ulang halaman.",
      });
    }
  },

  selectPerspective: (id) => {
    window.localStorage.setItem(LAST_PERSPECTIVE_KEY, id);
    set({ activePerspectiveId: id, editMode: false, draftPanels: null });
  },

  enterEdit: () => {
    const { perspectives, activePerspectiveId } = get();
    const active = perspectives.find((p) => p.id === activePerspectiveId);
    if (!active) return;
    set({
      editMode: true,
      draftPanels: structuredClone(active.layout.panels),
    });
  },

  cancelEdit: () => set({ editMode: false, draftPanels: null }),

  updateGrid: (positions) => {
    const { draftPanels } = get();
    if (!draftPanels) return;
    const byId = new Map(positions.map((p) => [p.id, p.grid]));
    set({
      draftPanels: draftPanels.map((panel) => {
        const grid = byId.get(panel.id);
        return grid ? { ...panel, grid } : panel;
      }),
    });
  },

  addPanel: (panel) => {
    const { draftPanels } = get();
    if (!draftPanels) return;
    set({ draftPanels: [...draftPanels, panel], showAddPanel: false });
  },

  removePanel: (panelId) => {
    const { draftPanels } = get();
    if (!draftPanels) return;
    set({ draftPanels: draftPanels.filter((p) => p.id !== panelId) });
  },

  save: async () => {
    const { activePerspectiveId, draftPanels, perspectives } = get();
    if (!activePerspectiveId || !draftPanels) return;
    const updated = await scadaApi.updatePerspective(activePerspectiveId, {
      layout: { version: 1, panels: draftPanels },
    });
    set({
      perspectives: perspectives.map((p) =>
        p.id === updated.id ? updated : p
      ),
      editMode: false,
      draftPanels: null,
    });
  },

  saveAs: async (name) => {
    const { draftPanels, perspectives, activePerspectiveId } = get();
    const active = perspectives.find((p) => p.id === activePerspectiveId);
    const panels = draftPanels ?? active?.layout.panels ?? [];
    const created = await scadaApi.createPerspective(name, {
      version: 1,
      panels,
    });
    window.localStorage.setItem(LAST_PERSPECTIVE_KEY, created.id);
    set({
      perspectives: [...perspectives, created],
      activePerspectiveId: created.id,
      editMode: false,
      draftPanels: null,
    });
  },

  setDefault: async (id) => {
    const updated = await scadaApi.setDefaultPerspective(id);
    set({
      perspectives: get().perspectives.map((p) =>
        p.id === updated.id ? updated : { ...p, is_default: false }
      ),
    });
  },

  deletePerspective: async (id) => {
    await scadaApi.deletePerspective(id);
    const remaining = get().perspectives.filter((p) => p.id !== id);
    const { activePerspectiveId } = get();
    set({
      perspectives: remaining,
      activePerspectiveId:
        activePerspectiveId === id ? pickActive(remaining) : activePerspectiveId,
      editMode: false,
      draftPanels: null,
    });
  },

  refreshStreams: async () => {
    const res = await scadaApi.listStreams();
    set({ streams: res.items });
  },

  reconnectStreams: async () => {
    const res = await scadaApi.listStreams();
    set({
      streams: res.items,
      streamReconnectNonce: get().streamReconnectNonce + 1,
    });
  },

  refreshTags: async () => {
    const res = await scadaApi.listTags();
    set({ tags: res.items });
  },

  refreshColumns: async () => {
    const res = await scadaApi.listColumns();
    set({ workbenchColumns: res.items });
  },

  refreshSheets: async () => {
    const res = await scadaApi.listSheets();
    const { activeSheetId } = get();
    const stillThere = res.items.some((s) => s.id === activeSheetId);
    set({
      sheets: res.items,
      activeSheetId: stillThere ? activeSheetId : pickActiveSheet(res.items),
    });
  },

  selectSheet: (id) => {
    window.localStorage.setItem(LAST_SHEET_KEY, id);
    set({ activeSheetId: id });
  },

  setViewMode: (v) => set({ viewMode: v }),

  setLiveValue: (tagId, value) =>
    set({ liveValues: { ...get().liveValues, [tagId]: value } }),

  addPanelToActive: async (panel) => {
    const { activePerspectiveId, perspectives } = get();
    const active = perspectives.find((p) => p.id === activePerspectiveId);
    if (!active) throw new Error("Tidak ada perspective aktif");
    const panels = [...active.layout.panels, panel];
    const updated = await scadaApi.updatePerspective(active.id, {
      layout: { version: 1, panels },
    });
    set({
      perspectives: perspectives.map((p) => (p.id === updated.id ? updated : p)),
    });
  },

  setShowAddPanel: (v) => set({ showAddPanel: v }),
  setShowManageStreams: (v) => set({ showManageStreams: v }),
}));
