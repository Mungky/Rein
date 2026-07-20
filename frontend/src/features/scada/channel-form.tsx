"use client";

/** Create/edit form for ONE TV-style channel (halaman Channel).
 *  A channel = number + nickname + ONE screen source. Per user decision
 *  (2026-07-19): channels are ONLY for screens — the three ways a screen can
 *  arrive (Halaman Web / Video Stream / VNC mirror) are configured in
 *  "Kelola Screen", so the old "Jenis Sumber" picker and the data-panel kinds
 *  (chart/gauge/…) are gone from this form. Data visuals live on the Monitor
 *  wall via the Data tab instead. */

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  Bell,
  Gauge,
  Globe,
  MonitorPlay,
  ScreenShare,
  Table2,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { scadaApi } from "@/lib/api/scada";
import type {
  Channel,
  ChannelKind,
  CropRect,
  ScreenChannelConfig,
  SourceType,
  Stream,
} from "./types";
import { CropEditor } from "./crop-editor";

export const CHANNEL_KINDS: {
  kind: ChannelKind;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { kind: "screen", label: "Video Screen", icon: MonitorPlay },
  { kind: "chart", label: "Grafik Sensor", icon: TrendingUp },
  { kind: "table", label: "Tabel Sensor", icon: Table2 },
  { kind: "gauge", label: "Angka / Status", icon: Gauge },
  { kind: "bar", label: "Bar Perbandingan", icon: BarChart3 },
  { kind: "alarm", label: "Alarm", icon: Bell },
  { kind: "activity", label: "Aktivitas", icon: Activity },
];

/** Icon + short label for a source's type — shown in the picker so it's clear
 *  whether a Screen is a video stream, a web page, or a VNC mirror. */
const SOURCE_TYPE_META: Record<
  SourceType,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  stream: { label: "Video Stream", icon: MonitorPlay },
  web: { label: "Halaman Web", icon: Globe },
  vnc: { label: "VNC (Layar PC)", icon: ScreenShare },
};

export function channelKindLabel(kind: ChannelKind): string {
  return CHANNEL_KINDS.find((k) => k.kind === kind)?.label ?? kind;
}

/** Ikon + label yang menyatakan SUMBER channel yang sebenarnya: channel
 *  "screen" mengikuti source_type dari Source yang dirujuknya (Video Stream /
 *  Halaman Web / VNC), bukan label generik "Video Screen"; kind data lama
 *  tetap pakai meta kind-nya. */
export function channelSourceMeta(
  channel: Channel,
  streams: Stream[]
): { label: string; icon: React.ComponentType<{ className?: string }> } {
  if (channel.kind === "screen") {
    const src = streams.find(
      (s) => s.id === (channel.config as ScreenChannelConfig).stream_id
    );
    if (src) return SOURCE_TYPE_META[src.source_type];
    return { label: "Sumber hilang", icon: MonitorPlay };
  }
  const k = CHANNEL_KINDS.find((x) => x.kind === channel.kind);
  return { label: k?.label ?? channel.kind, icon: k?.icon ?? MonitorPlay };
}

