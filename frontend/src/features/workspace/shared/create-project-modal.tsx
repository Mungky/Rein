"use client";

import { useState } from "react";
import { Loader2, X, Plus, FolderKanban, Sparkles } from "lucide-react";
import { apiErrorText } from "@/lib/api/client";
import { workspaceApi } from "@/lib/api/workspace";
import type { ProjectTemplate } from "@/lib/api/workspace";

export function CreateProjectModal({ templates, onClose, onCreated }: {
  templates: ProjectTemplate[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [rpoNumber, setRpoNumber] = useState("");
  const [clientName, setClientName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [deadline, setDeadline] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await workspaceApi.createProject({
        name: name.trim(),
        rpo_number: rpoNumber.trim() || undefined,
        client_name: clientName.trim() || undefined,
        template_id: templateId || undefined,
        start_date: startDate || undefined,
        deadline: deadline || undefined,
        description: description.trim() || undefined,
      });
      onCreated();
    } catch (err) {
      const msg = apiErrorText(err, "Gagal membuat proyek.");
      // Likely cause: duplicate RPO
      if (msg.toLowerCase().includes("unique") || msg.toLowerCase().includes("duplicate")) {
        setError("Nomor RPO sudah dipakai proyek lain. Gunakan nomor yang berbeda.");
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
          <div className="size-10 rounded-[var(--r-lg)] bg-gradient-to-br from-primary to-primary-hover text-white flex items-center justify-center shrink-0 shadow-[0_2px_8px_rgba(37,99,235,0.25)]">
            <FolderKanban className="size-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[16px] font-bold text-text leading-tight">Proyek Baru</h2>
            <p className="text-[12px] text-text-muted mt-0.5">Mulai proyek dengan nomor RPO + template opsional</p>
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-icon btn-sm -mr-1 -mt-1">
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 flex flex-col gap-4 overflow-y-auto">
          {/* RPO + Name on same row */}
          <div className="grid grid-cols-[180px_1fr] gap-3">
            <div>
              <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">No. RPO</label>
              <input
                className="field-input font-mono"
                placeholder="RPO-26-0007"
                required
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
                placeholder="Mis. Penggantian Pipa Cooling Tower"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">Klien</label>
            <input
              className="field-input"
              placeholder="Nama klien"
              required
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
            />
          </div>

          {templates.length > 0 && (
            <div>
              <label className="text-[12px] font-semibold text-text-muted mb-1.5 flex items-center gap-1.5">
                <Sparkles className="size-3 text-primary" />
                Template
              </label>
              <select
                className="field-select cursor-pointer"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
              >
                <option value="">— Tanpa template, mulai dari kosong —</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              {templateId && (
                <div className="text-[11px] text-primary mt-1.5 flex items-start gap-1">
                  <Sparkles className="size-3 mt-0.5 shrink-0" />
                  Phase &amp; task akan dibuat otomatis dari template.
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">Mulai</label>
              <input
                type="date"
                required
                className="field-input"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">Deadline</label>
              <input
                type="date"
                required
                className="field-input"
                min={startDate || undefined}
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
            disabled={loading || !name.trim() || !rpoNumber.trim() || !clientName.trim() || !startDate || !deadline}
            className="btn btn-primary gap-1.5"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {loading ? "Membuat…" : "Buat Proyek"}
          </button>
        </div>
      </form>
    </div>
  );
}
