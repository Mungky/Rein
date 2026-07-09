"use client";

/** Typeable channel picker for the Video Wall. Shows at most ~5 rows at a
 *  time (scroll for the rest) and filters as you type by number or name — so
 *  it stays usable whether there are 4 channels or 400. */

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Channel } from "./channels";

export function ChannelCombobox({
  channels,
  value,
  onChange,
  dark = false,
}: {
  channels: Channel[];
  value: number | null;
  onChange: (channelNumber: number | null) => void;
  /** Style the trigger for a dark backdrop (the in-wall edit overlay). */
  dark?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = value != null ? channels.find((c) => c.number === value) ?? null : null;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return channels;
    return channels.filter(
      (c) => String(c.number).includes(q) || c.label.toLowerCase().includes(q)
    );
  }, [channels, query]);

  const pick = (n: number | null) => {
    onChange(n);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={rootRef} className="relative w-full">
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center gap-1 rounded-[var(--r-xs)] px-1.5 py-1 text-left text-[11px]",
          dark
            ? "bg-black/75 text-white backdrop-blur-sm"
            : "border border-border-soft bg-bg text-text hover:border-border"
        )}
      >
        <span className={cn("min-w-0 flex-1 truncate", !selected && (dark ? "text-white/50" : "text-text-light"))}>
          {selected ? `Ch ${selected.number} · ${selected.label}` : "— kosong —"}
        </span>
        <ChevronsUpDown className={cn("size-3 shrink-0", dark ? "text-white/60" : "text-text-light")} />
      </button>

      {open && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute left-0 top-[calc(100%+2px)] z-50 w-full min-w-[190px] overflow-hidden rounded-[var(--r)] border border-border bg-bg shadow-[var(--shadow-lg)]"
        >
          <div className="border-b border-border-soft p-1">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ketik nomor / nama…"
              className="w-full rounded-[var(--r-xs)] bg-bg-sidebar px-2 py-1 text-[11.5px] text-text outline-none placeholder:text-text-light"
            />
          </div>
          {/* ~5 rows tall, then scroll */}
          <div className="max-h-[160px] overflow-y-auto py-1">
            <Row active={value == null} onClick={() => pick(null)}>
              <X className="size-3 text-text-light" />
              <span className="text-text-muted">— kosong —</span>
            </Row>
            {filtered.map((c) => (
              <Row key={c.number} active={c.number === value} onClick={() => pick(c.number)}>
                <span className="font-semibold tabular-nums">Ch {c.number}</span>
                <span className="min-w-0 flex-1 truncate text-text-muted">· {c.label}</span>
                {c.number === value && <Check className="size-3 shrink-0 text-primary" />}
              </Row>
            ))}
            {filtered.length === 0 && (
              <div className="px-2.5 py-2 text-[11.5px] text-text-light">
                Tidak ada channel cocok
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-8 w-full cursor-pointer items-center gap-1.5 px-2.5 text-left text-[11.5px]",
        active ? "bg-primary/8 text-text" : "text-text hover:bg-bg-hover"
      )}
    >
      {children}
    </button>
  );
}
