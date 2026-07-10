"use client";

/** R-Net (Cloud SCADA Remula, sebelumnya "SCADA Monitor") — main view.
 *  View mode is the default: pick a perspective, watch. Edit mode (gated by
 *  scada:edit_layout) works on a draft; Simpan persists, Batal discards. */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Maximize,
  Minimize,
  MonitorPlay,
  MoreVertical,
  Move,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Send,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth, useAuthDisplay } from "@/hooks/use-auth";
import { useIsMobile } from "@/hooks/use-mobile";
import { useCan } from "@/components/providers/permissions-provider";
import type { AppRole } from "@/lib/utils/roles";
import { useScadaStore } from "./store";
import type { Panel } from "./types";
import { DEFAULT_CANVAS } from "./types";
import { CanvasStage, STAGE_PRESETS, presetRects } from "./grid/canvas-stage";
import { WebLiveLayer, setWebLayerLock, setWebSolo } from "./web-live-layer";
import { channelAspect, channelScreen } from "./screen-box";
import { PanelFrame } from "./panels/panel-frame";
import { renderPanel } from "./panels/panel-registry";
import { AddPanelDialog } from "./add-panel-dialog";
import { ManageStreamsDialog } from "./manage-streams-dialog";
import { AnalysisView } from "./analysis/analysis-view";
import { ChannelsView } from "./channels-view";

