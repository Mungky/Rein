"use client";

/** Halaman Channel — OBS-style three sections:
 *  [ Daftar Channel | Preview channel terpilih | Sources ]
 *  Channels are the TV-style registry (number + nickname + one source);
 *  Sources shows every underlying source (HLS stream / URL) and which
 *  channel numbers use it. */

import { useMemo, useState } from "react";
import {
  Eye,
  Globe,
  MonitorPlay,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  ScreenShare,
  Trash2,
  Tv,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { scadaApi } from "@/lib/api/scada";
import { useScadaStore } from "./store";
import { ChannelForm, CHANNEL_KINDS, channelKindLabel } from "./channel-form";
import { renderChannelContent } from "./panels/panel-registry";
import { channelScreen } from "./screen-box";
import type { Channel, ScreenChannelConfig, SourceType } from "./types";

const SOURCE_TYPE_LABEL: Record<SourceType, string> = {
  stream: "Video Stream",
  web: "Halaman Web",
  vnc: "VNC",
};

export function ChannelsView({ canManage }: { canManage: boolean }) {
  const store = useScadaStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Live WYSIWYG: while the form below is open, the preview shows ITS draft.
  const [draft, setDraft] = useState<Channel | null>(null);

  const sorted = useMemo(
    () => [...store.channels].sort((a, b) => a.number - b.number),
    [store.channels]
  );
  const selected =
    sorted.find((c) => c.id === selectedId) ?? sorted[0] ?? null;

  // ── Sources: one row per registered Source, with the channels using it ──
  const sources = useMemo(() => {
    return store.streams.map((s) => ({
      key: `src:${s.id}`,
      label: s.name,
      detail:
        (s.source_type === "stream" ? s.hls_url : s.url) ?? "(tanpa alamat)",
      type: SOURCE_TYPE_LABEL[s.source_type],
      usedBy: store.channels
        .filter(
          (c) =>
            c.kind === "screen" &&
            (c.config as ScreenChannelConfig).stream_id === s.id
        )
        .map((c) => c.number)
        .sort((a, b) => a - b),
    }));
  }, [store.streams, store.channels]);

  async function refresh() {
    setRefreshing(true);
    try {
      await Promise.all([store.refreshChannels(), store.refreshStreams()]);
      toast.success("Daftar channel disegarkan");
    } catch {
      toast.error("Gagal menyegarkan");
    } finally {
      setRefreshing(false);
    }
  }

  async function remove(c: Channel) {
    if (!window.confirm(`Hapus channel ${c.number} (${c.name})?`)) return;
    try {
      await scadaApi.deleteChannel(c.id);
      toast.success(`Channel ${c.number} dihapus`);
      if (selectedId === c.id) setSelectedId(null);
      if (editingId === c.id) setEditingId(null);
      await store.refreshChannels();
    } catch {
      toast.error("Gagal menghapus channel");
    }
  }

  async function onSaved() {
    await store.refreshChannels();
    setEditingId(null);
    setDraft(null);
  }

  const editingChannel =
    editingId !== null && editingId !== "new"
      ? sorted.find((c) => c.id === editingId) ?? null
      : null;

  // What the preview canvas shows: the live draft while editing, else the
  // selected channel. Preview is ALWAYS on top; the form sits below it.
  const previewChannel = editingId !== null ? draft : selected;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
      {/* ── 1. Daftar Channel ── */}
      <section className="flex min-h-0 shrink-0 flex-col border-b border-border-soft bg-bg lg:w-[320px] lg:border-b-0 lg:border-r">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border-soft px-3">
          <Tv className="size-4 shrink-0 text-primary" />
          <span className="flex-1 text-[13px] font-bold text-text">
            Daftar Channel
            <span className="ml-1.5 text-[11px] font-semibold text-text-muted">
              {sorted.length}
            </span>
          </span>
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            className="btn btn-ghost btn-icon btn-sm"
            title="Segarkan daftar channel"
          >
            <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
          </button>
          {canManage && (
            <button
              type="button"
              onClick={() => setEditingId("new")}
              className="btn btn-secondary btn-sm gap-1"
              title="Tambah channel"
            >
              <Plus className="size-3.5" /> Baru
            </button>
          )}
        </div>
        <div className="max-h-[40vh] min-h-0 flex-1 overflow-y-auto p-2 lg:max-h-none">
          {sorted.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Tv className="size-7 text-text-light" />
              <p className="text-[12px] text-text-muted">
                {canManage
                  ? "Belum ada channel — klik “Baru”."
                  : "Belum ada channel. Hubungi admin."}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {sorted.map((c) => {
                const KindIcon =
                  CHANNEL_KINDS.find((k) => k.kind === c.kind)?.icon ?? Tv;
                const isSelected = selected?.id === c.id;
                return (
                  <div
                    key={c.id}
                    className={cn(
                      "group flex cursor-pointer items-center gap-2 rounded-[var(--r)] border px-2 py-1.5",
                      isSelected
                        ? "border-primary/50 bg-primary/5"
                        : "border-transparent hover:bg-bg-hover"
                    )}
                    onClick={() => {
                      setSelectedId(c.id);
                      if (editingId === "new") setEditingId(null);
                    }}
                  >
                    <span
                      className={cn(
                        "flex h-6 min-w-11 shrink-0 items-center justify-center rounded-[var(--r-sm)] px-1 text-[11px] font-bold tabular-nums",
                        c.enabled
                          ? "bg-primary/10 text-primary"
                          : "bg-bg-sidebar text-text-light"
                      )}
                    >
                      CH {c.number}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-text">
                      {c.name}
                    </span>
                    <KindIcon className="size-3 shrink-0 text-text-light" />
                    {canManage && (
                      <>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedId(c.id);
                            setEditingId(editingId === c.id ? null : c.id);
                          }}
                          className={cn(
                            "hidden size-6 shrink-0 items-center justify-center rounded-[var(--r-xs)] text-text-light hover:bg-bg-hover hover:text-text group-hover:flex",
                            editingId === c.id && "flex text-primary"
                          )}
                          title="Ubah"
                        >
                          <Pencil className="size-3" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void remove(c);
                          }}
                          className="hidden size-6 shrink-0 items-center justify-center rounded-[var(--r-xs)] text-text-light hover:bg-red/10 hover:text-red group-hover:flex"
                          title="Hapus"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ── 2. Preview / form ── */}
      <section className="flex min-h-0 flex-1 flex-col border-b border-border-soft bg-bg-sidebar lg:border-b-0">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border-soft bg-bg px-3">
          <Eye className="size-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-text">
            {editingId === "new"
              ? "Channel Baru"
              : selected
                ? `Preview — CH ${selected.number} · ${selected.name}`
                : "Preview"}
          </span>
          {selected && editingId === null && canManage && (
            <button
              type="button"
              onClick={() => setEditingId(selected.id)}
              className="btn btn-ghost btn-sm gap-1.5"
            >
              <Pencil className="size-3" /> Ubah
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="flex flex-col gap-3">
            {/* Preview — ALWAYS on top, on the channel's own screen canvas
                (letterboxed at its resolusi layar). Live-updates while the
                form below is being edited (WYSIWYG). */}
            {previewChannel ? (
              <div className="flex flex-col gap-2">
                <div className="aspect-video w-full overflow-hidden rounded-[var(--r-lg)] border border-border bg-black shadow-[var(--shadow-sm)]">
                  {renderChannelContent(previewChannel, store.streams, store.tags)}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-text-muted">
                  <span>
                    Jenis:{" "}
                    <span className="font-semibold text-text">
                      {channelKindLabel(previewChannel.kind)}
                    </span>
                  </span>
                  <span>
                    Layar:{" "}
                    <span className="font-semibold text-text">
                      {channelScreen(previewChannel).w}×
                      {channelScreen(previewChannel).h}
                    </span>
                  </span>
                  <span>
                    Status:{" "}
                    <span
                      className={cn(
                        "font-semibold",
                        previewChannel.enabled
                          ? "text-green-600"
                          : "text-text-light"
                      )}
                    >
                      {previewChannel.enabled ? "Aktif" : "Nonaktif"}
                    </span>
                  </span>
                  {editingId !== null && (
                    <span className="text-[11px] text-primary">
                      preview langsung — berubah saat form diisi
                    </span>
                  )}
                </div>
              </div>
            ) : editingId === null ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                <Eye className="size-7 text-text-light" />
                <p className="text-[12px] text-text-muted">
                  Pilih channel di kiri untuk melihat preview.
                </p>
              </div>
            ) : null}

            {/* Form — BELOW the preview so changes are visible immediately */}
            {editingId === "new" ? (
              <ChannelForm
                initial={null}
                channels={store.channels}
                streams={store.streams}
                tags={store.tags}
                onSaved={onSaved}
                onCancel={() => {
                  setEditingId(null);
                  setDraft(null);
                }}
                onDraftChange={setDraft}
              />
            ) : editingChannel ? (
              <ChannelForm
                initial={editingChannel}
                channels={store.channels}
                streams={store.streams}
                tags={store.tags}
                onSaved={onSaved}
                onCancel={() => {
                  setEditingId(null);
                  setDraft(null);
                }}
                onDraftChange={setDraft}
              />
            ) : null}
          </div>
        </div>
      </section>

      {/* ── 3. Sources ── */}
      <section className="flex min-h-0 shrink-0 flex-col bg-bg lg:w-[300px] lg:border-l lg:border-border-soft">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border-soft px-3">
          <Radio className="size-4 shrink-0 text-primary" />
          <span className="flex-1 text-[13px] font-bold text-text">Sources</span>
          {canManage && (
            <button
              type="button"
              onClick={() => store.setShowManageStreams(true)}
              className="btn btn-ghost btn-sm gap-1.5"
              title="Kelola sumber: Video Stream, Halaman Web, VNC"
            >
              <MonitorPlay className="size-3" /> Kelola
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {sources.length === 0 ? (
            <p className="px-2 py-6 text-center text-[12px] text-text-muted">
              Belum ada source — buka Kelola untuk menambah Video Stream,
              Halaman Web, atau VNC.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {sources.map((s) => (
                <div
                  key={s.key}
                  className="rounded-[var(--r)] border border-border-soft px-2.5 py-2"
                >
                  <div className="flex items-center gap-1.5">
                    {s.type === "Video Stream" ? (
                      <MonitorPlay className="size-3 shrink-0 text-primary" />
                    ) : s.type === "VNC" ? (
                      <ScreenShare className="size-3 shrink-0 text-primary" />
                    ) : (
                      <Globe className="size-3 shrink-0 text-primary" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-text">
                      {s.label}
                    </span>
                    <span className="shrink-0 rounded-full bg-bg-sidebar px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-text-muted">
                      {s.type}
                    </span>
                  </div>
                  <div
                    className="mt-0.5 truncate text-[10.5px] font-mono text-text-light"
                    title={s.detail}
                  >
                    {s.detail}
                  </div>
                  <div className="mt-1 text-[11px] text-text-muted">
                    {s.usedBy.length === 0 ? (
                      <span className="text-text-light">Belum dipakai channel</span>
                    ) : (
                      <>
                        Dipakai:{" "}
                        <span className="font-semibold text-text">
                          {s.usedBy.map((n) => `CH ${n}`).join(", ")}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
