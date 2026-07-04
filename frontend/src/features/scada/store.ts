/** Zustand store for the SCADA Monitor module.
 *
 *  Edit mode works on `draftPanels` (a copy of the active perspective's
 *  panels): Simpan persists via PATCH, Batal discards — the saved layout can
 *  never be corrupted by accident, which is the core of "tanpa setup ulang".
 */

import { create } from "zustand";
import { scadaApi } from "@/lib/api/scada";
import type { Panel, PanelGridPos, Perspective, Stream } from "./types";

const LAST_PERSPECTIVE_KEY = "scada:last-perspective";

interface ScadaState {
  perspectives: Perspective[];
  activePerspectiveId: string | null;
  streams: Stream[];
  loading: boolean;
  loadError: string | null;

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

export const useScadaStore = create<ScadaState>((set, get) => ({
  perspectives: [],
  activePerspectiveId: null,
  streams: [],
  loading: true,
  loadError: null,

  editMode: false,
  draftPanels: null,

  showAddPanel: false,
  showManageStreams: false,

  loadAll: async () => {
    set({ loading: true, loadError: null });
    try {
      const [perspectivesRes, streamsRes] = await Promise.all([
        scadaApi.listPerspectives(),
        scadaApi.listStreams(),
      ]);
      const perspectives = perspectivesRes.items;
      set({
        perspectives,
        streams: streamsRes.items,
        activePerspectiveId: pickActive(perspectives),
        loading: false,
      });
    } catch {
      set({
        loading: false,
        loadError: "Gagal memuat data SCADA. Coba muat ulang halaman.",
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

  setShowAddPanel: (v) => set({ showAddPanel: v }),
  setShowManageStreams: (v) => set({ showManageStreams: v }),
}));
