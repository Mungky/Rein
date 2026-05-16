"use client";

import { BookOpen, ChevronDown, ChevronRight, FileText, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { getPublicIndex } from "@/lib/api/library";
import type { PublicIndexDept } from "./types";

const DOC_TYPE_COLORS: Record<string, string> = {
  DRW: "text-blue bg-blue-bg",
  INV: "text-green bg-green-bg",
  PO: "text-amber bg-amber-bg",
  SPK: "text-primary bg-primary-bg",
  RFP: "text-primary bg-primary-bg",
  RPT: "text-text-muted bg-bg-hover",
  SPEC: "text-text-muted bg-bg-hover",
  OTHER: "text-text-muted bg-bg-hover",
};

const DEPT_COLORS: Record<string, string> = {
  finance: "text-green",
  accounting: "text-green",
  engineering: "text-blue",
  hr: "text-amber",
  purchasing: "text-amber",
  management: "text-primary",
};

export function PublicIndex() {
  const [depts, setDepts] = useState<PublicIndexDept[]>([]);
  const [loading, setLoading] = useState(true);
  const [openDepts, setOpenDepts] = useState<Set<string>>(new Set());

  useEffect(() => {
    getPublicIndex()
      .then(({ departments }) => {
        setDepts(departments);
        // Auto-open depts that have files
        setOpenDepts(new Set(departments.filter((d) => d.file_count > 0).map((d) => d.id)));
      })
      .catch(() => setDepts([]))
      .finally(() => setLoading(false));
  }, []);

  const toggle = (id: string) =>
    setOpenDepts((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  if (loading) {
    return (
      <div className="flex justify-center items-center h-48">
        <Loader2 className="w-5 h-5 animate-spin text-text-light" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="px-6 pt-5 pb-4 border-b border-border shrink-0">
        <div className="flex items-center gap-2.5 mb-1">
          <BookOpen className="w-4 h-4 text-primary" />
          <h2 className="text-[14px] font-bold text-text">Index Publik Perpustakaan</h2>
        </div>
        <p className="text-[12px] text-text-muted">
          Daftar nama dokumen dari semua departemen. Untuk mengakses isi, hubungi Manajemen.
        </p>
      </div>

      {/* Dept list */}
      <div className="divide-y divide-border-soft">
        {depts.map((dept) => {
          const isOpen = openDepts.has(dept.id);
          const deptColor = DEPT_COLORS[dept.department] ?? "text-text-muted";

          return (
            <div key={dept.id}>
              <button
                onClick={() => toggle(dept.id)}
                className="w-full flex items-center gap-2.5 px-5 py-3 hover:bg-bg-hover transition-colors text-left"
              >
                {isOpen ? (
                  <ChevronDown className="w-3.5 h-3.5 text-text-light shrink-0" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-text-light shrink-0" />
                )}
                <span className={`text-[13px] font-bold ${deptColor}`}>{dept.dept_label}</span>
                <span className="text-[11px] text-text-light tabular-nums ml-auto">
                  {dept.file_count} dokumen
                </span>
              </button>

              {isOpen && (
                <div className="pb-2">
                  {dept.files.length === 0 ? (
                    <p className="text-[11.5px] text-text-light px-10 py-2">
                      Belum ada dokumen
                    </p>
                  ) : (
                    dept.files.map((f, i) => {
                      const typeColor = DOC_TYPE_COLORS[f.doc_type ?? ""] ?? "text-text-muted bg-bg-hover";
                      return (
                        <div
                          key={i}
                          className="flex items-center gap-2.5 px-10 py-1.5"
                        >
                          <FileText className="w-3 h-3 text-text-light shrink-0" />
                          {f.doc_type && (
                            <span className={`text-[9px] font-bold px-1.5 py-px rounded shrink-0 ${typeColor}`}>
                              {f.doc_type}
                            </span>
                          )}
                          <span className="text-[12px] text-text font-mono truncate">{f.name}</span>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
