"use client";

/** Stream management dialog — admin-only (scada:manage).
 *  CRUD for HLS stream sources: name, playlist URL, read credentials. */

import { useState } from "react";
import { Loader2, Pencil, Plus, Radio, RefreshCw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { scadaApi } from "@/lib/api/scada";
import type { Stream } from "./types";

interface StreamForm {
  name: string;
  hls_url: string;
  read_user: string;
  read_pass: string;
  enabled: boolean;
}

const EMPTY_FORM: StreamForm = {
  name: "",
  hls_url: "",
  read_user: "",
  read_pass: "",
  enabled: true,
};

export function ManageStreamsDialog({
  streams,
  onChanged,
  onRefresh,
  onClose,
}: {
  streams: Stream[];
  onChanged: () => Promise<void>;
  /** Re-fetch streams from the DB and force all video players to reconnect. */
  onRefresh: () => Promise<void>;
  onClose: () => void;
}) {
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<StreamForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    try {
      await onRefresh();
      toast.success("Stream disegarkan — video menyambung ulang");
    } catch {
      toast.error("Gagal menyegarkan stream");
    } finally {
      setRefreshing(false);
    }
  }

  function startEdit(stream: Stream | null) {
    if (stream) {
      setEditingId(stream.id);
      setForm({
        name: stream.name,
        hls_url: stream.hls_url,
        read_user: stream.read_user ?? "",
        read_pass: stream.read_pass ?? "",
        enabled: stream.enabled,
      });
    } else {
      setEditingId("new");
      setForm(EMPTY_FORM);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.hls_url.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        hls_url: form.hls_url.trim(),
        read_user: form.read_user.trim() || null,
        read_pass: form.read_pass.trim() || null,
        enabled: form.enabled,
      };
      if (editingId === "new") {
        await scadaApi.createStream(payload);
        toast.success("Stream ditambahkan");
      } else if (editingId) {
        await scadaApi.updateStream(editingId, payload);
        toast.success("Stream diperbarui");
      }
      await onChanged();
      setEditingId(null);
    } catch {
      toast.error("Gagal menyimpan stream");
    } finally {
      setSaving(false);
    }
  }

  async function remove(stream: Stream) {
    if (!window.confirm(`Hapus stream "${stream.name}"?`)) return;
    try {
      await scadaApi.deleteStream(stream.id);
      toast.success("Stream dihapus");
      await onChanged();
    } catch {
      toast.error("Gagal menghapus stream");
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel max-w-lg flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-border-soft flex items-start gap-3 shrink-0">
          <div className="size-10 rounded-[var(--r-lg)] bg-gradient-to-br from-primary to-primary-hover text-white flex items-center justify-center shrink-0">
            <Radio className="size-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[16px] font-bold text-text leading-tight">
              Kelola Stream
            </h2>
            <p className="text-[12px] text-text-muted mt-0.5">
              Sumber video HLS dari MediaMTX
            </p>
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            className="btn btn-ghost btn-sm -mt-1 gap-1.5"
            title="Ambil alamat stream terbaru dari database & sambungkan ulang video"
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
              Belum ada stream. Tambahkan sumber video pertama.
            </p>
          )}

          {streams.map((stream) => (
            <div
              key={stream.id}
              className="flex items-center gap-2.5 rounded-[var(--r-lg)] border border-border-soft px-3 py-2.5"
            >
              <span
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  stream.enabled ? "bg-green-500" : "bg-border"
                )}
                title={stream.enabled ? "Aktif" : "Nonaktif"}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-text">
                  {stream.name}
                </div>
                <div className="truncate text-[11px] font-mono text-text-muted">
                  {stream.hls_url}
                </div>
              </div>
              <button
                type="button"
                onClick={() => startEdit(stream)}
                className="btn btn-ghost btn-icon btn-sm"
                title="Ubah"
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
          ))}

          {editingId !== null ? (
            <form
              onSubmit={submit}
              className="flex flex-col gap-3 rounded-[var(--r-lg)] border border-primary/40 bg-primary/5 p-4"
            >
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
              <div>
                <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
                  URL HLS <span className="text-red">*</span>
                </label>
                <input
                  required
                  className="field-input font-mono"
                  placeholder="https://scada-stream.domain.com/scada/index.m3u8"
                  value={form.hls_url}
                  onChange={(e) => setForm({ ...form, hls_url: e.target.value })}
                />
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
                    onChange={(e) =>
                      setForm({ ...form, read_user: e.target.value })
                    }
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
                    onChange={(e) =>
                      setForm({ ...form, read_pass: e.target.value })
                    }
                    maxLength={128}
                  />
                </div>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-[12px] font-semibold text-text-muted">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) =>
                    setForm({ ...form, enabled: e.target.checked })
                  }
                />
                Stream aktif
              </label>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingId(null)}
                  className="btn btn-ghost btn-sm"
                >
                  Batal
                </button>
                <button type="submit" disabled={saving} className="btn btn-primary btn-sm">
                  {saving && <Loader2 className="size-3.5 animate-spin" />}
                  Simpan
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => startEdit(null)}
              className="btn btn-secondary btn-sm self-start gap-1.5"
            >
              <Plus className="size-3.5" /> Tambah Stream
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
