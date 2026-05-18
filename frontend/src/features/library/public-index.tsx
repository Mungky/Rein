"use client";

import { BookOpen, Loader2, RefreshCw, Search, User, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getPublicList } from "@/lib/api/library";

interface PublicFile {
  id: string;
  file_name: string;
  uploaded_by: string;
  created_at: string;
}

function relTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "Baru saja";
  if (diff < 3600) return `${Math.floor(diff / 60)} mnt lalu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
  return new Date(iso).toLocaleDateString("id", { day: "numeric", month: "short", year: "numeric" });
}

export function PublicIndex() {
  const [files, setFiles] = useState<PublicFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    getPublicList()
      .then(({ files }) => setFiles(files))
      .catch(() => setFiles([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = search
    ? files.filter((f) =>
        f.file_name.toLowerCase().includes(search.toLowerCase()) ||
        f.uploaded_by.toLowerCase().includes(search.toLowerCase())
      )
    : files;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-5 pt-4 pb-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <BookOpen className="w-4 h-4 text-primary" />
          <h2 className="text-[14px] font-bold text-text flex-1">Index Publik Perpustakaan</h2>
          <button
            onClick={load}
            disabled={loading}
            className="btn btn-ghost btn-icon btn-sm text-text-muted"
            title="Segarkan"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
        <p className="text-[11.5px] text-text-muted mb-3">
          Daftar dokumen yang tersimpan di perpustakaan.
          {files.length > 0 && (
            <span className="ml-2 text-text-light tabular-nums">{files.length} file</span>
          )}
        </p>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-light pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nama file atau pengunggah…"
            className="field-input pl-8 pr-7 text-[12.5px] w-full"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-light hover:text-text"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex justify-center items-center h-40">
            <Loader2 className="w-5 h-5 animate-spin text-text-light" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2 text-text-muted">
            <BookOpen className="w-8 h-8 text-text-light" />
            <p className="text-[13px]">{search ? "Tidak ada file yang cocok" : "Belum ada dokumen"}</p>
          </div>
        ) : (
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-bg border-b border-border z-10">
              <tr>
                <th className="text-left text-[10px] font-bold uppercase tracking-[0.06em] text-text-light px-4 py-2">
                  Nama File
                </th>
                <th className="text-left text-[10px] font-bold uppercase tracking-[0.06em] text-text-light px-4 py-2 w-[160px]">
                  Diunggah Oleh
                </th>
                <th className="text-left text-[10px] font-bold uppercase tracking-[0.06em] text-text-light px-4 py-2 w-[140px]">
                  Waktu
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-soft">
              {filtered.map((f) => (
                <tr key={f.id} className="hover:bg-bg-hover transition-colors">
                  <td className="px-4 py-2 align-middle">
                    <span className="font-mono text-[11.5px] text-text">{f.file_name}</span>
                  </td>
                  <td className="px-4 py-2 align-middle">
                    <span className="flex items-center gap-1 text-text-muted">
                      <User className="w-3 h-3 shrink-0" />
                      {f.uploaded_by}
                    </span>
                  </td>
                  <td className="px-4 py-2 align-middle text-text-muted tabular-nums">
                    {relTime(f.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
