"use client";

/** Admin — Sequences tab: last-used document numbers per doc type.
 *  Moved verbatim from app/(app)/admin/page.tsx. */

import { useState, useEffect } from "react";
import { CheckCircle, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { getSequences, setSequence } from "@/lib/api/library";
import type { DocumentSequence } from "@/features/library/types";
import { ErrorBanner, LoadingState } from "./shared";

export function SequencesTab() {
  const [sequences, setSequences] = useState<DocumentSequence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    getSequences()
      .then(({ sequences }) => setSequences(sequences))
      .catch((e) => setError(e instanceof Error ? e.message : "Gagal memuat"))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (docType: string) => {
    const val = parseInt(editing[docType] ?? "", 10);
    if (isNaN(val) || val < 0) return;
    setSaving(docType);
    try {
      await setSequence(docType, val);
      setSequences((prev) => prev.map((s) => s.doc_type === docType ? { ...s, current_number: val } : s));
      setEditing((prev) => { const next = { ...prev }; delete next[docType]; return next; });
      setSaved(docType);
      setTimeout(() => setSaved(null), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setSaving(null);
    }
  };

  if (loading) return <LoadingState label="Memuat nomor urutan…" />;

  return (
    <div className="px-4 md:px-8 py-6 max-w-2xl">
      <div className="mb-5">
        <h2 className="text-[16px] font-bold text-text leading-tight">Nomor Urutan Dokumen</h2>
        <p className="text-[12.5px] text-text-muted mt-1 leading-relaxed">
          Nomor yang tersimpan adalah nomor <span className="font-semibold text-text">terakhir digunakan</span>.
          Upload berikutnya akan mendapat nomor +1. Setel ke nomor terakhir arsip fisik agar penomoran berlanjut.
        </p>
      </div>

      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      <div className="surface overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-bg-ctrl border-b border-border">
              <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-text-muted w-[80px]">Tipe</th>
              <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-text-muted">Keterangan</th>
              <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-[0.06em] text-text-muted w-[180px]">Nomor Terakhir</th>
            </tr>
          </thead>
          <tbody>
            {sequences.map((seq) => {
              const isEditing = editing[seq.doc_type] !== undefined;
              const isSaving = saving === seq.doc_type;
              const isSaved = saved === seq.doc_type;
              return (
                <tr key={seq.doc_type} className="border-b border-border-soft hover:bg-bg-hover transition-colors">
                  <td className="px-4 py-3 text-[13px] font-bold font-mono text-primary">{seq.doc_type}</td>
                  <td className="px-4 py-3 text-[12.5px] text-text-muted">{seq.label.split(" — ")[1] ?? seq.label}</td>
                  <td className="px-4 py-3 text-right">
                    {isEditing ? (
                      <div className="flex items-center justify-end gap-1.5">
                        <input
                          type="number"
                          min={0}
                          value={editing[seq.doc_type]}
                          onChange={(e) => setEditing((prev) => ({ ...prev, [seq.doc_type]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSave(seq.doc_type);
                            if (e.key === "Escape") setEditing((prev) => { const next = { ...prev }; delete next[seq.doc_type]; return next; });
                          }}
                          className="w-24 text-[12px] text-right px-2 py-1 rounded border border-border bg-bg-ctrl outline-none focus:border-primary"
                          disabled={isSaving}
                          autoFocus
                        />
                        <button
                          onClick={() => handleSave(seq.doc_type)}
                          disabled={isSaving}
                          className="btn btn-primary btn-sm btn-icon"
                        >
                          {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                        </button>
                        <button
                          onClick={() => setEditing((prev) => { const next = { ...prev }; delete next[seq.doc_type]; return next; })}
                          className="btn btn-default btn-sm btn-icon"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-2">
                        <span className={cn("text-[14px] font-bold tabular-nums font-mono", isSaved ? "text-green" : "text-text")}>
                          {seq.current_number.toLocaleString("id")}
                        </span>
                        <button
                          onClick={() => setEditing((prev) => ({ ...prev, [seq.doc_type]: String(seq.current_number) }))}
                          className="btn btn-default btn-sm text-[11px] px-2"
                        >
                          Ubah
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
