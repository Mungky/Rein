"use client";

/** Add-panel dialog — TV style: pick a CHANNEL from the registry, done.
 *  Sources are not configured here anymore; that happens once per channel on
 *  halaman Channel. This dialog is just the remote control's channel list. */

import { useMemo, useState } from "react";
import { Search, Tv } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
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
    <Drawer
      title="Pilih Channel"
      subtitle="Klik channel untuk menaruhnya di layout"
      icon={<Tv className="size-5" />}
      onClose={onClose}
    >
        {/* Search */}
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-light" />
          <input
            autoFocus
            className="field-input pl-8"
            placeholder="Cari nomor / nama channel…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {/* Channel list */}
        <div className="flex flex-col gap-1.5">
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
    </Drawer>
  );
}
