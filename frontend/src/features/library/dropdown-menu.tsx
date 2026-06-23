"use client";

import {
  useCallback, useEffect, useRef, useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/**
 * Robust dropdown menu.
 *
 * Why a portal? The menu is rendered into `document.body` and positioned with
 * `position: fixed` from the trigger's bounding rect. That escapes every
 * `overflow:hidden` / `transform` ancestor (e.g. the sidebar rows use a
 * `-translate-y-1/2` wrapper, which would otherwise trap a child menu's
 * stacking context — making it appear "transparent" / behind sibling rows and
 * breaking a `fixed inset-0` backdrop).
 *
 * Behaviour:
 *  - Opens/closes on trigger click.
 *  - Closes on outside click, Escape, scroll, or resize.
 *  - Only ONE dropdown can be open at a time (module-level guard).
 */

let activeCloser: (() => void) | null = null;

interface DropdownMenuProps {
  /** Trigger button inner content (icon / label). */
  button: ReactNode;
  buttonClassName?: string;
  buttonTitle?: string;
  align?: "left" | "right";
  menuWidthClass?: string;
  /** Render menu items; call `close()` after an action runs. */
  children: (close: () => void) => ReactNode;
}

export function DropdownMenu({
  button, buttonClassName, buttonTitle,
  align = "right", menuWidthClass = "min-w-[180px]", children,
}: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left?: number; right?: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  const toggle = useCallback(() => {
    setOpen((o) => {
      const next = !o;
      if (next) {
        if (activeCloser && activeCloser !== close) activeCloser();
        activeCloser = close;
      } else if (activeCloser === close) {
        activeCloser = null;
      }
      return next;
    });
  }, [close]);

  // Position the menu under the trigger, in viewport coords.
  useEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setCoords(
      align === "right"
        ? { top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) }
        : { top: r.bottom + 4, left: Math.max(8, r.left) },
    );
  }, [open, align]);

  // Outside click / Escape / scroll / resize → close.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onScrollOrResize = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open]);

  // Clear the module guard on unmount.
  useEffect(() => () => { if (activeCloser === close) activeCloser = null; }, [close]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); toggle(); }}
        className={buttonClassName}
        title={buttonTitle}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {button}
      </button>

      {open && coords && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={{ position: "fixed", top: coords.top, left: coords.left, right: coords.right }}
          className={`z-[100] ${menuWidthClass} bg-bg border border-border rounded-lg shadow-xl overflow-hidden py-0.5`}
        >
          {children(close)}
        </div>,
        document.body,
      )}
    </>
  );
}

/** Convenience styled menu item for use inside DropdownMenu. */
export function DropdownItem({
  icon, label, onClick, danger, disabled,
}: {
  icon?: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      role="menuitem"
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-[12.5px] text-left transition-colors disabled:opacity-50
        ${danger ? "text-red hover:bg-red-bg" : "text-text hover:bg-bg-hover"}`}
    >
      {icon}
      {label}
    </button>
  );
}
