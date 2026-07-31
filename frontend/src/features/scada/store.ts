/** Zustand store for the R-Net module.
 *
 *  Edit mode works on `draftPanels` (a copy of the active perspective's
 *  panels): Simpan persists via PATCH, Batal discards — the saved layout can
 *  never be corrupted by accident, which is the core of "tanpa setup ulang".
 */

import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { scadaApi } from "@/lib/api/scada";
import { fetchLatestInChunks } from "./fetch-latest";
import type {
  AlarmEvent,
  CanvasSize,
  Channel,
  Panel,
  PanelRect,
  Perspective,
  RnetSettings,
  Sheet,
  Site,
  Stream,
  Tag,
} from "./types";
import { DEFAULT_CANVAS } from "./types";
import { samplingIntervalMs } from "./sampling";

const LAST_PERSPECTIVE_KEY = "scada:last-perspective";
const LAST_SHEET_KEY = "scada:last-sheet";

/** Titik live per tag yang disimpan di memori sesi — ekor hidup grafik. */
const LIVE_BUFFER_CAP = 400;

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
  /** Admin-tunable sampling-level durations + retention knobs, fetched once at
   *  bootstrap. NULL while loading, or if the fetch failed — every consumer
   *  falls back to DEFAULT_LEVEL_SECONDS, so this is never load-bearing. */
  rnetSettings: RnetSettings | null;
  loading: boolean;
  loadError: string | null;

  /** One panel expanded to fill the whole wall area (CCTV-style maximize). */
  maximizedPanelId: string | null;

  /** "monitor" = panel wall, "channels" = channel registry,
   *  "analysis" = Excel-like tag workbench (tab "Data") */
  viewMode: "monitor" | "channels" | "analysis";
  sheets: Sheet[];
  activeSheetId: string | null;
  /** tag_id → freshest sample, fed by the Supabase Realtime hook */
  liveValues: Record<string, LiveValue>;
  /** tag_id → rolling buffer of live points accumulated THIS session (max
   *  100), so sparklines/data lists tick in realtime between refetches. */
  liveBuffers: Record<string, LiveValue[]>;
  /** Open alarm events from the server-side engine (cleared_at null), fed by
   *  use-alarm-events (Realtime + polling fallback). */
  activeAlarms: AlarmEvent[];
  /** Epoch ms of the last time fresh DATA arrived (live value / alarm /
   *  manual refresh) — shown as "Diperbarui HH:MM" next to the bell. */
  dataUpdatedAt: number | null;
  /** Bumped by the manual refresh button; data consumers (recent-sample
   *  loaders) re-fetch when it changes. */
  dataRefreshNonce: number;
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
  refreshSheets: () => Promise<void>;
  selectSheet: (id: string) => void;
  setViewMode: (v: "monitor" | "channels" | "analysis") => void;
  setMaximizedPanel: (id: string | null) => void;
  setLiveValue: (tagId: string, value: LiveValue) => void;
  setActiveAlarms: (events: AlarmEvent[]) => void;
  refreshActiveAlarms: () => Promise<void>;
  /** Manual data refresh (the button next to the bell): re-pulls tags,
   *  latest values, and active alarms — data only, layout untouched. */
  refreshData: () => Promise<void>;
  /** Append a panel to the active perspective and persist immediately —
   *  used by the Analisis action bar ("Buat Grafik/Gauge/Bar").
   *
   *  Returns WHERE the panel landed, because that is not always the page the
   *  user was looking at: the admin default is read-only, so adding to it forks
   *  a personal copy first (same rule as save()). Telling the user "ditambahkan
   *  ke X" and saying nothing else would leave them hunting for a panel on a
   *  page that never got one. */
  addPanelToActive: (
    panel: Panel
  ) => Promise<{ pageName: string; forked: boolean }>;
  setShowManageStreams: (v: boolean) => void;
  setShowManageSites: (v: boolean) => void;
}

