"use client";

/** "Kelola Screen" dialog — admin-only (scada:manage). One place to register
 *  every SOURCE a channel can show: a video Stream (HLS/WebRTC), a Web page,
 *  or a VNC mirror. Pick the type at the top; only the fields that type needs
 *  are shown. Channels then reference a source by id and crop it (crop lives
 *  on the channel, not here — no more mosaic). */

import { useState } from "react";
import {
  Globe,
  Loader2,
  MonitorPlay,
  Pencil,
  Plus,
  RefreshCw,
  ScreenShare,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { scadaApi } from "@/lib/api/scada";
import type { SourceType, Stream } from "./types";

interface ScreenForm {
  name: string;
  source_type: SourceType;
  // stream
  hls_url: string;
  webrtc_url: string;
  read_user: string;
  read_pass: string;
  // web / vnc
  url: string;
  secret: string; // vnc view-only password
  enabled: boolean;
}

const EMPTY_FORM: ScreenForm = {
  name: "",
  source_type: "stream",
  hls_url: "",
  webrtc_url: "",
  read_user: "",
  read_pass: "",
  url: "",
  secret: "",
  enabled: true,
};

const TYPE_META: Record<
  SourceType,
  { label: string; icon: React.ComponentType<{ className?: string }>; hint: string }
> = {
  stream: {
    label: "Video Stream",
    icon: MonitorPlay,
    hint: "HLS/WebRTC dari MediaMTX",
  },
  web: { label: "Halaman Web", icon: Globe, hint: "Situs / HMI (mis. V-Net)" },
  vnc: {
    label: "VNC (Layar PC)",
    icon: ScreenShare,
    hint: "Spion layar PC, view-only",
  },
};

function sourceAddress(s: Stream): string {
  if (s.source_type === "stream") return s.hls_url ?? "(tanpa URL)";
  return s.url ?? "(tanpa alamat)";
}

export function ManageStreamsDialog({
  streams,
  onChanged,
  onRefresh,
  onClose,
}: {
  streams: Stream[];
  onChanged: () => Promise<void>;
  /** Re-fetch sources from the DB and force all video players to reconnect. */
  onRefresh: () => Promise<void>;
  onClose: () => void;
}) {
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<ScreenForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    try {
      await onRefresh();
      toast.success("Sumber disegarkan — video menyambung ulang");
    } catch {
      toast.error("Gagal menyegarkan sumber");
    } finally {
      setRefreshing(false);
    }
  }

  function startEdit(stream: Stream | null) {
    if (stream) {
      setEditingId(stream.id);
      setForm({
        name: stream.name,
        source_type: stream.source_type,
        hls_url: stream.hls_url ?? "",
        webrtc_url: stream.webrtc_url ?? "",
        read_user: stream.read_user ?? "",
        read_pass: stream.read_pass ?? "",
        url: stream.url ?? "",
        secret: stream.secret ?? "",
        enabled: stream.enabled,
      });
    } else {
      setEditingId("new");
      setForm(EMPTY_FORM);
    }
  }

  // The one required address field per type must be filled before saving.
  const addressOk =
    form.source_type === "stream"
      ? form.hls_url.trim() !== ""
      : form.url.trim() !== "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !addressOk) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        source_type: form.source_type,
        hls_url: form.source_type === "stream" ? form.hls_url.trim() : null,
        webrtc_url:
          form.source_type === "stream" ? form.webrtc_url.trim() || null : null,
        read_user:
          form.source_type === "stream" ? form.read_user.trim() || null : null,
        read_pass:
          form.source_type === "stream" ? form.read_pass.trim() || null : null,
        url: form.source_type === "stream" ? null : form.url.trim(),
        secret: form.source_type === "vnc" ? form.secret.trim() || null : null,
        enabled: form.enabled,
      };
      if (editingId === "new") {
        await scadaApi.createStream(payload);
        toast.success("Sumber ditambahkan");
      } else if (editingId) {
        await scadaApi.updateStream(editingId, payload);
        toast.success("Sumber diperbarui");
      }
      await onChanged();
      setEditingId(null);
    } catch {
      toast.error("Gagal menyimpan sumber");
    } finally {
      setSaving(false);
    }
  }

  async function remove(stream: Stream) {
    if (!window.confirm(`Hapus sumber "${stream.name}"?`)) return;
    try {
      await scadaApi.deleteStream(stream.id);
      toast.success("Sumber dihapus");
      await onChanged();
    } catch {
      toast.error("Gagal menghapus sumber");
    }
  }

  const isStream = form.source_type === "stream";
  const isVnc = form.source_type === "vnc";

  const editFormEl = (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-[var(--r-lg)] border border-primary/40 bg-primary/5 p-4"
    >
      <div className="flex items-center gap-2 border-b border-primary/15 pb-2.5">
        {editingId === "new" ? (
          <Plus className="size-4 shrink-0 text-primary" />
        ) : (
          <Pencil className="size-4 shrink-0 text-primary" />
        )}
        <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-text">
          {editingId === "new" ? "Sumber Baru" : `Ubah: ${form.name || "sumber ini"}`}
        </span>
      </div>

      {/* Type selector — decides which fields show below */}
      <div>
        <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
          Jenis Sumber
        </label>
        <div className="grid grid-cols-3 gap-1.5">
          {(Object.keys(TYPE_META) as SourceType[]).map((t) => {
            const { label, icon: Icon, hint } = TYPE_META[t];
            return (
              <button
                key={t}
                type="button"
                onClick={() => setForm({ ...form, source_type: t })}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-[var(--r)] border px-1.5 py-2 text-center",
                  form.source_type === t
                    ? "border-primary bg-primary/5 text-text"
                    : "border-border-soft bg-bg text-text-muted cursor-pointer hover:border-border"
                )}
              >
                <Icon className="size-4" />
                <span className="text-[10.5px] font-semibold leading-tight">
                  {label}
                </span>
                <span className="text-[9px] font-normal leading-tight text-text-light">
                  {hint}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
          Nama <span className="text-red">*</span>
        </label>
        <input
          required
          className="field-input"
          placeholder="Mis. SCADA Utama"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          maxLength={120}
        />
      </div>

      {/* ── Video Stream fields ── */}
      {isStream && (
        <>
          <div>
            <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
              URL HLS <span className="text-red">*</span>
            </label>
            <input
              className="field-input font-mono"
              placeholder="https://stream.domain.com/scada/index.m3u8"
              value={form.hls_url}
              onChange={(e) => setForm({ ...form, hls_url: e.target.value })}
            />
          </div>
          <div>
            <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
              URL WebRTC (opsional — delay &lt;1 detik)
            </label>
            <input
              className="field-input font-mono"
              placeholder="https://webrtc.domain.com/server/whep"
              value={form.webrtc_url}
              onChange={(e) => setForm({ ...form, webrtc_url: e.target.value })}
            />
            <p className="mt-1 text-[11px] text-text-light">
              Diisi = pemutar mencoba WebRTC dulu (nyaris tanpa delay), otomatis
              balik ke HLS bila jaringan penonton memblokirnya.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
                User (read)
              </label>
              <input
                className="field-input font-mono"
                placeholder="rein-viewer"
                value={form.read_user}
                onChange={(e) => setForm({ ...form, read_user: e.target.value })}
                maxLength={64}
              />
            </div>
            <div>
              <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
                Password (read)
              </label>
              <input
                className="field-input font-mono"
                type="password"
                value={form.read_pass}
                onChange={(e) => setForm({ ...form, read_pass: e.target.value })}
                maxLength={128}
              />
            </div>
          </div>
        </>
      )}

      {/* ── Web / VNC address ── */}
      {!isStream && (
        <div>
          <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
            {isVnc ? "Alamat noVNC / websockify" : "Alamat Halaman"}{" "}
            <span className="text-red">*</span>
          </label>
          <input
            className="field-input font-mono"
            placeholder={
              isVnc
                ? "https://vnc-scada.contoh.com  (otomatis jadi wss://)"
                : "https://vnet.wecon.com.cn/..."
            }
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
            maxLength={2048}
          />
        </div>
      )}

      {/* ── VNC view-only password ── */}
      {isVnc && (
        <div>
          <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
            Password VNC (view-only, opsional)
          </label>
          <input
            type="password"
            className="field-input font-mono"
            placeholder="Password view-only — kosongkan jika tanpa password"
            value={form.secret}
            onChange={(e) => setForm({ ...form, secret: e.target.value })}
            maxLength={128}
            autoComplete="off"
          />
          <p className="mt-1 text-[11px] text-text-light">
            Selalu <b>tonton saja</b> — klik/keyboard tak pernah dikirim ke PC
            sumber. Pastikan server VNC juga disetel view-only, dan pakai
            password khusus view-only (terbaca semua pengguna R-Net).
          </p>
        </div>
      )}

      <label className="flex cursor-pointer items-center gap-2 text-[12px] font-semibold text-text-muted">
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
        />
        Sumber aktif
      </label>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setEditingId(null)}
          className="btn btn-ghost btn-sm"
        >
          Batal
        </button>
        <button
          type="submit"
          disabled={saving || !addressOk}
          className="btn btn-primary btn-sm"
        >
          {saving && <Loader2 className="size-3.5 animate-spin" />}
          Simpan
        </button>
      </div>
    </form>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel max-w-lg flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-border-soft flex items-start gap-3 shrink-0">
          <div className="size-10 rounded-[var(--r-lg)] bg-gradient-to-br from-primary to-primary-hover text-white flex items-center justify-center shrink-0">
            <MonitorPlay className="size-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[16px] font-bold text-text leading-tight">
              Kelola Screen
            </h2>
            <p className="text-[12px] text-text-muted mt-0.5">
              Sumber tampilan channel: Video Stream · Halaman Web · VNC
            </p>
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            className="btn btn-ghost btn-sm -mt-1 gap-1.5"
            title="Ambil alamat terbaru dari database & sambungkan ulang video"
          >
            <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
            Segarkan
          </button>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-icon btn-sm -mr-1 -mt-1"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 flex flex-col gap-3 overflow-y-auto">
          {streams.length === 0 && editingId === null && (
            <p className="text-[12px] text-text-muted text-center py-4">
              Belum ada sumber. Tambahkan Video Stream, Halaman Web, atau VNC.
            </p>
          )}

          {streams.map((stream) => {
            const { icon: Icon, label } = TYPE_META[stream.source_type];
            return (
              <div key={stream.id} className="flex flex-col gap-3">
                <div
                  className={cn(
                    "flex items-center gap-2.5 rounded-[var(--r-lg)] border px-3 py-2.5",
                    editingId === stream.id
                      ? "border-primary/50 bg-primary/5 ring-1 ring-primary/30"
                      : "border-border-soft"
                  )}
                >
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      stream.enabled ? "bg-green-500" : "bg-border"
                    )}
                    title={stream.enabled ? "Aktif" : "Nonaktif"}
                  />
                  <Icon className="size-4 shrink-0 text-text-muted" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-semibold text-text">
                        {stream.name}
                      </span>
                      <span className="shrink-0 rounded-full bg-bg-sidebar px-1.5 py-px text-[9.5px] font-semibold text-text-muted">
                        {label}
                      </span>
                    </div>
                    <div className="truncate text-[11px] font-mono text-text-muted">
                      {sourceAddress(stream)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      editingId === stream.id ? setEditingId(null) : startEdit(stream)
                    }
                    className={cn(
                      "btn btn-ghost btn-icon btn-sm",
                      editingId === stream.id && "text-primary"
                    )}
                    title={editingId === stream.id ? "Tutup" : "Ubah"}
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(stream)}
                    className="btn btn-ghost btn-icon btn-sm text-red"
                    title="Hapus"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                {editingId === stream.id && editFormEl}
              </div>
            );
          })}

          {editingId === "new" ? (
            editFormEl
          ) : editingId === null ? (
            <button
              type="button"
              onClick={() => startEdit(null)}
              className="btn btn-secondary btn-sm self-start gap-1.5"
            >
              <Plus className="size-3.5" /> Tambah Sumber
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
