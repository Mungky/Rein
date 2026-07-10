"use client";

/** Halaman Channel — the TV-style registry. Every channel (number + nickname
 *  + one source) is defined here, once; the Monitor layouts just reference
 *  them. Also hosts the HLS stream-source manager (start-scada updates those
 *  rows, so they stay a separate, admin-managed list). */

import { useState } from "react";
import { Pencil, Plus, Radio, Trash2, Tv } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { scadaApi } from "@/lib/api/scada";
import { useScadaStore } from "./store";
import { ChannelForm, CHANNEL_KINDS, channelKindLabel } from "./channel-form";
import type { Channel, ChannelVideoConfig, WebPanelConfig } from "./types";

export function ChannelsView({ canManage }: { canManage: boolean }) {
  const store = useScadaStore();
  const [editingId, setEditingId] = useState<string | "new" | null>(null);

  const sorted = [...store.channels].sort((a, b) => a.number - b.number);

  function sourceSummary(c: Channel): string {
    if (c.kind === "video") {
      const cfg = c.config as ChannelVideoConfig;
      const stream = store.streams.find((s) => s.id === cfg.stream_id);
      const base = stream?.name ?? "stream terhapus";
      return cfg.cell != null ? `${base} · kotak ${cfg.cell + 1}` : base;
    }
    if (c.kind === "web") {
      try {
        return new URL((c.config as WebPanelConfig).url).hostname;
      } catch {
        return "alamat tidak valid";
      }
    }
    if (c.kind === "gauge") {
      const tagId = (c.config as { tag_id?: string }).tag_id;
      return store.tags.find((t) => t.id === tagId)?.label ?? "1 tag";
    }
    if (c.kind === "activity") return "pengguna online";
    const n = (c.config as { tag_ids?: string[] }).tag_ids?.length ?? 0;
    return `${n} tag`;
  }

  async function remove(c: Channel) {
    if (!window.confirm(`Hapus channel ${c.number} (${c.name})?`)) return;
    try {
      await scadaApi.deleteChannel(c.id);
      toast.success(`Channel ${c.number} dihapus`);
      await store.refreshChannels();
    } catch {
      toast.error("Gagal menghapus channel");
    }
  }

  async function onSaved() {
    await store.refreshChannels();
    setEditingId(null);
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-bg-sidebar">
      <div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-5 md:px-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-[var(--r-lg)] bg-gradient-to-br from-primary to-primary-hover text-white">
            <Tv className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-bold text-text leading-tight">
              Daftar Channel
            </h2>
            <p className="text-[12px] text-text-muted">
              Seperti channel TV: tiap nomor = satu sumber (stream, HMI web,
              atau data sensor). Susun tampilannya di tab Monitor.
            </p>
          </div>
          {canManage && (
            <button
              type="button"
              onClick={() => store.setShowManageStreams(true)}
              className="btn btn-ghost btn-sm gap-1.5"
              title="Sumber video HLS dari MediaMTX (alamatnya di-update otomatis oleh start-scada)"
            >
              <Radio className="size-3.5" />
              <span className="hidden sm:inline">Sumber Stream (HLS)</span>
            </button>
          )}
        </div>

        {/* Channel list */}
        {sorted.length === 0 && editingId === null && (
          <div className="flex flex-col items-center gap-2 rounded-[var(--r-lg)] border border-border-soft bg-bg py-10 text-center">
            <Tv className="size-8 text-text-light" />
            <p className="text-[13px] font-semibold text-text">Belum ada channel</p>
            <p className="text-[12px] text-text-muted">
              {canManage
                ? "Buat channel pertama — misalnya CH 1 untuk stream SCADA utama."
                : "Hubungi admin untuk menyiapkan daftar channel."}
            </p>
          </div>
        )}

        {sorted.map((c) => {
          const kindMeta = CHANNEL_KINDS.find((k) => k.kind === c.kind);
          const KindIcon = kindMeta?.icon ?? Tv;
          return (
            <div key={c.id} className="flex flex-col gap-3">
              <div
                className={cn(
                  "flex items-center gap-3 rounded-[var(--r-lg)] border bg-bg px-3.5 py-3",
                  editingId === c.id
                    ? "border-primary/50 ring-1 ring-primary/30"
                    : "border-border-soft"
                )}
              >
                <span
                  className={cn(
                    "flex h-8 min-w-14 shrink-0 items-center justify-center rounded-[var(--r)] px-2 text-[13px] font-bold tabular-nums",
                    c.enabled
                      ? "bg-primary/10 text-primary"
                      : "bg-bg-sidebar text-text-light"
                  )}
                >
                  CH {c.number}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-semibold text-text">
                    {c.name}
                    {!c.enabled && (
                      <span className="ml-2 text-[10.5px] font-semibold text-text-light">
                        NONAKTIF
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-[11.5px] text-text-muted">
                    <KindIcon className="size-3 shrink-0" />
                    <span className="shrink-0">{channelKindLabel(c.kind)}</span>
                    <span className="text-text-light">·</span>
                    <span className="min-w-0 truncate">{sourceSummary(c)}</span>
                  </div>
                </div>
                {canManage && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        editingId === c.id ? setEditingId(null) : setEditingId(c.id)
                      }
                      className={cn(
                        "btn btn-ghost btn-icon btn-sm",
                        editingId === c.id && "text-primary"
                      )}
                      title={editingId === c.id ? "Tutup" : "Ubah"}
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(c)}
                      className="btn btn-ghost btn-icon btn-sm text-red"
                      title="Hapus"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </>
                )}
              </div>
              {editingId === c.id && (
                <ChannelForm
                  initial={c}
                  channels={store.channels}
                  streams={store.streams}
                  tags={store.tags}
                  onSaved={onSaved}
                  onCancel={() => setEditingId(null)}
                />
              )}
            </div>
          );
        })}

        {canManage &&
          (editingId === "new" ? (
            <ChannelForm
              initial={null}
              channels={store.channels}
              streams={store.streams}
              tags={store.tags}
              onSaved={onSaved}
              onCancel={() => setEditingId(null)}
            />
          ) : editingId === null ? (
            <button
              type="button"
              onClick={() => setEditingId("new")}
              className="btn btn-secondary btn-sm self-start gap-1.5"
            >
              <Plus className="size-3.5" /> Tambah Channel
            </button>
          ) : null)}
      </div>
    </div>
  );
}
