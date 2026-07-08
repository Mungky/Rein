"use client";

/** Site management dialog — admin-only (scada:manage).
 *  CRUD for MQTT brokers ("Site"): a plant + its broker connection. The
 *  broker password is write-only — the API never returns it, so on edit we
 *  show a placeholder and only send a new value when the field is filled. */

import { useState } from "react";
import { Loader2, Pencil, Plus, Server, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { scadaApi } from "@/lib/api/scada";
import type { Site } from "./types";

interface SiteForm {
  name: string;
  mqtt_host: string;
  mqtt_port: string;
  mqtt_username: string;
  mqtt_password: string;
  base_topic: string;
  enabled: boolean;
}

const EMPTY_FORM: SiteForm = {
  name: "",
  mqtt_host: "",
  mqtt_port: "1883",
  mqtt_username: "",
  mqtt_password: "",
  base_topic: "",
  enabled: true,
};

export function ManageSitesDialog({
  sites,
  onChanged,
  onClose,
}: {
  sites: Site[];
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<SiteForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  function startEdit(site: Site | null) {
    if (site) {
      setEditingId(site.id);
      setForm({
        name: site.name,
        mqtt_host: site.mqtt_host,
        mqtt_port: String(site.mqtt_port),
        mqtt_username: site.mqtt_username ?? "",
        mqtt_password: "", // write-only — leave blank to keep the current one
        base_topic: site.base_topic,
        enabled: site.enabled,
      });
    } else {
      setEditingId("new");
      setForm(EMPTY_FORM);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.mqtt_host.trim()) return;
    const port = Number(form.mqtt_port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      toast.error("Port harus angka 1–65535");
      return;
    }
    setSaving(true);
    try {
      if (editingId === "new") {
        await scadaApi.createSite({
          name: form.name.trim(),
          mqtt_host: form.mqtt_host.trim(),
          mqtt_port: port,
          mqtt_username: form.mqtt_username.trim() || null,
          mqtt_password: form.mqtt_password || null,
          base_topic: form.base_topic.trim(),
          enabled: form.enabled,
        });
        toast.success("Site ditambahkan");
      } else if (editingId) {
        await scadaApi.updateSite(editingId, {
          name: form.name.trim(),
          mqtt_host: form.mqtt_host.trim(),
          mqtt_port: port,
          mqtt_username: form.mqtt_username.trim() || null,
          // Only send a password when the admin typed one
          ...(form.mqtt_password ? { mqtt_password: form.mqtt_password } : {}),
          base_topic: form.base_topic.trim(),
          enabled: form.enabled,
        });
        toast.success("Site diperbarui");
      }
      await onChanged();
      setEditingId(null);
    } catch {
      toast.error("Gagal menyimpan site");
    } finally {
      setSaving(false);
    }
  }

  async function remove(site: Site) {
    if (!window.confirm(`Hapus site "${site.name}"?`)) return;
    try {
      await scadaApi.deleteSite(site.id);
      toast.success("Site dihapus");
      await onChanged();
    } catch (e) {
      const msg =
        e instanceof Error && e.message.includes("dipakai")
          ? "Site masih dipakai tag — pindahkan/hapus tag-nya dulu"
          : "Gagal menghapus site";
      toast.error(msg);
    }
  }

  const editing = editingId === "new" ? null : sites.find((s) => s.id === editingId);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel max-w-lg flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-border-soft flex items-start gap-3 shrink-0">
          <div className="size-10 rounded-[var(--r-lg)] bg-gradient-to-br from-primary to-primary-hover text-white flex items-center justify-center shrink-0">
            <Server className="size-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[16px] font-bold text-text leading-tight">
              Kelola Site
            </h2>
            <p className="text-[12px] text-text-muted mt-0.5">
              Sumber data MQTT (broker per pabrik/lokasi)
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

        {/* Body */}
        <div className="px-6 py-5 flex flex-col gap-3 overflow-y-auto">
          {sites.length === 0 && editingId === null && (
            <p className="text-[12px] text-text-muted text-center py-4">
              Belum ada site. Tambahkan broker MQTT pertama.
            </p>
          )}

          {sites.map((site) => (
            <div
              key={site.id}
              className="flex items-center gap-2.5 rounded-[var(--r-lg)] border border-border-soft px-3 py-2.5"
            >
              <span
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  site.enabled ? "bg-green-500" : "bg-border"
                )}
                title={site.enabled ? "Aktif" : "Nonaktif"}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-text">
                  {site.name}
                </div>
                <div className="truncate text-[11px] font-mono text-text-muted">
                  {site.mqtt_host}:{site.mqtt_port}
                  {site.base_topic ? ` · ${site.base_topic}` : ""}
                </div>
              </div>
              <button
                type="button"
                onClick={() => startEdit(site)}
                className="btn btn-ghost btn-icon btn-sm"
                title="Ubah"
              >
                <Pencil className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => remove(site)}
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
                  placeholder="Mis. Pabrik Tanobel"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  maxLength={80}
                />
              </div>
              <div className="grid grid-cols-[1fr_100px] gap-3">
                <div>
                  <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
                    Host Broker <span className="text-red">*</span>
                  </label>
                  <input
                    required
                    className="field-input font-mono"
                    placeholder="broker.contoh.com"
                    value={form.mqtt_host}
                    onChange={(e) => setForm({ ...form, mqtt_host: e.target.value })}
                    maxLength={200}
                  />
                </div>
                <div>
                  <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
                    Port
                  </label>
                  <input
                    className="field-input font-mono"
                    inputMode="numeric"
                    value={form.mqtt_port}
                    onChange={(e) => setForm({ ...form, mqtt_port: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
                    User Broker
                  </label>
                  <input
                    className="field-input font-mono"
                    placeholder="opsional"
                    value={form.mqtt_username}
                    onChange={(e) =>
                      setForm({ ...form, mqtt_username: e.target.value })
                    }
                    maxLength={120}
                  />
                </div>
                <div>
                  <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
                    Password Broker
                  </label>
                  <input
                    className="field-input font-mono"
                    type="password"
                    placeholder={
                      editing?.has_password ? "•••• (kosong = tetap)" : "opsional"
                    }
                    value={form.mqtt_password}
                    onChange={(e) =>
                      setForm({ ...form, mqtt_password: e.target.value })
                    }
                    maxLength={200}
                  />
                </div>
              </div>
              <div>
                <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
                  Topik Dasar
                </label>
                <input
                  className="field-input font-mono"
                  placeholder="mis. rnet/tanobel (opsional, sekadar catatan)"
                  value={form.base_topic}
                  onChange={(e) => setForm({ ...form, base_topic: e.target.value })}
                  maxLength={200}
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-[12px] font-semibold text-text-muted">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                />
                Site aktif (bridge menyambung ke broker ini)
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
              <Plus className="size-3.5" /> Tambah Site
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
