"use client";

/** Add-panel dialog — TV style: pick a CHANNEL from the registry, done.
 *  Sources are not configured here anymore; that happens once per channel on
 *  halaman Channel. This dialog is just the remote control's channel list. */

import { useMemo, useState } from "react";
import { Search, Tv, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { CHANNEL_KINDS, channelKindLabel } from "./channel-form";
import { channelScreen } from "./screen-box";
import type { CanvasSize, Channel, Panel } from "./types";

export function AddPanelDialog({
  channels,
  existingPanels,
  canvas,
  onAdd,
  onClose,
}: {
  channels: Channel[];
  existingPanels: Panel[];
  canvas: CanvasSize;
  onAdd: (panel: Panel) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const list = [...channels]
      .filter((c) => c.enabled)
      .sort((a, b) => a.number - b.number);
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (c) =>
        String(c.number).includes(q) ||
        c.name.toLowerCase().includes(q) ||
        channelKindLabel(c.kind).toLowerCase().includes(q)
    );
  }, [channels, query]);

  function add(channel: Channel) {
    // Size follows the channel's SCREEN aspect (resolusi layar) — the screen
    // never squishes. First panel = as big as fits; later ones cascade at
    // half size; the editor (drag + snap, aspect locked) does the arranging.
    const screen = channelScreen(channel);
    const n = existingPanels.filter((p) => p.rect).length;
    const fit = Math.min(canvas.w / screen.w, canvas.h / screen.h);
    const scale = n === 0 ? fit : fit / 2;
    const w = Math.round(screen.w * scale);
    const h = Math.round(screen.h * scale);
    const off = n === 0 ? 0 : Math.min(32 * n, canvas.h - h, canvas.w - w);
    const rect = {
      x: Math.max(0, Math.min(off, canvas.w - w)),
      y: Math.max(0, Math.min(off, canvas.h - h)),
      w,
      h,
    };
    onAdd({
      id: crypto.randomUUID(),
      type: "channel",
      title: `CH ${channel.number} · ${channel.name}`,
      rect,
      config: { channel_id: channel.id },
    });
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel max-w-md flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-border-soft flex items-start gap-3 shrink-0">
          <div className="size-10 rounded-[var(--r-lg)] bg-gradient-to-br from-primary to-primary-hover text-white flex items-center justify-center shrink-0">
            <Tv className="size-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[16px] font-bold text-text leading-tight">
              Pilih Channel
            </h2>
            <p className="text-[12px] text-text-muted mt-0.5">
              Klik channel untuk menaruhnya di layout
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-icon btn-sm -mr-1 -mt-1"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-6 pt-4 shrink-0">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-light" />
            <input
              autoFocus
              className="field-input pl-8"
              placeholder="Cari nomor / nama channel…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Channel list */}
        <div className="px-6 py-4 flex flex-col gap-1.5 overflow-y-auto min-h-[120px] max-h-[50vh]">
          {channels.length === 0 ? (
            <p className="text-[12px] text-text-muted rounded-[var(--r)] border border-border-soft bg-bg-sidebar px-3 py-2.5">
              Belum ada channel. Buat dulu di tab{" "}
              <span className="font-semibold">Channel</span> — definisikan
              sumbernya sekali, lalu pakai di layout mana pun.
            </p>
          ) : filtered.length === 0 ? (
            <p className="py-4 text-center text-[12px] text-text-muted">
              Tidak ada channel cocok &ldquo;{query}&rdquo;
            </p>
          ) : (
            filtered.map((c) => {
              const KindIcon =
                CHANNEL_KINDS.find((k) => k.kind === c.kind)?.icon ?? Tv;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => add(c)}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-3 rounded-[var(--r-lg)] border border-border-soft bg-bg px-3 py-2.5 text-left",
                    "hover:border-primary/50 hover:bg-primary/5"
                  )}
                >
                  <span className="flex h-7 min-w-12 shrink-0 items-center justify-center rounded-[var(--r)] bg-primary/10 px-1.5 text-[12px] font-bold tabular-nums text-primary">
                    CH {c.number}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-text">
                    {c.name}
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-[11px] text-text-muted">
                    <KindIcon className="size-3" />
                    {channelKindLabel(c.kind)}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
