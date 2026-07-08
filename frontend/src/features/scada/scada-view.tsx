"use client";

/** R-Net (Cloud SCADA Remula, sebelumnya "SCADA Monitor") — main view.
 *  View mode is the default: pick a perspective, watch. Edit mode (gated by
 *  scada:edit_layout) works on a draft; Simpan persists, Batal discards. */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Loader2,
  Maximize,
  Minimize,
  MonitorPlay,
  MoreVertical,
  Move,
  Pencil,
  Plus,
  Radio,
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
import { GridCanvas } from "./grid/grid-canvas";
import { PanelFrame } from "./panels/panel-frame";
import { renderPanel } from "./panels/panel-registry";
import { AddPanelDialog } from "./add-panel-dialog";
import { ManageStreamsDialog } from "./manage-streams-dialog";
import { AnalysisView } from "./analysis/analysis-view";

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

  const isMobile = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const wallRef = useRef<HTMLDivElement>(null);

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
        <div className="flex h-[52px] min-h-[52px] shrink-0 items-center gap-2 border-b border-border-soft bg-bg px-4">
          <MonitorPlay className="size-4 shrink-0 text-primary" />
          <span className="hidden text-[14px] font-bold text-text sm:block">
            R-Net
          </span>

          {/* Perspective picker — monitor mode only */}
          {store.viewMode === "monitor" && store.perspectives.length > 0 && (
            <select
              className="field-select h-8 w-auto max-w-[200px] cursor-pointer text-[12.5px]"
              value={store.activePerspectiveId ?? ""}
              onChange={(e) => store.selectPerspective(e.target.value)}
              disabled={store.editMode}
            >
              {store.perspectives.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.is_default ? " ★" : ""}
                </option>
              ))}
            </select>
          )}

          {/* Badge — this layout is the admin-published default (Masalah D):
              either the admin's own published one, or the read-only copy shown
              to other users. */}
          {store.viewMode === "monitor" && (active?.is_published || active?.read_only) && (
            <span className="hidden items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10.5px] font-semibold text-primary sm:inline-flex">
              <Send className="size-3" /> Bawaan Admin
            </span>
          )}

          {/* Monitor | Analisis toggle */}
          {!store.editMode && (
            <div className="flex items-center rounded-[var(--r)] border border-border-soft bg-bg-sidebar p-0.5">
              {(
                [
                  { mode: "monitor", label: "Monitor" },
                  { mode: "analysis", label: "Analisis" },
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

          {store.viewMode === "analysis" ? null : store.editMode ? (
            <>
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
              {canManage && (
                <button
                  onClick={() => store.setShowManageStreams(true)}
                  className="btn btn-ghost btn-sm gap-1.5"
                >
                  <Radio className="size-3.5" />
                  <span className="hidden sm:inline">Kelola Stream</span>
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

      {/* Analisis workbench — Excel-like tag sheet (fullscreen stays with Monitor) */}
      {store.viewMode === "analysis" && !fullscreen ? (
        <AnalysisView canEdit={canEdit} canManage={canManage} />
      ) : (
      /* Monitoring wall */
      <div
        ref={wallRef}
        className={cn("min-h-0 flex-1", fullscreen ? "bg-black" : "bg-bg-sidebar")}
      >
        {panels.length === 0 ? (
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
                Klik &ldquo;Atur Layout&rdquo; untuk menambah panel video.
              </p>
            ) : (
              <p className="text-[12px] text-text-muted">
                Hubungi admin untuk menyiapkan tampilan monitoring.
              </p>
            )}
          </div>
        ) : isMobile ? (
          /* Mobile: simple stacked list, view-only */
          <div
            className={cn(
              "flex h-full flex-col overflow-y-auto",
              fullscreen ? "gap-1 p-0" : "gap-3 p-3"
            )}
          >
            {panels.map((panel) => (
              <div key={panel.id} className="aspect-video w-full shrink-0">
                <PanelFrame
                  title={panel.title}
                  editMode={false}
                  fullscreen={fullscreen}
                >
                  {renderPanel(panel, store.streams, store.tags)}
                </PanelFrame>
              </div>
            ))}
          </div>
        ) : (
          <div className={cn("h-full", fullscreen ? "p-0" : "p-2")}>
            <GridCanvas
              panels={panels}
              editMode={store.editMode}
              fullscreen={fullscreen}
              onGridChange={store.updateGrid}
              renderPanelContent={(panel) => (
                <PanelFrame
                  title={panel.title}
                  editMode={store.editMode}
                  fullscreen={fullscreen}
                  onRemove={() => store.removePanel(panel.id)}
                >
                  {renderPanel(panel, store.streams, store.tags)}
                </PanelFrame>
              )}
            />
          </div>
        )}

        {/* Exit-fullscreen affordance — all viewports */}
        {fullscreen && (
          <button
            onClick={toggleFullscreen}
            className="fixed bottom-4 right-4 z-30 flex size-9 items-center justify-center rounded-full bg-black/50 text-white opacity-40 transition-opacity hover:opacity-100"
            title="Keluar layar penuh"
          >
            <Minimize className="size-4" />
          </button>
        )}
      </div>
      )}

      {/* Dialogs */}
      {store.showAddPanel && store.draftPanels && (
        <AddPanelDialog
          streams={store.streams}
          tags={store.tags}
          existingPanels={store.draftPanels}
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