export function ScadaView() {
  const { role } = useAuthDisplay();
  const canEdit = useCan(role as AppRole, "scada:edit_layout");
  const canManage = useCan(role as AppRole, "scada:manage");
  const { profile, loading: authLoading } = useAuth();

  const store = useScadaStore();
  const active = store.perspectives.find(
    (p) => p.id === store.activePerspectiveId
  );
  const panels: Panel[] =
    store.editMode && store.draftPanels
      ? store.draftPanels
      : active?.layout.panels ?? [];
  // Fixed-canvas (v2) panels only — legacy v1 panels are "mulai bersih":
  // invisible on the wall, dropped from drafts on the next save.
  const rectPanelCount = panels.filter((p) => p.rect).length;

  // Channel panels get a live title from the registry (nickname can change
  // after the panel was placed); other panels keep their stored title.
  const panelTitle = useCallback(
    (panel: Panel): string => {
      if (panel.type === "channel") {
        const ch = store.channels.find((c) => c.id === panel.config.channel_id);
        return ch ? `CH ${ch.number} · ${ch.name}` : panel.title || "Channel";
      }
      return panel.title;
    },
    [store.channels]
  );

  const maximizedPanel =
    store.maximizedPanelId !== null
      ? panels.find((p) => p.id === store.maximizedPanelId) ?? null
      : null;

  // Maximize solo-mode: only the maximized web channel's iframe stays visible
  // (the others would otherwise float above the maximize backdrop).
  useEffect(() => {
    let webId: string | null = null;
    if (maximizedPanel?.type === "channel") {
      const ch = store.channels.find(
        (c) => c.id === maximizedPanel.config.channel_id
      );
      if (ch?.kind === "web") webId = ch.id;
    }
    setWebSolo(webId);
    return () => setWebSolo(null);
  }, [maximizedPanel, store.channels]);

  // While arranging the layout, iframes must never swallow drag gestures.
  useEffect(() => {
    setWebLayerLock(store.editMode);
  }, [store.editMode]);

  const isMobile = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);
  const [pagesOpen, setPagesOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const wallRef = useRef<HTMLDivElement>(null);

  // Fullscreen "pages": each perspective is a page. Flip manually (arrows /
  // number keys / the on-screen bar) or let auto-rotate cycle them.
  const [autoRotate, setAutoRotate] = useState(false);
  const [rotateSec, setRotateSec] = useState(15);
  const pageIndex = store.perspectives.findIndex(
    (p) => p.id === store.activePerspectiveId
  );
  const pageCount = store.perspectives.length;

  const gotoPage = useCallback((idx: number) => {
    const { perspectives, selectPerspective } = useScadaStore.getState();
    if (perspectives.length === 0) return;
    const i = ((idx % perspectives.length) + perspectives.length) % perspectives.length;
    selectPerspective(perspectives[i].id);
  }, []);

  // Escape restores a maximized channel (any view state)
  useEffect(() => {
    if (store.maximizedPanelId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") store.setMaximizedPanel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.maximizedPanelId]);

  // Keyboard flipping — only while fullscreen (arrows + digits 1-9)
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      const { perspectives, activePerspectiveId } = useScadaStore.getState();
      if (perspectives.length === 0) return;
      const idx = perspectives.findIndex((p) => p.id === activePerspectiveId);
      if (e.key === "ArrowRight") {
        e.preventDefault();
        gotoPage(idx + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        gotoPage(idx - 1);
      } else if (/^[1-9]$/.test(e.key)) {
        const n = Number(e.key) - 1;
        if (n < perspectives.length) {
          e.preventDefault();
          gotoPage(n);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen, gotoPage]);

  // Auto-rotate carousel
  useEffect(() => {
    if (!fullscreen || !autoRotate || store.editMode || pageCount <= 1) return;
    const t = setInterval(() => {
      const { perspectives, activePerspectiveId } = useScadaStore.getState();
      const idx = perspectives.findIndex((p) => p.id === activePerspectiveId);
      gotoPage(idx + 1);
    }, rotateSec * 1000);
    return () => clearInterval(t);
  }, [fullscreen, autoRotate, rotateSec, store.editMode, pageCount, gotoPage]);

  useEffect(() => {
    if (authLoading || !profile) return;
    void store.loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, !!profile]);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void wallRef.current?.requestFullscreen();
    }
  }, []);

  async function handleSave() {
    try {
      await store.save();
      toast.success("Layout tersimpan");
    } catch {
      toast.error("Gagal menyimpan layout");
    }
  }

  async function handleSaveAs() {
    const name = window.prompt("Nama perspective baru:");
    if (!name?.trim()) return;
    try {
      await store.saveAs(name.trim());
      toast.success(`Perspective "${name.trim()}" dibuat`);
    } catch {
      toast.error("Gagal membuat perspective");
    }
    setMenuOpen(false);
  }

  async function handleNewPage() {
    const name = window.prompt("Nama halaman baru:");
    if (!name?.trim()) return;
    try {
      await store.newPage(name.trim());
      toast.success(`Halaman "${name.trim()}" dibuat — susun panelnya`);
    } catch {
      toast.error("Gagal membuat halaman");
    }
    setPagesOpen(false);
  }

  async function handleRenamePage() {
    if (!active) return;
    const name = window.prompt("Ganti nama halaman:", active.name);
    if (!name?.trim() || name.trim() === active.name) return;
    try {
      await store.renamePage(active.id, name.trim());
      toast.success("Nama halaman diperbarui");
    } catch {
      toast.error("Gagal mengganti nama halaman");
    }
    setPagesOpen(false);
  }

  async function handleSetDefault() {
    if (!active) return;
    try {
      await store.setDefault(active.id);
      toast.success(`"${active.name}" jadi tampilan utama`);
    } catch {
      toast.error("Gagal mengubah tampilan utama");
    }
    setMenuOpen(false);
  }

  async function handleTogglePublish() {
    if (!active) return;
    try {
      if (active.is_published) {
        await store.unpublishLayout(active.id);
        toast.success("Bawaan admin dicabut");
      } else {
        await store.publishLayout(active.id);
        toast.success(`"${active.name}" jadi bawaan admin — user baru mulai dari sini`);
      }
    } catch {
      toast.error("Gagal mengubah bawaan admin");
    }
    setMenuOpen(false);
  }

  async function handleResetToDefault() {
    if (
      !window.confirm(
        "Ganti layout ini dengan bawaan admin? Susunan Anda saat ini akan ditimpa."
      )
    )
      return;
    try {
      await store.resetToDefault();
      toast.success("Layout dikembalikan ke bawaan admin");
    } catch {
      toast.error("Gagal mengembalikan ke bawaan admin");
    }
    setMenuOpen(false);
  }

  async function handleDelete() {
    if (!active) return;
    if (!window.confirm(`Hapus perspective "${active.name}"?`)) return;
    try {
      await store.deletePerspective(active.id);
      toast.success("Perspective dihapus");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      toast.error(
        msg.includes("terakhir")
          ? "Perspective terakhir tidak bisa dihapus"
          : "Gagal menghapus perspective"
      );
    }
    setMenuOpen(false);
  }

  if (store.loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto size-6 animate-spin text-primary" />
          <p className="mt-3 text-[13px] text-text-muted">Memuat R-Net…</p>
        </div>
      </div>
    );
  }

  if (store.loadError) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <p className="text-[13px] text-text-muted">{store.loadError}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Toolbar */}
      {!fullscreen && (
        <div className="flex h-[52px] min-h-[52px] shrink-0 items-center gap-2 overflow-x-auto border-b border-border-soft bg-bg px-4 [&>*]:shrink-0">
          <MonitorPlay className="size-4 shrink-0 text-primary" />
          <span className="hidden text-[14px] font-bold text-text sm:block">
            R-Net
          </span>

          {/* Halaman (page) dropdown — sits by the R-Net logo. Switch, create &
              rename pages. Each page is a perspective; fullscreen flips them. */}
          {store.viewMode === "monitor" && !store.editMode && (
            <div className="relative">
              <button
                onClick={() => setPagesOpen((v) => !v)}
                className="flex h-8 max-w-[220px] items-center gap-1.5 rounded-[var(--r)] border border-border-soft bg-bg-sidebar px-2.5 text-[12.5px] font-semibold text-text hover:border-border"
                title="Pilih / kelola halaman"
              >
                <MonitorPlay className="size-3.5 shrink-0 text-text-muted" />
                <span className="truncate">{active?.name ?? "Halaman"}</span>
                {(active?.is_published || active?.read_only) && (
                  <Send className="size-3 shrink-0 text-primary" />
                )}
                <ChevronDown className="size-3.5 shrink-0 text-text-light" />
              </button>
              {pagesOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setPagesOpen(false)} />
                  <div className="absolute left-0 top-9 z-20 w-64 rounded-[var(--r-lg)] border border-border bg-bg p-1 shadow-[var(--shadow-lg)]">
                    <div className="max-h-64 overflow-y-auto">
                      {store.perspectives.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => {
                            store.selectPerspective(p.id);
                            setPagesOpen(false);
                          }}
                          className={cn(
                            "flex w-full cursor-pointer items-center gap-2 rounded-[var(--r)] px-3 py-2 text-left text-[12.5px]",
                            p.id === store.activePerspectiveId
                              ? "bg-primary/8 font-semibold text-text"
                              : "text-text-muted hover:bg-bg-hover"
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate">{p.name}</span>
                          {p.is_default && <Star className="size-3 shrink-0 text-amber-500" />}
                          {(p.is_published || p.read_only) && (
                            <Send className="size-3 shrink-0 text-primary" />
                          )}
                          {p.id === store.activePerspectiveId && (
                            <Check className="size-3.5 shrink-0 text-primary" />
                          )}
                        </button>
                      ))}
                    </div>
                    {canEdit && (
                      <>
                        <div className="my-1 h-px bg-border-soft" />
                        <MenuItem icon={Plus} label="Halaman Baru" onClick={handleNewPage} />
                        <MenuItem
                          icon={Pencil}
                          label="Ganti Nama Halaman Ini"
                          onClick={handleRenamePage}
                          disabled={!active || active.read_only}
                        />
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Monitor | Channel | Data toggle */}
          {!store.editMode && (
            <div className="flex items-center rounded-[var(--r)] border border-border-soft bg-bg-sidebar p-0.5">
              {(
                [
                  { mode: "monitor", label: "Monitor" },
                  { mode: "channels", label: "Channel" },
                  { mode: "analysis", label: "Data" },
                ] as const
              ).map(({ mode, label }) => (
                <button
                  key={mode}
                  onClick={() => store.setViewMode(mode)}
                  className={cn(
                    "cursor-pointer rounded-[var(--r-sm)] px-2.5 py-1 text-[11.5px] font-semibold transition-colors",
                    store.viewMode === mode
                      ? "bg-bg text-text shadow-[var(--shadow-xs)]"
                      : "text-text-muted hover:text-text"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          <div className="flex-1" />

          {store.viewMode !== "monitor" ? null : store.editMode ? (
            <>
              {/* Canvas resolution (OBS scene size) */}
              <select
                className="field-select h-8 w-auto cursor-pointer text-[12px]"
                value={`${(store.draftCanvas ?? DEFAULT_CANVAS).w}x${(store.draftCanvas ?? DEFAULT_CANVAS).h}`}
                onChange={(e) => {
                  const [w, h] = e.target.value.split("x").map(Number);
                  store.setDraftCanvas({ w, h });
                }}
                title="Resolusi kanvas halaman ini"
              >
                {["1280x720", "1920x1080", "2560x1440", "3840x2160"].map((r) => (
                  <option key={r} value={r}>
                    {r.replace("x", "×")}
                  </option>
                ))}
              </select>
              {/* Quick split presets */}
              <select
                className="field-select h-8 w-auto cursor-pointer text-[12px]"
                value=""
                onChange={(e) => {
                  if (!e.target.value) return;
                  store.applyPresetRects(
                    presetRects(
                      e.target.value,
                      store.draftPanels?.length ?? 0,
                      store.draftCanvas ?? DEFAULT_CANVAS
                    )
                  );
                  e.target.value = "";
                }}
                title="Susun panel otomatis"
              >
                <option value="">Susun Cepat…</option>
                {STAGE_PRESETS.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
              <button
                onClick={() => store.setShowAddPanel(true)}
                className="btn btn-secondary btn-sm gap-1.5"
              >
                <Plus className="size-3.5" />
                <span className="hidden sm:inline">Tambah Panel</span>
              </button>
              <button onClick={handleSave} className="btn btn-primary btn-sm gap-1.5">
                <Check className="size-3.5" /> Simpan
              </button>
              <button
                onClick={() => store.cancelEdit()}
                className="btn btn-ghost btn-sm gap-1.5"
              >
                <X className="size-3.5" /> Batal
              </button>
            </>
          ) : (
            <>
              {canEdit && !isMobile && (
                <button
                  onClick={() => store.enterEdit()}
                  className="btn btn-secondary btn-sm gap-1.5"
                  disabled={!active}
                >
                  <Pencil className="size-3.5" /> Atur Layout
                </button>
              )}
              <button
                onClick={toggleFullscreen}
                className="btn btn-ghost btn-icon btn-sm"
                title="Layar penuh"
              >
                <Maximize className="size-4" />
              </button>
            </>
          )}

          {/* Overflow menu — perspective actions (editors only, monitor mode) */}
          {canEdit && !isMobile && store.viewMode === "monitor" && (
            <div className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="btn btn-ghost btn-icon btn-sm"
                title="Aksi lainnya"
              >
                <MoreVertical className="size-4" />
              </button>
              {menuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setMenuOpen(false)}
                  />
                  <div className="absolute right-0 top-9 z-20 w-64 rounded-[var(--r-lg)] border border-border bg-bg p-1 shadow-[var(--shadow-lg)]">
                    <MenuItem icon={ChevronDown} label="Simpan Sebagai…" onClick={handleSaveAs} />
                    <MenuItem
                      icon={Star}
                      label="Jadikan Tampilan Utama"
                      onClick={handleSetDefault}
                      disabled={!active || active.is_default || active.read_only}
                    />
                    {/* Admin-published default layout (Masalah D). Publish only
                        applies to your OWN layouts, not the injected read-only
                        admin copy. */}
                    {canManage && !active?.read_only && (
                      <MenuItem
                        icon={Send}
                        label={
                          active?.is_published
                            ? "Cabut dari Bawaan Admin"
                            : "Terbitkan sebagai Bawaan Admin"
                        }
                        onClick={handleTogglePublish}
                        disabled={!active}
                      />
                    )}
                    {store.publishedExists && !active?.read_only && (
                      <MenuItem
                        icon={RotateCcw}
                        label="Kembalikan ke Bawaan Admin"
                        onClick={handleResetToDefault}
                        disabled={!active}
                      />
                    )}
                    <MenuItem
                      icon={Trash2}
                      label="Hapus Perspective Ini"
                      onClick={handleDelete}
                      disabled={store.perspectives.length <= 1 || active?.read_only}
                      danger
                    />
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Edit-mode hint bar */}
      {store.editMode && !fullscreen && (
        <div className="flex shrink-0 items-center gap-2 border-b border-primary/20 bg-primary/5 px-4 py-1.5 text-[11.5px] font-medium text-primary">
          <Move className="size-3.5 shrink-0" />
          Geser panel lewat bar judulnya · tarik sudut kanan-bawah untuk mengubah ukuran · klik Simpan kalau sudah pas
        </div>
      )}

      {/* Data workbench / Channel registry — rendered as overlays; the wall
          below STAYS MOUNTED so web embeds never reload on tab switches. */}
      {store.viewMode === "analysis" && !fullscreen && (
        <AnalysisView canEdit={canEdit} canManage={canManage} />
      )}
      {store.viewMode === "channels" && !fullscreen && (
        <ChannelsView canManage={canManage} />
      )}

      {/* Monitoring wall — ALWAYS mounted (hidden on other tabs) so the
          keep-alive web iframes survive tab switches; video is suspended
          while hidden to save bandwidth. `isolate z-0` fences the whole wall
          (including the iframe layer) so it can never cover dropdowns/menus
          outside it. */}
      <div
        ref={wallRef}
        className={cn(
          "relative isolate z-0 min-h-0 flex-1",
          fullscreen ? "bg-black" : "bg-bg-sidebar",
          store.viewMode !== "monitor" && !fullscreen && "hidden"
        )}
      >
        {rectPanelCount === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <MonitorPlay className="size-10 text-text-light" />
            <p className="text-[13px] font-semibold text-text">
              Belum ada panel di layout ini
            </p>
            {store.editMode ? (
              <button
                onClick={() => store.setShowAddPanel(true)}
                className="btn btn-primary btn-sm gap-1.5"
              >
                <Plus className="size-3.5" /> Tambah Panel
              </button>
            ) : canEdit ? (
              <p className="text-[12px] text-text-muted">
                Klik &ldquo;Atur Layout&rdquo; lalu pilih channel yang mau
                ditampilkan (channel dibuat di tab Channel).
              </p>
            ) : (
              <p className="text-[12px] text-text-muted">
                Hubungi admin untuk menyiapkan tampilan monitoring.
              </p>
            )}
          </div>
        ) : isMobile ? (
          /* Mobile: stacked list, view-only — ordered like the layout
             (top-left first), each item shaped by its channel's screen. */
          <div
            className={cn(
              "flex h-full flex-col overflow-y-auto",
              fullscreen ? "gap-1 p-0" : "gap-3 p-3"
            )}
          >
            {[...panels]
              .sort(
                (a, b) =>
                  (a.rect ? a.rect.y * 10000 + a.rect.x : Number.MAX_SAFE_INTEGER) -
                  (b.rect ? b.rect.y * 10000 + b.rect.x : Number.MAX_SAFE_INTEGER)
              )
              .map((panel) => {
                let screen = { w: 16, h: 9 };
                if (panel.type === "channel") {
                  const ch = store.channels.find(
                    (c) => c.id === panel.config.channel_id
                  );
                  if (ch) screen = channelScreen(ch);
                }
                return (
                  <div
                    key={panel.id}
                    className="w-full shrink-0"
                    style={{ aspectRatio: `${screen.w} / ${screen.h}` }}
                  >
                    <PanelFrame
                      title={panelTitle(panel)}
                      editMode={false}
                      fullscreen={fullscreen}
                    >
                      {renderPanel(panel, store.streams, store.tags, {
                        channels: store.channels,
                        videoSuspended: store.viewMode !== "monitor",
                      })}
                    </PanelFrame>
                  </div>
                );
              })}
          </div>
        ) : (
          /* Fixed canvas (OBS-style): the page scales as ONE unit on every
             screen/zoom — positions never reflow. */
          <CanvasStage
            canvas={
              store.editMode
                ? store.draftCanvas ?? DEFAULT_CANVAS
                : active?.layout.canvas ?? DEFAULT_CANVAS
            }
            panels={panels}
            editMode={store.editMode}
            fullscreen={fullscreen}
            panelTitle={panelTitle}
            renderContent={(panel) =>
              renderPanel(panel, store.streams, store.tags, {
                channels: store.channels,
                webLive: true,
                // Hidden wall (other tab): web stays alive, video pauses.
                videoSuspended: store.viewMode !== "monitor",
              })
            }
            webChannelIdOf={(panel) => {
              if (panel.type !== "channel") return null;
              const ch = store.channels.find(
                (c) => c.id === panel.config.channel_id
              );
              return ch?.kind === "web" ? ch.id : null;
            }}
            panelAspect={(panel) => {
              if (panel.type !== "channel") return null;
              const ch = store.channels.find(
                (c) => c.id === panel.config.channel_id
              );
              return ch ? channelAspect(ch) : null;
            }}
            hideChrome={maximizedPanel !== null && !store.editMode}
            onRectChange={store.editMode ? store.updatePanelRect : undefined}
            onRemove={store.editMode ? store.removePanel : undefined}
            onMaximize={
              store.editMode ? undefined : (id) => store.setMaximizedPanel(id)
            }
          />
        )}

        {/* Keep-alive web embeds — iframes survive page flips (no V-Net
            duplicate-view reload). Lives inside the wall so fullscreen shows it. */}
        <WebLiveLayer />

        {/* Maximized channel — one panel fills the whole wall (CCTV style).
            Backdrop sits BELOW the iframe layer (z-20 < z-30) so a maximized
            web channel stays visible; solo-mode hides the other iframes. */}
        {maximizedPanel && !store.editMode && (
          <>
            <div className={cn("absolute inset-0 z-20", fullscreen ? "bg-black" : "bg-bg-sidebar p-2")}>
              <PanelFrame
                title={panelTitle(maximizedPanel)}
                editMode={false}
                fullscreen={fullscreen}
                maximized
                onMaximize={() => store.setMaximizedPanel(null)}
              >
                {renderPanel(maximizedPanel, store.streams, store.tags, {
                  channels: store.channels,
                  webLive: true,
                })}
              </PanelFrame>
            </div>
            {/* Restore control above everything (title bar is hidden in
                fullscreen, and the iframe would cover an in-frame button) */}
            {fullscreen && (
              <button
                onClick={() => store.setMaximizedPanel(null)}
                className="absolute left-4 top-4 z-50 flex size-9 items-center justify-center rounded-full bg-black/60 text-white opacity-60 backdrop-blur-sm transition-opacity hover:opacity-100"
                title="Kembalikan ukuran (Esc)"
              >
                <Minimize className="size-4" />
              </button>
            )}
          </>
        )}

        {/* Fullscreen page-flipper (each perspective = a page) */}
        {fullscreen && pageCount > 1 && (
          <div className="group fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
            <div className="flex items-center gap-1.5 rounded-full bg-black/55 px-2 py-1.5 text-white opacity-40 backdrop-blur-sm transition-opacity group-hover:opacity-100">
              <button
                onClick={() => gotoPage(pageIndex - 1)}
                className="flex size-7 items-center justify-center rounded-full hover:bg-white/15"
                title="Halaman sebelumnya (←)"
              >
                <ChevronLeft className="size-4" />
              </button>

              <div className="flex items-center gap-1 px-1">
                {store.perspectives.map((p, i) => (
                  <button
                    key={p.id}
                    onClick={() => gotoPage(i)}
                    title={`${i + 1}. ${p.name}`}
                    className={cn(
                      "h-2 rounded-full transition-all",
                      i === pageIndex
                        ? "w-5 bg-white"
                        : "w-2 bg-white/40 hover:bg-white/70"
                    )}
                  />
                ))}
              </div>

              <button
                onClick={() => gotoPage(pageIndex + 1)}
                className="flex size-7 items-center justify-center rounded-full hover:bg-white/15"
                title="Halaman berikutnya (→)"
              >
                <ChevronRight className="size-4" />
              </button>

              <span className="max-w-[160px] truncate px-1 text-[11.5px] font-medium">
                {pageIndex + 1}/{pageCount} · {store.perspectives[pageIndex]?.name}
              </span>

              <div className="mx-0.5 h-5 w-px bg-white/20" />

              <button
                onClick={() => setAutoRotate((v) => !v)}
                className={cn(
                  "flex size-7 items-center justify-center rounded-full",
                  autoRotate ? "bg-primary text-white" : "hover:bg-white/15"
                )}
                title={autoRotate ? "Hentikan gilir otomatis" : "Gilir halaman otomatis"}
              >
                {autoRotate ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
              </button>
              {autoRotate && (
                <select
                  value={rotateSec}
                  onChange={(e) => setRotateSec(Number(e.target.value))}
                  className="cursor-pointer rounded-full bg-white/10 px-1.5 py-0.5 text-[11px] text-white"
                  title="Jeda gilir"
                >
                  {[10, 15, 30, 60].map((s) => (
                    <option key={s} value={s} className="text-black">
                      {s}s
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        )}

        {/* Exit-fullscreen affordance — all viewports */}
        {fullscreen && (
          <button
            onClick={toggleFullscreen}
            className="fixed bottom-4 right-4 z-50 flex size-9 items-center justify-center rounded-full bg-black/50 text-white opacity-40 transition-opacity hover:opacity-100"
            title="Keluar layar penuh"
          >
            <Minimize className="size-4" />
          </button>
        )}
      </div>

      {/* Dialogs */}
      {store.showAddPanel && store.draftPanels && (
        <AddPanelDialog
          channels={store.channels}
          existingPanels={store.draftPanels}
          canvas={store.draftCanvas ?? DEFAULT_CANVAS}
          onAdd={store.addPanel}
          onClose={() => store.setShowAddPanel(false)}
        />
      )}
      {store.showManageStreams && (
        <ManageStreamsDialog
          streams={store.streams}
          onChanged={store.refreshStreams}
          onRefresh={store.reconnectStreams}
          onClose={() => store.setShowManageStreams(false)}
        />
      )}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  disabled,
  danger,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 rounded-[var(--r)] px-3 py-2 text-left text-[12.5px] font-medium",
        "transition-colors duration-[var(--tr)]",
        disabled
          ? "cursor-not-allowed opacity-40"
          : danger
            ? "text-red hover:bg-red/10"
            : "text-text hover:bg-bg-hover"
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      {label}
    </button>
  );
}
