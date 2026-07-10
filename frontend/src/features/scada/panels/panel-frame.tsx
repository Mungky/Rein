"use client";

/** Panel chrome: title strip with drag handle; remove button in edit mode.
 *  In fullscreen the strip is hidden entirely (pure monitoring wall) and the
 *  maximize control becomes a hover button instead. */

import { GripVertical, Maximize2, Minimize2, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function PanelFrame({
  title,
  editMode,
  fullscreen,
  onRemove,
  onMaximize,
  maximized = false,
  children,
}: {
  title: string;
  editMode: boolean;
  fullscreen: boolean;
  onRemove?: () => void;
  /** CCTV-style: expand this one panel to fill the wall (or restore). */
  onMaximize?: () => void;
  maximized?: boolean;
  children: React.ReactNode;
}) {
  const MaxIcon = maximized ? Minimize2 : Maximize2;
  return (
    <div
      className={cn(
        "group/frame relative flex h-full w-full flex-col overflow-hidden",
        fullscreen || maximized
          ? "rounded-none bg-black"
          : "rounded-[var(--r-lg)] border border-border bg-bg shadow-[var(--shadow-sm)]",
        editMode && "ring-1 ring-primary/40"
      )}
    >
      {!fullscreen && (
        <div
          className={cn(
            "flex h-7 min-h-7 items-center gap-1.5 border-b border-border-soft bg-bg-sidebar px-2",
            editMode && "panel-drag-handle cursor-grab active:cursor-grabbing"
          )}
        >
          {editMode && (
            <GripVertical className="size-3.5 shrink-0 text-text-light" />
          )}
          <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-text-muted">
            {title}
          </span>
          {!editMode && onMaximize && (
            <button
              type="button"
              onClick={onMaximize}
              className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-[var(--r-xs)] text-text-light hover:bg-bg-hover hover:text-text"
              title={maximized ? "Kembalikan ukuran" : "Perbesar channel ini"}
            >
              <MaxIcon className="size-3" />
            </button>
          )}
          {editMode && onRemove && (
            <button
              type="button"
              onClick={onRemove}
              onPointerDown={(e) => e.stopPropagation()}
              className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-[var(--r-xs)] text-text-light hover:bg-red/10 hover:text-red"
              title="Hapus panel"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1">{children}</div>

      {/* Fullscreen: hover control (title strip is hidden) — top-LEFT so it
          never collides with the ping badge / wall gear at top-right. */}
      {fullscreen && onMaximize && (
        <button
          type="button"
          onClick={onMaximize}
          className="absolute left-2 top-2 z-30 flex size-7 items-center justify-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/75 group-hover/frame:opacity-100"
          title={maximized ? "Kembalikan ukuran" : "Perbesar channel ini"}
        >
          <MaxIcon className="size-3.5" />
        </button>
      )}

      {/* Edit-mode affordance: visible resize grip at the bottom-right corner
          (react-grid-layout's actual handle sits on top of it) */}
      {editMode && (
        <svg
          className="pointer-events-none absolute bottom-1 right-1 z-10 text-primary"
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
        >
          <path d="M13 6L6 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M13 11L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      )}
    </div>
  );
}
