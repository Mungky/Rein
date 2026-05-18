"use client";

import { Check, FileText, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { proposeFile } from "@/lib/api/library";
import type { FolderNode, UploadFormValues } from "./types";

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

function stripExt(name: string): string {
  return name.includes(".") ? name.replace(/\.[^.]+$/, "") : name;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function parseExistingNumber(filename: string): { docType: string; docNumber: string; titleRest: string } | null {
  const base = stripExt(filename);
  const match = base.match(/^([A-Za-z]+)-(\S+)-(.+)$/);
  if (!match) return null;
  const type = match[1].toUpperCase();
  if (!KNOWN_TYPES.has(type)) return null;
  return { docType: type, docNumber: match[2], titleRest: match[3].trim() };
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

function confidenceColor(c: number): string {
  if (c >= 0.8) return "var(--green)";
  if (c >= 0.65) return "var(--amber)";
  return "var(--red)";
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ApprovedItem {
  file: File;
  form: UploadFormValues;
}

interface BatchItem {
  key: string;
  file: File;
  phase: "detecting" | "ready";
  form: UploadFormValues;
  docTypeConfidence: number;
}

interface BatchUploadModalProps {
  files: File[];
  folder: FolderNode;
  onClose: () => void;
  onApproveAll: (items: ApprovedItem[]) => void;
}

// ── Modal ─────────────────────────────────────────────────────────────────────

export function BatchUploadModal({ files, folder, onClose, onApproveAll }: BatchUploadModalProps) {
  const [items, setItems] = useState<BatchItem[]>(() =>
    files.map((file, i) => {
      const parsed = parseExistingNumber(file.name);
      return {
        key: `${i}-${file.name}-${file.size}`,
        file,
        phase: "detecting" as const,
        form: {
          folder_id: folder.id,
          doc_type: parsed?.docType ?? "",
          doc_number: parsed?.docNumber ?? "",
          title: parsed?.titleRest ?? stripExt(file.name),
          note: "",
        },
        docTypeConfidence: parsed?.docType ? 0.9 : 0,
      };
    })
  );

  const detectStarted = useRef(false);

  // Detect metadata for every file in parallel — each gets its own independent state slot
  useEffect(() => {
    if (detectStarted.current) return;
    detectStarted.current = true;

    files.forEach((file, index) => {
      proposeFile(file.name, file.size, folder.id)
        .then((prop) => {
          setItems((prev) =>
            prev.map((it, i) => {
              if (i !== index) return it;
              const aiType = prop.detected.doc_type.value ?? "";
              const aiConf = prop.detected.doc_type.confidence;
              return {
                ...it,
                phase: "ready" as const,
                form: {
                  ...it.form,
                  // Only override doc_type from AI if not already parsed from filename
                  doc_type: it.form.doc_type || aiType,
                },
                docTypeConfidence: it.docTypeConfidence > 0 ? it.docTypeConfidence : aiConf,
              };
            })
          );
        })
        .catch(() => {
          // Detection failed — still mark ready so user can edit manually
          setItems((prev) =>
            prev.map((it, i) => i !== index ? it : { ...it, phase: "ready" as const })
          );
        });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setField = useCallback(
    (index: number, field: keyof UploadFormValues, value: string) => {
      setItems((prev) =>
        prev.map((it, i) =>
          i !== index ? it : { ...it, form: { ...it.form, [field]: value } }
        )
      );
    },
    []
  );

  const removeItem = useCallback((index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleStart = () => {
    if (items.length === 0) return;
    onApproveAll(items.map((it) => ({ file: it.file, form: it.form })));
    onClose();
  };

  const detectingCount = items.filter((it) => it.phase === "detecting").length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div
        className="bg-bg border border-border rounded-xl shadow-2xl w-full max-w-[640px] flex flex-col overflow-hidden"
        style={{ maxHeight: "90vh" }}
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border bg-bg-ctrl shrink-0">
          <FileText className="w-4 h-4 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold truncate">
              Upload ke {folder.path}
            </div>
            <div className="text-[10.5px] text-text-muted">
              {items.length} file dipilih
              {detectingCount > 0 && ` · mendeteksi metadata ${detectingCount} file…`}
            </div>
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-icon btn-sm text-text-muted shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Scrollable file list */}
        <div className="flex-1 overflow-y-auto divide-y divide-border-soft">
          {items.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-[13px] text-text-muted">
              Semua file dihapus dari antrian
            </div>
          ) : (
            items.map((item, index) => (
              <FileCard
                key={item.key}
                item={item}
                index={index}
                onSetField={setField}
                onRemove={removeItem}
              />
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-border shrink-0">
          <button onClick={onClose} className="btn btn-default">Batal</button>
          <div className="flex-1" />
          {detectingCount > 0 && (
            <span className="text-[11px] text-text-muted">
              {detectingCount} file masih terdeteksi…
            </span>
          )}
          <button
            onClick={handleStart}
            disabled={items.length === 0}
            className="btn btn-primary gap-1.5"
          >
            {detectingCount > 0 && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Mulai Upload {items.length} File →
          </button>
        </div>
      </div>
    </div>
  );
}

// ── File card ─────────────────────────────────────────────────────────────────

function FileCard({
  item,
  index,
  onSetField,
  onRemove,
}: {
  item: BatchItem;
  index: number;
  onSetField: (index: number, field: keyof UploadFormValues, value: string) => void;
  onRemove: (index: number) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const preview = buildFilename(item.form, item.file.name);

  return (
    <div className="px-4 py-3">
      {/* File header row */}
      <div className="flex items-center gap-2 mb-2">
        <div className="w-6 h-6 rounded bg-bg-ctrl border border-border flex items-center justify-center shrink-0">
          {item.phase === "detecting" ? (
            <Loader2 className="w-3 h-3 animate-spin text-primary" />
          ) : (
            <Check className="w-3 h-3 text-green" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-mono truncate text-text">{item.file.name}</div>
          <div className="text-[10px] text-text-muted">{formatBytes(item.file.size)}</div>
        </div>
        <button
          onClick={() => setExpanded((e) => !e)}
          className="text-[10.5px] text-text-muted hover:text-text px-1 shrink-0"
        >
          {expanded ? "▲ sembunyikan" : "▼ edit"}
        </button>
        <button
          onClick={() => onRemove(index)}
          className="btn btn-ghost btn-icon btn-sm text-text-muted hover:text-red shrink-0"
          title="Hapus dari antrian"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {expanded && (
        <div className="pl-8 flex flex-col gap-2">
          {/* Tipe + Nomor */}
          <div className="flex gap-2">
            <div className="flex-1">
              <div className="flex items-baseline justify-between mb-0.5">
                <span className="text-[10.5px] text-text-muted">Tipe Dokumen</span>
                {item.docTypeConfidence > 0 && (
                  <span
                    className="text-[10px] font-bold tabular-nums"
                    style={{ color: confidenceColor(item.docTypeConfidence) }}
                  >
                    {Math.round(item.docTypeConfidence * 100)}%
                  </span>
                )}
              </div>
              <select
                value={item.form.doc_type}
                onChange={(e) => onSetField(index, "doc_type", e.target.value)}
                className="field-select text-[12px]"
              >
                <option value="">— Pilih tipe —</option>
                {DOC_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div className="w-[96px] shrink-0">
              <span className="text-[10.5px] text-text-muted block mb-0.5">Nomor Arsip</span>
              <input
                type="text"
                value={item.form.doc_number}
                onChange={(e) => onSetField(index, "doc_number", e.target.value)}
                placeholder="auto"
                className="field-input font-mono text-[12px]"
              />
            </div>
          </div>

          {/* Judul */}
          <div>
            <span className="text-[10.5px] text-text-muted block mb-0.5">Judul / Nama Dokumen</span>
            <input
              type="text"
              value={item.form.title}
              onChange={(e) => onSetField(index, "title", e.target.value)}
              className="field-input text-[12px]"
            />
          </div>

          {/* Catatan */}
          <div>
            <span className="text-[10.5px] text-text-muted block mb-0.5">Catatan / Revisi</span>
            <input
              type="text"
              value={item.form.note}
              onChange={(e) => onSetField(index, "note", e.target.value)}
              placeholder="rev3, draft, final…"
              className="field-input text-[12px]"
            />
          </div>

          {/* Preview nama file */}
          <div className={`border rounded px-2.5 py-1.5 ${!item.form.doc_type ? "bg-amber-bg border-amber/40" : "bg-bg-ctrl border-border"}`}>
            <div className="text-[9.5px] font-bold uppercase tracking-widest text-text-light mb-0.5">
              Preview nama file
            </div>
            <div className="text-[11px] font-mono break-all text-text leading-relaxed">
              {preview}
            </div>
            {!item.form.doc_type && (
              <div className="text-[9.5px] text-amber font-semibold mt-0.5">
                Pilih tipe dokumen — file tanpa tipe akan ditolak saat audit
              </div>
            )}
            {!item.form.doc_number && item.form.doc_type && (
              <div className="text-[9.5px] text-text-light mt-0.5">
                Nomor urutan ditentukan otomatis saat upload
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
