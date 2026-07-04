"use client";

/** Admin — File types tab: add new types, edit/deactivate existing ones.
 *  Code is immutable once created because doc_number (e.g. DRW-125) refers
 *  to it. Moved verbatim from app/(app)/admin/page.tsx. */

import { useState, useEffect, useCallback } from "react";
import {
  UserPlus,
  ToggleLeft,
  ToggleRight,
  Pencil,
  Save,
  X,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { API_URL, authHeaders } from "./shared";

export interface FileTypeRow {
  code: string;
  label: string;
  description: string | null;
  is_active: boolean;
  sort_order: number;
}

const FILE_TYPE_CODE_RE = /^[A-Z][A-Z0-9]{1,7}$/;

export function DocTypesTab() {
  const [rows, setRows] = useState<FileTypeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ code: "", label: "", description: "" });
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ label: string; description: string }>({ label: "", description: "" });
  const [busyCode, setBusyCode] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_URL}/api/admin/file-types`, { headers });
      if (!res.ok) throw new Error("Gagal memuat jenis file");
      setRows(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const handleCreate = async () => {
    const code = draft.code.trim().toUpperCase();
    const label = draft.label.trim();
    if (!FILE_TYPE_CODE_RE.test(code)) {
      setError("Kode harus 2-8 karakter, huruf besar/angka, diawali huruf.");
      return;
    }
    if (!label) { setError("Nama wajib diisi."); return; }
    setCreating(true); setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_URL}/api/admin/file-types`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ code, label, description: draft.description.trim() || null }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error((e as { detail?: string }).detail || "Gagal menambah jenis file");
      }
      setShowCreate(false);
      setDraft({ code: "", label: "", description: "" });
      fetchRows();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan");
    } finally { setCreating(false); }
  };

  const updateRow = async (code: string, patch: Partial<Pick<FileTypeRow, "label" | "description" | "is_active" | "sort_order">>) => {
    setBusyCode(code); setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_URL}/api/admin/file-types/${encodeURIComponent(code)}`, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error((e as { detail?: string }).detail || "Gagal menyimpan perubahan");
      }
      fetchRows();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan");
    } finally { setBusyCode(null); }
  };

  const beginEdit = (row: FileTypeRow) => {
    setEditingCode(row.code);
    setEditDraft({ label: row.label, description: row.description ?? "" });
  };

  const saveEdit = async () => {
    if (!editingCode) return;
    const label = editDraft.label.trim();
    if (!label) { setError("Nama wajib diisi."); return; }
    await updateRow(editingCode, { label, description: editDraft.description.trim() });
    setEditingCode(null);
  };

  return (
    <div className="px-4 md:px-8 py-6 max-w-4xl">
      <div className="mb-5">
        <h2 className="text-[16px] font-bold text-text leading-tight">Jenis File Dokumen</h2>
        <p className="text-[12.5px] text-text-muted mt-1 leading-relaxed">
          Daftar jenis file yang dikenali sistem. Kode dipakai dalam penomoran otomatis dokumen
          (contoh: <span className="font-mono font-semibold text-text">DRW-PLB-0125.pdf</span>).
          Kode <span className="font-semibold text-text">tidak dapat diubah</span> setelah dibuat karena dokumen
          lama merujuk ke kode tersebut — nonaktifkan saja kalau jenis sudah tidak dipakai.
        </p>
      </div>

      {error && (
        <div className="mb-3 px-3 py-2 rounded-md border border-red/30 bg-red-bg text-red text-[12.5px]">
          {error}
        </div>
      )}

      <div className="flex items-center gap-2 mb-3">
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="btn btn-primary btn-sm gap-1.5"
        >
          <UserPlus className="w-3.5 h-3.5" />
          {showCreate ? "Tutup" : "Tambah Jenis File"}
        </button>
        <button
          type="button"
          onClick={() => fetchRows()}
          disabled={loading}
          className="btn btn-default btn-sm"
        >
          Segarkan
        </button>
      </div>

      {showCreate && (
        <div className="mb-4 rounded-lg border border-border bg-bg-ctrl p-4 flex flex-col gap-3">
          <div className="grid grid-cols-1 md:grid-cols-[120px_1fr_1.5fr] gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Kode</label>
              <input
                value={draft.code}
                onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value.toUpperCase() }))}
                placeholder="DRW"
                maxLength={8}
                className="field-input font-mono text-[13px]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Nama</label>
              <input
                value={draft.label}
                onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                placeholder="Gambar Teknik"
                maxLength={64}
                className="field-input text-[13px]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Keterangan</label>
              <input
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                placeholder="Drawing, blueprint, CAD"
                maxLength={500}
                className="field-input text-[13px]"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating}
              className="btn btn-primary btn-sm gap-1.5"
            >
              {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Simpan
            </button>
            <button
              type="button"
              onClick={() => { setShowCreate(false); setDraft({ code: "", label: "", description: "" }); }}
              className="btn btn-default btn-sm"
            >
              Batal
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
        </div>
      ) : (
        <div className="surface overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-bg-ctrl border-b border-border">
                <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-text-muted w-[90px]">Kode</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-text-muted w-[180px]">Nama</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-text-muted">Keterangan</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-text-muted w-[110px]">Status</th>
                <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-[0.06em] text-text-muted w-[140px]">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-[12.5px] text-text-muted">
                    Belum ada jenis file. Klik <span className="font-semibold">Tambah Jenis File</span> untuk membuat.
                  </td>
                </tr>
              )}
              {rows.map((row) => {
                const editing = editingCode === row.code;
                const busy = busyCode === row.code;
                return (
                  <tr key={row.code} className={cn("border-b border-border-soft", !row.is_active && "opacity-60")}>
                    <td className="px-4 py-3 text-[13px] font-bold font-mono text-primary">{row.code}</td>
                    <td className="px-4 py-3 text-[13px] font-semibold text-text">
                      {editing ? (
                        <input
                          value={editDraft.label}
                          onChange={(e) => setEditDraft((d) => ({ ...d, label: e.target.value }))}
                          maxLength={64}
                          className="field-input text-[13px] w-full"
                        />
                      ) : row.label}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-text-muted">
                      {editing ? (
                        <input
                          value={editDraft.description}
                          onChange={(e) => setEditDraft((d) => ({ ...d, description: e.target.value }))}
                          maxLength={500}
                          className="field-input text-[12px] w-full"
                        />
                      ) : (row.description || <span className="italic text-text-light">—</span>)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        "text-[11px] font-bold px-2 py-[2px] rounded-full",
                        row.is_active ? "bg-green-100 text-green-700" : "bg-bg-hover text-text-muted"
                      )}>
                        {row.is_active ? "Aktif" : "Nonaktif"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {editing ? (
                          <>
                            <button
                              type="button"
                              onClick={saveEdit}
                              disabled={busy}
                              className="btn btn-primary btn-sm gap-1"
                            >
                              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                              Simpan
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingCode(null)}
                              className="btn btn-default btn-sm"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => beginEdit(row)}
                              disabled={busy}
                              className="btn btn-default btn-sm gap-1"
                              title="Edit nama & keterangan"
                            >
                              <Pencil className="w-3 h-3" />
                              Ubah
                            </button>
                            <button
                              type="button"
                              onClick={() => updateRow(row.code, { is_active: !row.is_active })}
                              disabled={busy}
                              className="btn btn-default btn-sm gap-1"
                              title={row.is_active ? "Nonaktifkan" : "Aktifkan"}
                            >
                              {row.is_active ? <ToggleRight className="w-3 h-3" /> : <ToggleLeft className="w-3 h-3" />}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
