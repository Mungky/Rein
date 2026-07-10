/** Zustand store for the R-Net module.
 *
 *  Edit mode works on `draftPanels` (a copy of the active perspective's
 *  panels): Simpan persists via PATCH, Batal discards — the saved layout can
 *  never be corrupted by accident, which is the core of "tanpa setup ulang".
 */

import { create } from "zustand";
import { scadaApi } from "@/lib/api/scada";
import type {
  CanvasSize,
  Channel,
  Panel,
  PanelRect,
  Perspective,
  Sheet,
  Site,
  Stream,
  Tag,
  WorkbenchColumn,
} from "./types";
import { DEFAULT_CANVAS } from "./types";

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
  /** TV-style channel registry (halaman Channel). */
  channels: Channel[];
  sites: Site[];
  tags: Tag[];
  loading: boolean;
  loadError: string | null;

  /** One panel expanded to fill the whole wall area (CCTV-style maximize). */
  maximizedPanelId: string | null;

  /** "monitor" = panel wall, "channels" = channel registry,
   *  "analysis" = Excel-like tag workbench (tab "Data") */
  viewMode: "monitor" | "channels" | "analysis";
  sheets: Sheet[];
  activeSheetId: string | null;
  workbenchColumns: WorkbenchColumn[];
  /** tag_id → freshest sample, fed by the Supabase Realtime hook */
  liveValues: Record<string, LiveValue>;
  /** Bumped by "Segarkan Stream" to force every VideoPanel to tear down and
   *  reconnect — needed after start-scada rotates the tunnel URL, even if a
   *  stream's hls_url string happens to be unchanged. */
  streamReconnectNonce: number;

  /** True when an admin-published default layout exists (Masalah D). Gates the
   *  "Kembalikan ke Bawaan Admin" action for everyone. */
  publishedExists: boolean;

  editMode: boolean;
  draftPanels: Panel[] | null;
  /** Canvas resolution being edited (layout v2 — OBS-style fixed canvas). */
  draftCanvas: CanvasSize | null;

  showAddPanel: boolean;
  showManageStreams: boolean;
  showManageSites: boolean;

  loadAll: () => Promise<void>;
  selectPerspective: (id: string) => void;
  enterEdit: () => void;
  cancelEdit: () => void;
  /** Move/resize one draft panel (canvas px). */
  updatePanelRect: (id: string, rect: PanelRect) => void;
  /** Replace every draft panel's rect at once (quick-split presets). */
  applyPresetRects: (rects: PanelRect[]) => void;
  /** Change the draft canvas resolution, scaling rects proportionally. */
  setDraftCanvas: (canvas: CanvasSize) => void;
  addPanel: (panel: Panel) => void;
  removePanel: (panelId: string) => void;
  /** Merge a patch into one draft panel — used for in-place editing (e.g.
   *  changing a Video Wall's grid/channels without deleting & re-adding it). */
  updatePanel: (
    panelId: string,
    patch: { title?: string; config?: Panel["config"] }
  ) => void;
  /** Persist one panel's change straight to the ACTIVE perspective (no draft,
   *  no Simpan) — used to tweak a Video Wall outside layout edit-mode. Silently
   *  no-ops on the read-only admin default. */
  updateActivePanelPersist: (
    panelId: string,
    patch: { title?: string; config?: Panel["config"] }
  ) => Promise<void>;
  save: () => Promise<void>;
  saveAs: (name: string) => Promise<void>;
  /** Create a fresh, empty page (perspective) and drop straight into edit mode. */
  newPage: (name: string) => Promise<void>;
  /** Rename a page (perspective). */
  renamePage: (id: string, name: string) => Promise<void>;
  setDefault: (id: string) => Promise<void>;
  /** Publish the given perspective as THE admin default (scada:manage). */
  publishLayout: (id: string) => Promise<void>;
  /** Remove admin-default status from the given perspective (scada:manage). */
  unpublishLayout: (id: string) => Promise<void>;
  /** Overwrite the active perspective with the current admin default layout. */
  resetToDefault: () => Promise<void>;
  deletePerspective: (id: string) => Promise<void>;
  refreshStreams: () => Promise<void>;
  /** Re-fetch streams from the DB AND force all video players to reconnect. */
  reconnectStreams: () => Promise<void>;
  refreshChannels: () => Promise<void>;
  refreshSites: () => Promise<void>;
  refreshTags: () => Promise<void>;
  refreshColumns: () => Promise<void>;
  refreshSheets: () => Promise<void>;
  selectSheet: (id: string) => void;
  setViewMode: (v: "monitor" | "channels" | "analysis") => void;
  setMaximizedPanel: (id: string | null) => void;
  setLiveValue: (tagId: string, value: LiveValue) => void;
  /** Append a panel to the active perspective and persist immediately —
   *  used by the Analisis action bar ("Buat Grafik/Gauge/Bar"). */
  addPanelToActive: (panel: Panel) => Promise<void>;
  setShowAddPanel: (v: boolean) => void;
  setShowManageStreams: (v: boolean) => void;
  setShowManageSites: (v: boolean) => void;
}