/** Indeks config sensor, dibangun ulang hanya ketika daftar tag berganti.
 *
 *  setLiveValue memanggil `tags.find(...)` pada SETIAP sampel yang masuk untuk
 *  membaca satu hal: interval sampling sensornya. Di 300 sensor ber-interval
 *  3 detik itu ~100 pemindaian linear per detik atas array 300 elemen — 30.000
 *  perbandingan per detik untuk pertanyaan yang jawabannya tidak berubah sampai
 *  ada sensor ditambah atau dihapus.
 *
 *  Cache modul, bukan state: isinya murni turunan dari `tags`, jadi menaruhnya
 *  di store hanya akan menambah satu bidang lagi yang harus dijaga tetap sinkron. */
let tagConfigCache: {
  tags: Tag[];
  map: Map<string, Record<string, unknown>>;
} | null = null;

const EMPTY_CONFIG: Record<string, unknown> = {};

function tagConfigOf(tags: Tag[], tagId: string): Record<string, unknown> {
  if (!tagConfigCache || tagConfigCache.tags !== tags) {
    tagConfigCache = {
      tags,
      map: new Map(
        tags.map((t) => [t.id, (t.config ?? {}) as Record<string, unknown>])
      ),
    };
  }
  return tagConfigCache.map.get(tagId) ?? EMPTY_CONFIG;
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
  rnetSettings: null,
  loading: true,
  loadError: null,
  maximizedPanelId: null,

  viewMode: "monitor",
  sheets: [],
  activeSheetId: null,
  liveValues: {},
  liveBuffers: {},
  activeAlarms: [],
  dataUpdatedAt: null,
  dataRefreshNonce: 0,
  streamReconnectNonce: 0,
  publishedExists: false,

  editMode: false,
  draftPanels: null,
  draftCanvas: null,

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
        sheetsRes,
        publishedRes,
        settingsRes,
      ] = await Promise.all([
        scadaApi.listPerspectives(),
        scadaApi.listStreams(),
        scadaApi.listChannels(),
        scadaApi.listSites(),
        scadaApi.listTags(),
        scadaApi.listSheets(),
        scadaApi.getPublishedLayout(),
        // Caught here, not in the outer try: the sampling durations only feed
        // visual heuristics (offline window, live throttle, level labels), and
        // every consumer already falls back to DEFAULT_LEVEL_SECONDS. Letting
        // this one reject would blank the entire R-Net page over a cosmetic
        // detail.
        scadaApi.getRnetSettings().catch(() => null),
      ]);
      const perspectives = perspectivesRes.items;
      set({
        perspectives,
        streams: streamsRes.items,
        channels: channelsRes.items,
        sites: sitesRes.items,
        tags: tagsRes.items,
        rnetSettings: settingsRes,
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
    set({ draftPanels: [...draftPanels, panel] });
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

  setLiveValue: (tagId, value) => {
    // Gerbang interval-sinkron: angka di layar berganti sekali per jendela
    // interval sensornya, sama persis dengan irama data yang tersimpan
    // (interval 30 dtk = angka berganti tiap 30 dtk). Jendelanya dipatok ke jam
    // dinding, bukan ke jarak antar-sampel, supaya jitter kedatangan tidak
    // menggeser iramanya.
    //
    // Dulu gerbang ini hanya berlaku untuk tag bercentang "Simpan data"; sisanya
    // berkedip ~1 dtk. Centang itu sudah tidak ada, dan alasan aslinya tidak
    // pernah tentang lajur penyimpanan — melainkan supaya angka di layar tidak
    // bergerak lebih cepat daripada data yang sebenarnya direkam. Itu berlaku
    // untuk semua sensor.
    const cfg = tagConfigOf(get().tags, tagId);
    const intervalMs = samplingIntervalMs(cfg, get().rnetSettings);
    const shown = get().liveValues[tagId];
    if (shown) {
      const windowOf = (ts: string) => Math.floor(new Date(ts).getTime() / intervalMs);
      if (windowOf(value.ts) <= windowOf(shown.ts)) return;
    }
    const prev = get().dataUpdatedAt;
    const now = Date.now();
    // Append to the session buffer (skip exact-duplicate timestamps). The cap
    // sets how long a chart's live tail can be: 400 × 3 s ≈ 20 menit, jauh
    // lebih panjang dari jeda 60 dtk antar-pengambilan riwayat.
    const buffers = get().liveBuffers;
    const buf = buffers[tagId] ?? [];
    const isDup = buf.length > 0 && buf[buf.length - 1].ts === value.ts;
    set({
      liveValues: { ...get().liveValues, [tagId]: value },
      liveBuffers: isDup
        ? buffers
        : { ...buffers, [tagId]: [...buf, value].slice(-LIVE_BUFFER_CAP) },
      // Throttled so a burst of realtime events doesn't thrash the toolbar
      dataUpdatedAt: prev === null || now - prev > 1000 ? now : prev,
    });
  },

  setActiveAlarms: (events) => set({ activeAlarms: events }),

  refreshActiveAlarms: async () => {
    try {
      const res = await scadaApi.listActiveAlarms();
      set({ activeAlarms: res.items });
    } catch {
      /* best-effort — polling/Realtime will retry */
    }
  },

  refreshData: async () => {
    const { refreshTags, refreshActiveAlarms } = get();
    await Promise.all([refreshTags(), refreshActiveAlarms()]);
    // Re-seed latest values so quiet sensors update their "last known" too
    try {
      // Lewat setLiveValue agar gerbang interval-sinkron ikut berlaku di
      // refresh manual — nilai tag tersimpan tetap berganti per interval.
      await fetchLatestInChunks(
        get().tags.map((t) => t.id),
        (tagId, v) => get().setLiveValue(tagId, v)
      );
    } catch {
      /* best-effort */
    }
    set({
      dataRefreshNonce: get().dataRefreshNonce + 1,
      dataUpdatedAt: Date.now(),
    });
  },

  addPanelToActive: async (panel) => {
    const { activePerspectiveId, perspectives } = get();
    const active = perspectives.find((p) => p.id === activePerspectiveId);
    if (!active) throw new Error("Tidak ada halaman Monitor aktif");

    // The admin default is not the caller's row to PATCH: the endpoint resolves
    // it through _get_own_perspective and answers 404. This function had no
    // read_only guard at all (unlike save() and updateActivePanelPersist), and
    // pickActive deliberately lands EVERY user on the admin default — so the
    // 404 path was the normal path. "Buat Grafik/Gauge/Bar" in the Data tab
    // therefore failed essentially always, reported only as a generic toast,
    // and no panel ever appeared on Monitor.
    //
    // Fork into the user's own copy instead, and reuse that copy on later adds
    // so pressing the button three times gives three panels on one page rather
    // than three pages named "(salinan)".
    const forkName = `${active.name} (salinan)`;
    const target = active.read_only
      ? (perspectives.find((p) => !p.read_only && p.name === forkName) ?? null)
      : active;

    // First fork starts from what the user is currently looking at.
    const base = target ?? active;
    const canvas = base.layout.canvas ?? DEFAULT_CANVAS;
    const existing = base.layout.panels.filter((p) => p.rect);
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

    if (target === null) {
      const created = await scadaApi.createPerspective(forkName, {
        version: 2,
        canvas,
        panels,
      });
      window.localStorage.setItem(LAST_PERSPECTIVE_KEY, created.id);
      set({
        perspectives: [...perspectives, created],
        activePerspectiveId: created.id,
      });
      return { pageName: created.name, forked: true };
    }

    const updated = await scadaApi.updatePerspective(target.id, {
      layout: { version: 2, canvas, panels },
    });
    window.localStorage.setItem(LAST_PERSPECTIVE_KEY, updated.id);
    set({
      perspectives: perspectives.map((p) => (p.id === updated.id ? updated : p)),
      activePerspectiveId: updated.id,
    });
    return { pageName: updated.name, forked: target.id !== active.id };
  },

  setShowManageStreams: (v) => set({ showManageStreams: v }),
  setShowManageSites: (v) => set({ showManageSites: v }),
}));

