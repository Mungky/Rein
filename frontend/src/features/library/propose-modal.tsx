"use client";

import { FileText, Loader2, X, AlertCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { clientsApi, projectsApi } from "@/lib/api/clients";
import { proposeFile, uploadFile } from "@/lib/api/library";
import type { FolderNode, ProposeResult, UploadFormValues } from "./types";

const DOC_TYPES = [
  { value: "DRW", label: "DRW — Gambar Teknik" },
  { value: "INV", label: "INV — Invoice" },
  { value: "PO", label: "PO — Purchase Order" },
  { value: "SPK", label: "SPK — Surat Perintah Kerja" },
  { value: "RFP", label: "RFP — Request for Proposal" },
  { value: "RPT", label: "RPT — Report" },
  { value: "SPEC", label: "SPEC — Spesifikasi" },
  { value: "OTHER", label: "OTHER — Lainnya" },
];

type Phase = "detecting" | "editing" | "uploading" | "done" | "error";

interface ProposeModalProps {
  file: File;
  folder: FolderNode;
  onClose: () => void;
  onSuccess: (fileId: string, fileName: string) => void;
}

function barColor(c: number) {
  if (c >= 0.8) return "var(--green)";
  if (c >= 0.65) return "var(--amber)";
  return "var(--red)";
}

export function ProposeModal({ file, folder, onClose, onSuccess }: ProposeModalProps) {
  const [phase, setPhase] = useState<Phase>("detecting");
  const [proposed, setProposed] = useState<ProposeResult | null>(null);
  const [form, setForm] = useState<UploadFormValues>({
    folder_id: folder.id,
    doc_type: "",
    client_code: "",
    client_name: "",
    project_code: "",
    project_name: "",
    title: stripExt(file.name),
    note: "",
  });
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [clients, setClients] = useState<{ id: string; code: string; name: string }[]>([]);
  const [projects, setProjects] = useState<{ id: string; code: string; name: string; client_id: string }[]>([]);

  // Load clients + projects + run propose
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [c, p, prop] = await Promise.all([
          clientsApi.list(),
          projectsApi.list(),
          proposeFile(file.name, file.size, folder.id),
        ]);
        if (cancelled) return;
        setClients(c);
        setProjects(p);
        setProposed(prop);
        // Pre-fill form from detected metadata
        setForm((prev) => ({
          ...prev,
          doc_type: prop.detected.doc_type.value ?? "",
          client_code: prop.detected.client.code ?? "",
          client_name: prop.detected.client.value ?? "",
          project_code: prop.detected.project.code ?? "",
          project_name: prop.detected.project.value ?? "",
        }));
        setPhase("editing");
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Gagal mendeteksi metadata");
          setPhase("error");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [file.name, file.size, folder.id]);

  const filteredProjects = form.client_code
    ? projects.filter((p) => p.client_id === clients.find((c) => c.code === form.client_code)?.id)
    : projects;

  const handleConfirm = useCallback(async () => {
    setPhase("uploading");
    setProgress(0);
    try {
      const result = await uploadFile(file, { ...form, folder_id: folder.id }, setProgress);
      setPhase("done");
      onSuccess(result.file_id, result.file_name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload gagal");
      setPhase("error");
    }
  }, [file, form, folder.id, onSuccess]);

  const set = (field: keyof UploadFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  // Preview filename
  const previewName = buildFilename(form, file.name);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-bg border border-border rounded-xl shadow-2xl w-full max-w-[480px] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border bg-bg-ctrl shrink-0">
          <div className="w-8 h-8 rounded-md bg-red-bg text-red flex items-center justify-center shrink-0">
            <FileText className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold font-mono truncate">{file.name}</div>
            <div className="text-[10.5px] text-text-muted">{formatBytes(file.size)} · {folder.path}</div>
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-icon btn-sm text-text-muted">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {phase === "detecting" && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
              <span className="text-[13px] text-text-muted">Mendeteksi metadata…</span>
            </div>
          )}

          {(phase === "editing" || phase === "uploading" || phase === "done") && proposed && (
            <div className="flex flex-col gap-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.07em] text-text-light">
                Metadata — Edit Sebelum Konfirmasi
              </p>

              {/* Doc type */}
              <FieldRow label="Tipe Dokumen" confidence={proposed.detected.doc_type.confidence}>
                <select value={form.doc_type} onChange={set("doc_type")} className="field-select">
                  <option value="">— Pilih tipe —</option>
                  {DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </FieldRow>

              {/* Client */}
              <FieldRow label="Klien" confidence={proposed.detected.client.confidence}>
                <select
                  value={form.client_code}
                  onChange={(e) => {
                    const c = clients.find((x) => x.code === e.target.value);
                    setForm((p) => ({
                      ...p,
                      client_code: e.target.value,
                      client_name: c?.name ?? "",
                      project_code: "",
                      project_name: "",
                    }));
                  }}
                  className="field-select"
                >
                  <option value="">— Pilih klien —</option>
                  {clients.map((c) => <option key={c.id} value={c.code}>{c.code} — {c.name}</option>)}
                </select>
              </FieldRow>

              {/* Project */}
              <FieldRow label="Proyek" confidence={proposed.detected.project.confidence}>
                <select
                  value={form.project_code}
                  onChange={(e) => {
                    const p = filteredProjects.find((x) => x.code === e.target.value);
                    setForm((prev) => ({
                      ...prev,
                      project_code: e.target.value,
                      project_name: p?.name ?? "",
                    }));
                  }}
                  className="field-select"
                >
                  <option value="">— Pilih proyek —</option>
                  {filteredProjects.map((p) => <option key={p.id} value={p.code}>{p.code} — {p.name}</option>)}
                </select>
              </FieldRow>

              {/* Note */}
              <div>
                <span className="text-[11px] text-text-muted block mb-0.5">Note / Revisi</span>
                <input
                  type="text"
                  value={form.note}
                  onChange={set("note")}
                  placeholder="rev3, draft, final, dll"
                  className="field-input"
                />
              </div>

              {/* Title / filename middle */}
              <div>
                <span className="text-[11px] text-text-muted block mb-0.5">Judul / Nama Tengah</span>
                <input type="text" value={form.title} onChange={set("title")} className="field-input" />
              </div>

              {/* Filename preview */}
              <div className="bg-bg-ctrl border border-border rounded-lg px-3 py-2">
                <div className="text-[10px] font-bold uppercase tracking-[0.07em] text-text-light mb-1">
                  Preview nama file
                </div>
                <div className="text-[11.5px] font-mono break-all leading-relaxed text-text">
                  {previewName}
                </div>
              </div>

              {/* Upload progress */}
              {phase === "uploading" && (
                <div>
                  <div className="flex justify-between text-[11px] text-text-muted mb-1">
                    <span>Mengunggah…</span>
                    <span>{progress}%</span>
                  </div>
                  <div className="h-1.5 bg-bg-hover rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-200"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}

              {phase === "done" && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-bg text-green text-[12.5px] font-semibold">
                  File diterima dan sedang diaudit. Anda dapat menutup jendela ini.
                </div>
              )}
            </div>
          )}

          {phase === "error" && (
            <div className="flex items-start gap-2.5 px-3 py-3 rounded-lg bg-red-bg">
              <AlertCircle className="w-4 h-4 text-red shrink-0 mt-0.5" />
              <div>
                <div className="text-[12.5px] font-semibold text-red">Terjadi kesalahan</div>
                <div className="text-[11.5px] text-red/80 mt-0.5">{error}</div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {(phase === "editing" || phase === "error") && (
          <div className="flex gap-2 px-4 py-3 border-t border-border shrink-0">
            <button onClick={onClose} className="btn btn-default">Batal</button>
            {phase === "editing" && (
              <button onClick={handleConfirm} className="btn btn-primary flex-1">
                Konfirmasi & Unggah →
              </button>
            )}
          </div>
        )}
        {phase === "done" && (
          <div className="flex gap-2 px-4 py-3 border-t border-border shrink-0">
            <button onClick={onClose} className="btn btn-default flex-1">Tutup</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function FieldRow({
  label,
  confidence,
  children,
}: {
  label: string;
  confidence: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex justify-between items-baseline mb-0.5">
        <span className="text-[11px] text-text-muted">{label}</span>
        {confidence > 0 && (
          <span
            className="text-[10.5px] font-bold tabular-nums"
            style={{ color: barColor(confidence) }}
          >
            {Math.round(confidence * 100)}%
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function buildFilename(form: UploadFormValues, originalName: string): string {
  const ext = originalName.includes(".") ? "." + originalName.split(".").pop()!.toLowerCase() : "";
  const clean = (s: string) => s.replace(/[\\/:*?"<>|]/g, "").trim();
  const parts: string[] = [];
  if (form.doc_type) parts.push(form.doc_type.toUpperCase());
  if (form.client_code) parts.push(clean(form.client_code).toUpperCase());
  const middle = form.title ? clean(form.title) : stripExt(originalName);
  const suffix: string[] = [];
  if (form.project_name) suffix.push(clean(form.project_name));
  if (form.note) suffix.push(clean(form.note));
  const prefix = parts.length > 0 ? parts.join("-") + "-" : "";
  const suffixStr = suffix.length > 0 ? "-" + suffix.join("-") : "";
  return `${prefix}${middle}${suffixStr}${ext}`;
}

function stripExt(name: string): string {
  return name.includes(".") ? name.replace(/\.[^.]+$/, "") : name;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}