function pickActive(perspectives: Perspective[]): string | null {
  if (perspectives.length === 0) return null;
  const lastId =
    typeof window !== "undefined"
      ? window.localStorage.getItem(LAST_PERSPECTIVE_KEY)
      : null;
  if (lastId && perspectives.some((p) => p.id === lastId)) return lastId;
  // With no explicit choice, land everyone on the admin default (Masalah D) so
  // publishing a layout is immediately visible to all users, then their own
  // default, then the first.
  const adminDefault = perspectives.find((p) => p.read_only);
  if (adminDefault) return adminDefault.id;
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
  channels: [],
  sites: [],
  tags: [],
  loading: true,
  loadError: null,
  maximizedPanelId: null,

  viewMode: "monitor",
  sheets: [],
  activeSheetId: null,
  workbenchColumns: [],
  liveValues: {},
  streamReconnectNonce: 0,
  publishedExists: false,

  editMode: false,
  draftPanels: null,
  draftCanvas: null,

  showAddPanel: false,
  showManageStreams: false,
  showManageSites: false,

  loadAll: async () => {
    set({ loading: true, loadError: null });
    try {
      const [
        perspectivesRes,
        streamsRes,
        channelsRes,
        sitesRes,
        tagsRes,
        columnsRes,
        sheetsRes,
        publishedRes,
      ] = await Promise.all([
        scadaApi.listPerspectives(),
        scadaApi.listStreams(),
        scadaApi.listChannels(),
        scadaApi.listSites(),
        scadaApi.listTags(),
        scadaApi.listColumns(),
        scadaApi.listSheets(),
        scadaApi.getPublishedLayout(),
      ]);
      const perspectives = perspectivesRes.items;
      set({
        perspectives,
        streams: streamsRes.items,
        channels: channelsRes.items,
        sites: sitesRes.items,
        tags: tagsRes.items,
        workbenchColumns: columnsRes.items,
        sheets: sheetsRes.items,
        activeSheetId: pickActiveSheet(sheetsRes.items),
        activePerspectiveId: pickActive(perspectives),
        publishedExists: publishedRes.exists,
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
    set({
      activePerspectiveId: id,
      editMode: false,
      draftPanels: null,
      maximizedPanelId: null,
    });
  },

  enterEdit: () => {
    const { perspectives, activePerspectiveId } = get();
    const active = perspectives.find((p) => p.id === activePerspectiveId);
    if (!active) return;
    // v2 only ("mulai bersih"): legacy grid-only panels are dropped from the
    // draft — saving writes a clean fixed-canvas layout.
    const panels = structuredClone(active.layout.panels).filter((p) => p.rect);
    set({
      editMode: true,
      draftPanels: panels,
      draftCanvas: active.layout.canvas ?? { ...DEFAULT_CANVAS },
      maximizedPanelId: null,
    });
  },

  cancelEdit: () => set({ editMode: false, draftPanels: null, draftCanvas: null }),

  updatePanelRect: (id, rect) => {
    const { draftPanels } = get();
    if (!draftPanels) return;
    set({
      draftPanels: draftPanels.map((p) => (p.id === id ? { ...p, rect } : p)),
    });
  },

  applyPresetRects: (rects) => {
    const { draftPanels } = get();
    if (!draftPanels) return;
    set({
      draftPanels: draftPanels.map((p, i) =>
        rects[i] ? { ...p, rect: rects[i] } : p
      ),
    });
  },

  setDraftCanvas: (canvas) => {
    const { draftCanvas, draftPanels } = get();
    const prev = draftCanvas ?? DEFAULT_CANVAS;
    const fx = canvas.w / prev.w;
    const fy = canvas.h / prev.h;
    set({
      draftCanvas: canvas,
      // Keep the layout proportionally identical on the new resolution.
      draftPanels: (draftPanels ?? []).map((p) =>
        p.rect
          ? {
              ...p,
              rect: {
                x: Math.round(p.rect.x * fx),
                y: Math.round(p.rect.y * fy),
                w: Math.round(p.rect.w * fx),
                h: Math.round(p.rect.h * fy),
              },
            }
          : p
      ),
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

  updatePanel: (panelId, patch) => {
    const { draftPanels } = get();
    if (!draftPanels) return;
    set({
      draftPanels: draftPanels.map((p) =>
        p.id === panelId ? ({ ...p, ...patch } as Panel) : p
      ),
    });
  },

  updateActivePanelPersist: async (panelId, patch) => {
    const { activePerspectiveId, perspectives } = get();
    const active = perspectives.find((p) => p.id === activePerspectiveId);
    if (!active || active.read_only) return;
    const panels = active.layout.panels.map((p) =>
      p.id === panelId ? ({ ...p, ...patch } as Panel) : p
    );
    const layout = { ...active.layout, panels };
    // Optimistic — reflect the change instantly; a reload resyncs if the PATCH
    // below ever fails.
    set({
      perspectives: perspectives.map((p) =>
        p.id === active.id ? { ...p, layout } : p
      ),
    });
    try {
      await scadaApi.updatePerspective(active.id, { layout });
    } catch {
      /* best-effort */
    }
  },

  save: async () => {
    const { activePerspectiveId, draftPanels, draftCanvas, perspectives } = get();
    if (!activePerspectiveId || !draftPanels) return;
    const active = perspectives.find((p) => p.id === activePerspectiveId);
    // The admin default is not the user's to overwrite — save forks it into
    // their own editable copy instead (Masalah D, "user boleh atur ulang").
    if (active?.read_only) {
      await get().saveAs(`${active.name} (salinan)`);
      return;
    }
    const updated = await scadaApi.updatePerspective(activePerspectiveId, {
      layout: {
        version: 2,
        canvas: draftCanvas ?? DEFAULT_CANVAS,
        panels: draftPanels,
      },
    });
    set({
      perspectives: perspectives.map((p) =>
        p.id === updated.id ? updated : p
      ),
      editMode: false,
      draftPanels: null,
      draftCanvas: null,
    });
  },

  saveAs: async (name) => {
    const { draftPanels, draftCanvas, perspectives, activePerspectiveId } = get();
    const active = perspectives.find((p) => p.id === activePerspectiveId);
    const panels = (draftPanels ?? active?.layout.panels ?? []).filter(
      (p) => p.rect
    );
    const created = await scadaApi.createPerspective(name, {
      version: 2,
      canvas: draftCanvas ?? active?.layout.canvas ?? DEFAULT_CANVAS,
      panels,
    });
    window.localStorage.setItem(LAST_PERSPECTIVE_KEY, created.id);
    set({
      perspectives: [...perspectives, created],
      activePerspectiveId: created.id,
      editMode: false,
      draftPanels: null,
      draftCanvas: null,
    });
  },

  newPage: async (name) => {
    const created = await scadaApi.createPerspective(name, {
      version: 2,
      canvas: { ...DEFAULT_CANVAS },
      panels: [],
    });
    window.localStorage.setItem(LAST_PERSPECTIVE_KEY, created.id);
    set({
      perspectives: [...get().perspectives, created],
      activePerspectiveId: created.id,
      editMode: true,
      draftPanels: [],
      draftCanvas: { ...DEFAULT_CANVAS },
    });
  },

  renamePage: async (id, name) => {
    const updated = await scadaApi.updatePerspective(id, { name });
    set({
      perspectives: get().perspectives.map((p) =>
        p.id === updated.id ? updated : p
      ),
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

  publishLayout: async (id) => {
    const updated = await scadaApi.publishPerspective(id);
    // Multi-page bawaan admin: any number of pages can be published at once.
    set({
      perspectives: get().perspectives.map((p) =>
        p.id === updated.id ? updated : p
      ),
      publishedExists: true,
    });
  },

  unpublishLayout: async (id) => {
    const updated = await scadaApi.unpublishPerspective(id);
    const perspectives = get().perspectives.map((p) =>
      p.id === updated.id ? updated : p
    );
    set({
      perspectives,
      publishedExists: perspectives.some((p) => p.is_published || p.read_only),
    });
  },

  resetToDefault: async () => {
    const { activePerspectiveId, perspectives } = get();
    if (!activePerspectiveId) return;
    const updated = await scadaApi.resetPerspectiveToDefault(activePerspectiveId);
    set({
      perspectives: perspectives.map((p) => (p.id === updated.id ? updated : p)),
      editMode: false,
      draftPanels: null,
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

  refreshChannels: async () => {
    const res = await scadaApi.listChannels();
    set({ channels: res.items });
  },

  refreshSites: async () => {
    const res = await scadaApi.listSites();
    set({ sites: res.items });
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

  setViewMode: (v) => set({ viewMode: v, maximizedPanelId: null }),

  setMaximizedPanel: (id) => set({ maximizedPanelId: id }),

  setLiveValue: (tagId, value) =>
    set({ liveValues: { ...get().liveValues, [tagId]: value } }),

  addPanelToActive: async (panel) => {
    const { activePerspectiveId, perspectives } = get();
    const active = perspectives.find((p) => p.id === activePerspectiveId);
    if (!active) throw new Error("Tidak ada perspective aktif");
    const canvas = active.layout.canvas ?? DEFAULT_CANVAS;
    const existing = active.layout.panels.filter((p) => p.rect);
    // Cascade new panels at half-canvas size so they never hide each other.
    const n = existing.length;
    const placed: Panel = {
      ...panel,
      rect: panel.rect ?? {
        x: Math.min(canvas.w / 2, 32 * (n % 10)),
        y: Math.min(canvas.h / 2, 32 * (n % 10)),
        w: Math.round(canvas.w / 2),
        h: Math.round(canvas.h / 2),
      },
    };
    const panels = [...existing, placed];
    const updated = await scadaApi.updatePerspective(active.id, {
      layout: { version: 2, canvas, panels },
    });
    set({
      perspectives: perspectives.map((p) => (p.id === updated.id ? updated : p)),
    });
  },

  setShowAddPanel: (v) => set({ showAddPanel: v }),
  setShowManageStreams: (v) => set({ showManageStreams: v }),
  setShowManageSites: (v) => set({ showManageSites: v }),
}));