/** Bidang yang berubah pada SETIAP sampel sensor masuk.
 *
 *  Di plant 300 sensor ber-interval 3 detik itu ~100 pembaruan per detik, dan
 *  setiap pembaruan mengganti identitas ketiga objek ini. */
const HOT_FIELDS = new Set<keyof ScadaState>([
  "liveValues",
  "liveBuffers",
  "dataUpdatedAt",
]);

/** Seluruh store KECUALI bidang yang berdetak realtime.
 *
 *  Ini obat untuk penyakit utama R-Net. `useScadaStore()` tanpa selector
 *  berlangganan SELURUH state, dan zustand membuat objek state baru pada setiap
 *  `set()` — jadi komponen yang memakainya digambar ulang pada setiap sampel
 *  sensor, entah ia menampilkan nilai sensor atau tidak.
 *
 *  Yang memakainya bukan komponen kecil: ScadaView (dinding Monitor lengkap
 *  dengan setiap gauge, grafik, tabel, dan iframe di dalamnya), ChannelsView,
 *  dan ComponentPalette. Tak satu pun dari ketiganya membaca liveValues,
 *  liveBuffers, atau dataUpdatedAt. Mereka digambar ulang ~100 kali per detik
 *  untuk data yang tidak pernah mereka sentuh — dan dinding Monitor melakukannya
 *  bahkan saat user sedang berada di tab Data, karena dinding itu tidak pernah
 *  dilepas dari DOM.
 *
 *  `useShallow` membandingkan objek hasilnya per-bidang, jadi perubahan yang
 *  hanya menyentuh bidang panas menghasilkan objek yang SAMA dan React tidak
 *  menggambar ulang apa pun.
 *
 *  Komponen yang memang menampilkan nilai live (AnalysisView, panel gauge/
 *  chart/tabel) tetap berlangganan bidang panasnya secara eksplisit — dengan
 *  selector sempit, bukan seluruh store. */
