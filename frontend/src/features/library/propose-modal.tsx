"use client";

import { FileText, Loader2, X, AlertCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { proposeFile, uploadFile } from "@/lib/api/library";
import type { FolderNode, ProposeResult, UploadFormValues } from "./types";

const DOC_TYPES = [
  { value: "Q", label: "Q — Quotation" },
  { value: "DRW", label: "DRW — Gambar Teknik" },
  { value: "INV", label: "INV — Invoice" },
  { value: "PO", label: "PO — Purchase Order" },
  { value: "SPK", label: "SPK — Surat Perintah Kerja" },
  { value: "RFP", label: "RFP — Request for Proposal" },
  { value: "RPT", label: "RPT — Report" },
  { value: "SPEC", label: "SPEC — Spesifikasi" },
  { value: "OTHER", label: "OTHER — Lainnya" },
];

const KNOWN_TYPES = new Set(["Q", "DRW", "INV", "PO", "SPK", "RFP", "RPT", "SPEC", "OTHER"]);

/** Parse existing archive number from a filename like "Q-2514-Nama File.pdf" */
function parseExistingNumber(filename: string): { docType: string; docNumber: string; titleRest: string } | null {
  const base = stripExt(filename);
  const match = base.match(/^([A-Za-z]+)-(\S+)-(.+)$/);
  if (!match) return null;
  const type = match[1].toUpperCase();
  if (!KNOWN_TYPES.has(type)) return null;
  return { docType: type, docNumber: match[2], titleRest: match[3].trim() };
}

type Phase = "detecting" | "editing" | "uploading" | "done" | "error";

interface ProposeModalProps {
  file: File;
  folder: FolderNode;
  onClose: () => void;
  onSuccess: (fileId: string, fileName: string) => void;
  queueIndex?: number;
  queueTotal?: number;
  onSkip?: () => void;
}

function barColor(c: number) {
  if (c >= 0.8) return "var(--green)";
  if (c >= 0.65) return "var(--amber)";
  return "var(--red)";
}

export function ProposeModal({ file, folder, onClose, onSuccess, queueIndex, queueTotal, onSkip }: ProposeModalProps) {
  const isBatch = queueTotal !== undefined && queueTotal > 1;

  // Detect existing TYPE-NUMBER-title pattern from filename
  const parsed = parseExistingNumber(file.name);

  const [phase, setPhase] = useState<Phase>("detecting");
  const [proposed, setProposed] = useState<ProposeResult | null>(null);
  const [form, setForm] = useState<UploadFormValues>({
    folder_id: folder.id,
    doc_type: parsed?.docType ?? "",
    doc_number: parsed?.docNumber ?? "",
    title: parsed?.titleRest ?? stripExt(file.name),
    note: "",
  });
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    proposeFile(file.name, file.size, folder.id)
      .then((prop) => {
        if (cancelled) return;
        setProposed(prop);
        setForm((prev) => ({
          ...prev,
          // Only override doc_type from AI if we didn't already detect it from filename
          doc_type: prev.doc_type || prop.detected.doc_type.value || "",
        }));
        setPhase("editing");
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Gagal mendeteksi metadata");
          setPhase("error");
        }
      });
    return () => { cancelled = true; };
  }, [file.name, file.size, folder.id]);

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

  const previewName = buildFilename(form, file.name);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-bg border border-border rounded-xl shadow-2xl w-full max-w-[440px] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border bg-bg-ctrl shrink-0">
          <div className="w-8 h-8 rounded-md bg-red-bg text-red flex items-center justify-center shrink-0">
            <FileText className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold font-mono truncate">{file.name}</div>
            <div className="text-[10.5px] text-text-muted">
              {formatBytes(file.size)} · {folder.path}
              {isBatch && (
                <span className="ml-2 font-semibold text-primary">
                  {(queueIndex ?? 0) + 1}/{queueTotal}
                </span>
              )}
            </div>
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

          {(phase === "editing" || phase === "uploading" || phase === "done") && (
            <div className="flex flex-col gap-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.07em] text-text-light">
                Metadata — Edit Sebelum Konfirmasi
              </p>

              {/* Doc type */}
              {proposed ? (
                <FieldRow label="Tipe Dokumen" confidence={proposed.detected.doc_type.confidence}>
                  <select value={form.doc_type} onChange={set("doc_type")} className="field-select">
                    <option value="">— Pilih tipe —</option>
                    {DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </FieldRow>
              ) : (
                <div>
                  <span className="text-[11px] text-text-muted block mb-0.5">Tipe Dokumen</span>
                  <select value={form.doc_type} onChange={set("doc_type")} className="field-select">
                    <option value="">— Pilih tipe —</option>
                    {DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
              )}

              {/* Existing archive number */}
              <div>
                <span className="text-[11px] text-text-muted block mb-0.5">
                  Nomor Arsip
                  <span className="ml-1 text-text-light">(opsional — kosongkan untuk auto)</span>
                </span>
                <input
                  type="text"
                  value={form.doc_number}
                  onChange={set("doc_number")}
                  placeholder="cth: 2514"
                  className="field-input font-mono"
                />
              </div>

              {/* Title */}
              <div>
                <span className="text-[11px] text-text-muted block mb-0.5">Judul / Nama Dokumen</span>
                <input type="text" value={form.title} onChange={set("title")} className="field-input" />
              </div>

              {/* Note */}
              <div>
                <span className="text-[11px] text-text-muted block mb-0.5">Catatan / Revisi</span>
                <input
                  type="text"
                  value={form.note}
                  onChange={set("note")}
                  placeholder="rev3, draft, final, dll"
                  className="field-input"
                />
              </div>

              {/* Filename preview */}
              <div className="bg-bg-ctrl border border-border rounded-lg px-3 py-2">
                <div className="text-[10px] font-bold uppercase tracking-[0.07em] text-text-light mb-1">
                  Preview nama file
                </div>
                <div className="text-[11.5px] font-mono break-all leading-relaxed text-text">
                  {previewName}
                </div>
                {!form.doc_number && (
                  <div className="text-[10px] text-text-light mt-1">
                    Nomor urutan ditentukan otomatis saat upload
                  </div>
                )}
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
            {isBatch && onSkip && phase === "editing" && (
              <button onClick={onSkip} className="btn btn-default">Lewati</button>
            )}
            {phase === "editing" && (
              <button onClick={handleConfirm} className="btn btn-primary flex-1">
                Konfirmasi & Unggah {isBatch ? "→" : ""}
              </button>
            )}
          </div>
        )}
        {phase === "done" && (
          <div className="flex gap-2 px-4 py-3 border-t border-border shrink-0">
            {isBatch && onSkip ? (
              <button onClick={onSkip} className="btn btn-primary flex-1">
                File Berikutnya →
              </button>
            ) : (
              <button onClick={onClose} className="btn btn-default flex-1">Tutup</button>
            )}
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
  const title = form.title ? clean(form.title) : stripExt(originalName);
  const note = form.note ? `-${clean(form.note)}` : "";
  if (form.doc_type) {
    const num = form.doc_number ? clean(form.doc_number) : "[auto]";
    return `${form.doc_type.toUpperCase()}-${num}-${title}${note}${ext}`;
  }
  return `${title}${note}${ext}`;
}

function stripExt(name: string): string {
  return name.includes(".") ? name.replace(/\.[^.]+$/, "") : name;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}
