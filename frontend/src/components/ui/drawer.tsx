"use client";

/** Right-side drawer — the house style for long configuration forms
 *  (pengganti popup): the page dims, a panel slides in from the right, and
 *  the action buttons live in a footer PINNED to the bottom of the screen —
 *  no more scrolling to the very end to find Simpan.
 *
 *  Closes via the X button or pressing the dimmed area (mousedown must START
 *  on the backdrop, so drag-selecting text inside never closes it). */

import { X } from "lucide-react";

export function Drawer({
  title,
  subtitle,
  icon,
  width = 460,
  onClose,
  footer,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  /** Max panel width in px (full-width on small screens). */
  width?: number;
  onClose: () => void;
  /** Action row pinned to the bottom of the screen (e.g. Batal + Simpan). */
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="drawer-panel" style={{ maxWidth: width }}>
        {/* Header */}
        <div className="flex shrink-0 items-start gap-3 border-b border-border-soft px-5 pb-3.5 pt-4">
          {icon && (
            <div className="flex size-9 shrink-0 items-center justify-center rounded-[var(--r-lg)] bg-gradient-to-br from-primary to-primary-hover text-white">
              {icon}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-bold leading-tight text-text">{title}</h2>
            {subtitle && (
              <p className="mt-0.5 truncate text-[12px] text-text-muted">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-icon btn-sm -mr-1 -mt-0.5"
            title="Tutup"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body — scrolls on its own; the footer never moves */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {/* Footer — always at the bottom of the screen (inherits panel bg) */}
        {footer && (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border-soft px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
