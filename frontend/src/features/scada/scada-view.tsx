"use client";

/** SCADA Monitor — main view.
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
          <p className="mt-3 text-[13px] text-text-muted">Memuat SCADA Monitor…</p>
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
            SCADA Monitor
          </span>

          {/* Perspective picker */}
          {store.perspectives.length > 0 && (
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

          <div className="flex-1" />

          {store.editMode ? (
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

          {/* Overflow menu — perspective actions (editors only) */}
          {canEdit && !isMobile && (
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
                  <div className="absolute right-0 top-9 z-20 w-56 rounded-[var(--r-lg)] border border-border bg-bg p-1 shadow-[var(--shadow-lg)]">
                    <MenuItem icon={ChevronDown} label="Simpan Sebagai…" onClick={handleSaveAs} />
                    <MenuItem
                      icon={Star}
                      label="Jadikan Tampilan Utama"
                      onClick={handleSetDefault}
                      disabled={!active || active.is_default}
                    />
                    <MenuItem
                      icon={Trash2}
                      label="Hapus Perspective Ini"
                      onClick={handleDelete}
                      disabled={store.perspectives.length <= 1}
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

      {/* Monitoring wall */}
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
                  {renderPanel(panel, store.streams)}
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
                  {renderPanel(panel, store.streams)}
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

      {/* Dialogs */}
      {store.showAddPanel && store.draftPanels && (
        <AddPanelDialog
          streams={store.streams}
          existingPanels={store.draftPanels}
          onAdd={store.addPanel}
          onClose={() => store.setShowAddPanel(false)}
        />
      )}
      {store.showManageStreams && (
        <ManageStreamsDialog
          streams={store.streams}
          onChanged={store.refreshStreams}
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