export function useScadaCold(): ScadaState {
  return useScadaStore(
    useShallow((s) => {
      const cold = {} as Record<string, unknown>;
      for (const key of Object.keys(s) as (keyof ScadaState)[]) {
        if (!HOT_FIELDS.has(key)) cold[key] = s[key];
      }
      return cold as unknown as ScadaState;
    })
  );
}

/** Nilai live untuk SEKUMPULAN tag saja — bukan seluruh peta.
 *
 *  `useScadaStore((s) => s.liveValues)` terlihat seperti selector yang sempit,
 *  padahal tidak: peta itu diganti identitasnya setiap kali sensor MANA PUN
 *  mengirim nilai. Jadi panel tabel berisi 4 sensor tetap digambar ulang setiap
 *  kali salah satu dari 300 sensor lain berdetak — 99% pekerjaannya untuk baris
 *  yang tidak berubah.
 *
 *  Di sini `useShallow` membandingkan per-tag, jadi panel hanya bangun ketika
 *  salah satu tag MILIKNYA benar-benar berubah. Pola benarnya sebetulnya sudah
 *  ada sejak awal di use-tag-value.ts (`s.liveValues[tagId]`) — ini hanya
 *  memperluasnya dari satu tag ke sekumpulan tag. */
export function useTagLiveValues(tagIds: string[]): Record<string, LiveValue> {
  // Kunci string: array baru pada tiap render tidak boleh dianggap perubahan.
  const key = tagIds.join(",");
  return useScadaStore(
    useShallow((s) => {
      const out: Record<string, LiveValue> = {};
      if (key === "") return out;
      for (const id of key.split(",")) {
        const v = s.liveValues[id];
        if (v) out[id] = v;
      }
      return out;
    })
  );
}

/** Ekor live per tag, untuk sekumpulan tag saja — lihat useTagLiveValues. */
export function useTagLiveBuffers(tagIds: string[]): Record<string, LiveValue[]> {
  const key = tagIds.join(",");
  return useScadaStore(
    useShallow((s) => {
      const out: Record<string, LiveValue[]> = {};
      if (key === "") return out;
      for (const id of key.split(",")) {
        const buf = s.liveBuffers[id];
        if (buf) out[id] = buf;
      }
      return out;
    })
  );
}

/** Ekor live SATU tag. Selector paling sempit yang mungkin: baris yang tagnya
 *  tidak berdetak tidak ikut bangun sama sekali. */
export function useTagLiveBuffer(tagId: string): LiveValue[] | undefined {
  return useScadaStore((s) => s.liveBuffers[tagId]);
}
