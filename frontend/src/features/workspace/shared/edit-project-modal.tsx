"use client";

import { useState } from "react";
import { Loader2, X, Pencil } from "lucide-react";
import { apiErrorText } from "@/lib/api/client";
import { workspaceApi } from "@/lib/api/workspace";
import type { Project } from "@/lib/api/workspace";

const STATUS_OPTIONS: readonly { value: Project["status"]; label: string }[] = [
  { value: "planning",  label: "Planning — Perencanaan" },
  { value: "active",    label: "Active — Sedang berjalan" },
  { value: "on_hold",   label: "On Hold — Ditunda" },
  { value: "completed", label: "Completed — Selesai" },
];

export function EditProjectModal({ project, onClose, onUpdated, api = workspaceApi }: {
  api?: typeof workspaceApi;
  project: Project;
  onClose: () => void;
  onUpdated: (updated: Project) => void;
}) {
  const [name, setName] = useState(project.name);
  const [rpoNumber, setRpoNumber] = useState(project.rpo_number ?? "");
  const [clientName, setClientName] = useState(project.client_name ?? "");
  const [status, setStatus] = useState(project.status);
  const [startDate, setStartDate] = useState(project.start_date ?? "");
  const [deadline, setDeadline] = useState(project.deadline ?? "");
  const [description, setDescription] = useState(project.description ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const updated = await api.updateProject(project.id, {
        name: name.trim(),
        rpo_number: rpoNumber.trim() || undefined,
        client_name: clientName.trim() || undefined,
        status,
        start_date: startDate || undefined,
        deadline: deadline || undefined,
        description: description.trim() || undefined,
      });
      onUpdated(updated);
    } catch (err) {
      const msg = apiErrorText(err, "Gagal menyimpan perubahan.");
      if (msg.toLowerCase().includes("unique") || msg.toLowerCase().includes("duplicate")) {
        setError("Nomor RPO sudah dipakai proyek lain.");
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form
        onSubmit={submit}
        className="modal-panel max-w-lg flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-border-soft flex items-start gap-3 shrink-0">
          <div className="size-10 rounded-[var(--r-lg)] bg-bg-ctrl border border-border flex items-center justify-center shrink-0">
            <Pencil className="size-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[16px] font-bold text-text leading-tight">Edit Proyek</h2>
            <p className="text-[12px] text-text-muted mt-0.5 truncate">{project.name}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Tutup edit proyek" className="btn btn-ghost btn-icon btn-sm -mr-1 -mt-1">
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 flex flex-col gap-4 overflow-y-auto">
          {/* RPO + Name */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[160px_1fr]">
            <div>
              <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">No. RPO</label>
              <input
                className="field-input font-mono"
                placeholder="RPO-26-0007"
                value={rpoNumber}
                onChange={(e) => setRpoNumber(e.target.value)}
                maxLength={64}
              />
            </div>
            <div>
              <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
                Nama Proyek <span className="text-red">*</span>
              </label>
              <input
                required
                className="field-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">Klien</label>
            <input
              className="field-input"
              placeholder="Nama klien (opsional)"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
            />
          </div>

          <div>
            <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">Status</label>
            <select
              className="field-select"
              value={status}
              onChange={(e) => setStatus(e.target.value as Project["status"])
                /* select.value is widened to string by the DOM API — narrow back to the
                   literal union. The options array is the source of truth. */}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">Mulai</label>
              <input
                type="date"
                className="field-input"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">Deadline</label>
              <input
                type="date"
                className="field-input"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">Deskripsi</label>
            <textarea
              className="field-input min-h-[64px] py-2 resize-y"
              placeholder="Ringkasan singkat proyek (opsional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
            />
          </div>

          {error && (
            <div className="px-3 py-2 rounded-[var(--r)] bg-red-bg text-red text-[12.5px] border border-red/20">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border-soft bg-bg-ctrl flex gap-2 justify-end shrink-0">
          <button type="button" onClick={onClose} className="btn btn-default" disabled={loading}>
            Batal
          </button>
          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="btn btn-primary gap-1.5"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Pencil className="size-4" />}
            {loading ? "Menyimpan…" : "Simpan"}
          </button>
        </div>
      </form>
    </div>
  );
}
