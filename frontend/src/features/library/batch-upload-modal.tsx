"use client";

import { AlertTriangle, Check, FileText, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { proposeFile } from "@/lib/api/library";
import { getActiveFileTypes, formatFileTypeOption, type ActiveFileType } from "./file-types";
import type { DuplicateMatch, FolderNode, UploadFormValues } from "./types";

async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function stripExt(name: string): string {
  return name.includes(".") ? name.replace(/\.[^.]+$/, "") : name;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Detect doc_type prefix from filename. Accepts both:
 *   - "TYPE-NUMBER-TITLE.ext"  (full format)
 *   - "TYPE-anything"          (just type, no archive number)
 * Returns null if the leading token before the first dash isn't a known type.
 */
function parseExistingNumber(
  filename: string,
  knownTypes: Set<string>,
): { docType: string; docNumber: string; titleRest: string } | null {
  const base = stripExt(filename);
  const firstDash = base.indexOf("-");
  if (firstDash === -1) return null;
  const prefix = base.slice(0, firstDash).toUpperCase().trim();
  if (!knownTypes.has(prefix)) return null;
  const rest = base.slice(firstDash + 1).trim();
  // Looks like "12345-rest" — treat as number-then-title
  const numMatch = rest.match(/^(\d{2,}[\w]*)\s*-\s*(.+)$/);
  if (numMatch) {
    return { docType: prefix, docNumber: numMatch[1], titleRest: numMatch[2].trim() };
  }
  return { docType: prefix, docNumber: "", titleRest: rest };
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
  duplicate: DuplicateMatch | null;
}

interface BatchUploadModalProps {
  files: File[];
  folder: FolderNode;
  onClose: () => void;
  onApproveAll: (items: ApprovedItem[]) => void;
}

// ── Modal ─────────────────────────────────────────────────────────────────────

export function BatchUploadModal({ files, folder, onClose, onApproveAll }: BatchUploadModalProps) {
  const [fileTypes, setFileTypes] = useState<ActiveFileType[]>([]);
  const docTypeOptions = useMemo(
    () => fileTypes.map((t) => ({ value: t.code, label: formatFileTypeOption(t) })),
    [fileTypes],
  );

  const [items, setItems] = useState<BatchItem[]>(() =>
    files.map((file, i) => ({
      key: `${i}-${file.name}-${file.size}`,
      file,
      phase: "detecting" as const,
      form: {
        folder_id: folder.id,
        doc_type: "",
        doc_number: "",
        title: stripExt(file.name),
        note: "",
      },
      docTypeConfidence: 0,
      duplicate: null,
    }))
  );

  // Load file types once on mount, then re-parse filenames against the dynamic set.
  useEffect(() => {
    let cancelled = false;
    getActiveFileTypes()
      .then((list) => {
        if (cancelled) return;
        setFileTypes(list);
        const knownSet = new Set(list.map((t) => t.code));
        setItems((prev) =>
          prev.map((it, i) => {
            const parsed = parseExistingNumber(files[i].name, knownSet);
            if (!parsed) return it;
            return {
              ...it,
              form: {
                ...it.form,
                doc_type: parsed.docType,
                doc_number: parsed.docNumber,
                title: parsed.titleRest || stripExt(files[i].name),
              },
              docTypeConfidence: 0.9,
            };
          })
        );
      })
      .catch(() => { /* fall back to empty list — user can still type manually */ });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const detectStarted = useRef(false);

  // Detect metadata for every file in parallel — each gets its own independent state slot
  useEffect(() => {
    if (detectStarted.current) return;
    detectStarted.current = true;

    files.forEach((file, index) => {
      // Hash + propose run in parallel; hash usually finishes first for small files,
      // so we attach it to the propose call once ready.
      sha256Hex(file)
        .catch(() => undefined) // fail-open: hash error shouldn't block upload flow
        .then((hash) => proposeFile(file.name, file.size, folder.id, hash))
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
                duplicate: prop.duplicate ?? null,
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

  // ── Bulk doc_type setters ───────────────────────────────────────────────────
  const [bulkType, setBulkType] = useState("");

  const applyBulkToAll = useCallback(() => {
    if (!bulkType) return;
    setItems((prev) =>
      prev.map((it) => ({ ...it, form: { ...it.form, doc_type: bulkType } }))
    );
  }, [bulkType]);

  const applyBulkToEmpty = useCallback(() => {
    if (!bulkType) return;
    setItems((prev) =>
      prev.map((it) =>
        it.form.doc_type
          ? it
          : { ...it, form: { ...it.form, doc_type: bulkType } }
      )
    );
  }, [bulkType]);

  const fillEmptyWithOther = useCallback(() => {
    setItems((prev) =>
      prev.map((it) =>
        it.form.doc_type
          ? it
          : { ...it, form: { ...it.form, doc_type: "OTHER" } }
      )
    );
  }, []);

  const emptyTypeCount = items.filter((it) => !it.form.doc_type).length;

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

        {/* Bulk doc_type toolbar */}
        {items.length > 1 && (
          <div className="flex flex-wrap items-center gap-2 px-4 py-2 bg-bg-ctrl border-b border-border shrink-0">
            <span className="text-[10.5px] font-bold uppercase tracking-wider text-text-light shrink-0">
              Atur sekaligus
            </span>
            <select
              value={bulkType}
              onChange={(e) => setBulkType(e.target.value)}
              className="field-select text-[11.5px] w-[150px]"
            >
              <option value="">— Tipe Dokumen —</option>
              {docTypeOptions.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <button
              onClick={applyBulkToAll}
              disabled={!bulkType}
              className="btn btn-default btn-sm text-[11px]"
              title="Set tipe ini untuk semua file"
            >
              Terapkan ke semua
            </button>
            <button
              onClick={applyBulkToEmpty}
              disabled={!bulkType || emptyTypeCount === 0}
              className="btn btn-default btn-sm text-[11px]"
              title={`Hanya untuk ${emptyTypeCount} file tanpa tipe`}
            >
              Yang kosong saja ({emptyTypeCount})
            </button>
            {emptyTypeCount > 0 && (
              <button
                onClick={fillEmptyWithOther}
                className="btn btn-default btn-sm text-[11px] text-text-muted"
                title="Tandai semua tanpa tipe sebagai OTHER"
              >
                Kosong → OTHER
              </button>
            )}
          </div>
        )}

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
                docTypeOptions={docTypeOptions}
                onSetField={setField}
                onRemove={removeItem}
              />
            ))
          )}
        </div>

        {/* Duplicate summary banner (above footer) */}
        {items.some((it) => it.duplicate) && (
          <div className="px-4 py-2 bg-amber-bg border-t border-amber/40 shrink-0 flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber shrink-0" />
            <div className="text-[11px] text-text leading-snug">
              <span className="font-semibold">
                {items.filter((it) => it.duplicate).length} file
              </span>{" "}
              terdeteksi sudah pernah diupload. Lihat detail di setiap kartu sebelum lanjut.
            </div>
          </div>
        )}

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
  docTypeOptions,
  onSetField,
  onRemove,
}: {
  item: BatchItem;
  index: number;
  docTypeOptions: { value: string; label: string }[];
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
          ) : item.duplicate ? (
            <AlertTriangle className="w-3 h-3 text-amber" />
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

      {/* Duplicate notice — surfaced whether or not the card is expanded */}
      {item.duplicate && (
        <div className="ml-8 mb-2 px-2.5 py-1.5 rounded border border-amber/40 bg-amber-bg text-[11px] leading-relaxed">
          <div className="flex items-start gap-1.5">
            <AlertTriangle className="w-3 h-3 text-amber shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-text font-semibold">File ini sudah pernah diupload</div>
              <div className="text-text-muted">
                Sebagai{" "}
                <span className="font-mono text-text">{item.duplicate.file_name}</span>
                {item.duplicate.doc_number && (
                  <> (nomor <span className="font-mono">{item.duplicate.doc_number}</span>)</>
                )}{" "}
                oleh {item.duplicate.uploader_name},{" "}
                {new Date(item.duplicate.uploaded_at).toLocaleDateString("id-ID", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
                . Anda tetap bisa lanjut upload kalau ini disengaja, atau hapus dari antrian.
              </div>
            </div>
          </div>
        </div>
      )}

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
                {docTypeOptions.map((t) => (
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