export function ChannelForm({
  initial,
  channels,
  streams,
  onSaved,
  onDraftChange,
}: {
  /** Existing channel when editing; null when creating. */
  initial: Channel | null;
  channels: Channel[];
  streams: Stream[];
  onSaved: () => Promise<void>;
  /** Live draft — fired on every field change so the preview above updates
   *  immediately (WYSIWYG editing). */
  onDraftChange?: (draft: Channel) => void;
}) {
  const enabledStreams = streams.filter((s) => s.enabled);

  const nextFreeNumber = useMemo(() => {
    const used = new Set(channels.map((c) => c.number));
    let n = 1;
    while (used.has(n)) n += 1;
    return n;
  }, [channels]);

  const init = initial;
  const [number, setNumber] = useState<number>(init?.number ?? nextFreeNumber);
  const [name, setName] = useState(init?.name ?? "");
  // Channels are screens, period — editing an old data-kind channel converts
  // it to a screen on save.
  const kind: ChannelKind = "screen";
  const [enabled, setEnabled] = useState(init?.enabled ?? true);
  const [saving, setSaving] = useState(false);

  // --- "screen" state: a Source (any type) + optional crop ---
  const screenCfg =
    init?.kind === "screen" ? (init.config as ScreenChannelConfig) : null;
  const [streamId, setStreamId] = useState(
    screenCfg?.stream_id ?? enabledStreams[0]?.id ?? ""
  );
  // Manual free crop (null = whole frame).
  const [crop, setCrop] = useState<CropRect | null>(screenCfg?.crop ?? null);
  const [srcW, setSrcW] = useState<number | null>(screenCfg?.src_w ?? null);
  const [srcH, setSrcH] = useState<number | null>(screenCfg?.src_h ?? null);

  // Screen resolution kept internally (CropEditor needs it for web sources);
  // no longer user-editable — the default 1920×1080 covers the real cases.
  const initScreen = init?.config as
    | { view_w?: number | null; view_h?: number | null }
    | undefined;
  const viewW = initScreen?.view_w ?? 1920;
  const viewH = initScreen?.view_h ?? 1080;

  const selectedStream = enabledStreams.find((s) => s.id === streamId);

  // Reset the crop when the chosen source changes — a crop drawn against one
  // source's resolution is meaningless on another.
  function pickSource(id: string) {
    setStreamId(id);
    setCrop(null);
    setSrcW(null);
    setSrcH(null);
  }

  const numberTaken = channels.some(
    (c) => c.number === number && c.id !== init?.id
  );
  const canSubmit = !numberTaken && number >= 1 && name.trim() !== "" && streamId !== "";

  function buildConfig(): Record<string, unknown> {
    return {
      view_w: Math.min(7680, Math.max(320, viewW || 1920)),
      view_h: Math.min(4320, Math.max(180, viewH || 1080)),
      stream_id: streamId,
      crop,
      src_w: srcW,
      src_h: srcH,
    };
  }

  // Live draft → the preview above updates as you type (WYSIWYG)
  const draftKey = JSON.stringify([
    number, name, enabled, streamId, crop, srcW, srcH,
  ]);
  useEffect(() => {
    onDraftChange?.({
      id: init?.id ?? "draft",
      number,
      name: name || "(belum diberi nama)",
      kind,
      config: buildConfig(),
      enabled,
      created_at: null,
      updated_at: null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    try {
      const payload = {
        number,
        name: name.trim(),
        kind,
        config: buildConfig(),
        enabled,
      };
      if (init) {
        await scadaApi.updateChannel(init.id, payload);
        toast.success(`Channel ${number} diperbarui`);
      } else {
        await scadaApi.createChannel(payload);
        toast.success(`Channel ${number} dibuat`);
      }
      await onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      toast.error(
        msg.includes("dipakai")
          ? `Nomor channel ${number} sudah dipakai`
          : "Gagal menyimpan channel"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      id="channel-form-drawer"
      onSubmit={submit}
      className="flex flex-col gap-3"
    >
      <div className="grid grid-cols-[110px_1fr] gap-3">
        <div>
          <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
            Nomor <span className="text-red">*</span>
          </label>
          <input
            type="number"
            min={1}
            max={100000}
            className={cn("field-input", numberTaken && "border-red")}
            value={number}
            onChange={(e) => setNumber(Math.max(1, Number(e.target.value) || 1))}
          />
          {numberTaken && (
            <p className="mt-1 text-[11px] text-red">Nomor sudah dipakai</p>
          )}
        </div>
        <div>
          <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
            Nama Channel <span className="text-red">*</span>
          </label>
          <input
            required
            className="field-input"
            placeholder="Mis. HMI Lombok · Tangki A Line 2"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
          />
        </div>
      </div>

      {/* ── Screen source: pick a Source (web / stream / vnc) + crop ── */}

      {(
        <>
          <div>
            <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
              Sumber (Screen) <span className="text-red">*</span>
            </label>
            {enabledStreams.length === 0 ? (
              <p className="text-[11.5px] text-text-muted rounded-[var(--r)] border border-border-soft bg-bg-sidebar px-3 py-2">
                Belum ada sumber. Tambah dulu lewat tombol{" "}
                <b>Kelola Screen</b> (Video Stream, Halaman Web, atau VNC).
              </p>
            ) : (
              <select
                className="field-select cursor-pointer"
                value={streamId}
                onChange={(e) => pickSource(e.target.value)}
              >
                {enabledStreams.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {SOURCE_TYPE_META[s.source_type].label}
                  </option>
                ))}
              </select>
            )}
            {selectedStream && (
              <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-text-light">
                {(() => {
                  const Icon = SOURCE_TYPE_META[selectedStream.source_type].icon;
                  return <Icon className="size-3.5" />;
                })()}
                {selectedStream.source_type === "vnc"
                  ? "Layar PC (VNC) — selalu tonton saja; pastikan server VNC juga view-only."
                  : selectedStream.source_type === "web"
                    ? "Halaman web / HMI — dimuat langsung di browser penonton."
                    : "Video stream (HLS/WebRTC) dari MediaMTX."}
              </p>
            )}
          </div>
          {selectedStream && (
            <CropEditor
              source={selectedStream}
              crop={crop}
              viewW={viewW}
              viewH={viewH}
              onChange={(c, w, h) => {
                setCrop(c);
                setSrcW(w);
                setSrcH(h);
              }}
            />
          )}
        </>
      )}


      <label className="flex cursor-pointer items-center gap-2 text-[12px] font-semibold text-text-muted">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        Channel aktif
      </label>
      {saving && (
        <p className="text-[11.5px] text-text-muted">Menyimpan…</p>
      )}
      {/* Tombol Simpan/Batal hidup di footer drawer (channels-view) —
          disambungkan lewat atribut form="channel-form-drawer". */}
    </form>
  );
}
