"use client";

import { Lock } from "lucide-react";
import type { FolderNode } from "./types";

function relDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("id", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

interface DeptSummaryProps {
  folder: FolderNode;
}

export function DeptSummaryCard({ folder }: DeptSummaryProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 px-6 text-center">
      <div className="w-14 h-14 rounded-full bg-bg-ctrl border border-border flex items-center justify-center">
        <Lock className="w-6 h-6 text-text-light" />
      </div>

      <div>
        <p className="text-[14px] font-semibold text-text">{folder.name}</p>
        <p className="text-[12px] text-text-muted mt-1">
          Folder ini hanya dapat diakses oleh anggota departemen{" "}
          <span className="font-semibold">{folder.dept_label || folder.name}</span>.
        </p>
      </div>

      <div className="flex gap-6 mt-2">
        <Stat label="Dokumen tersimpan" value={folder.file_count.toLocaleString("id")} />
        <Stat label="Terakhir diperbarui" value={relDate(folder.last_updated)} />
      </div>

      <p className="text-[11px] text-text-light mt-2 max-w-[280px]">
        Untuk mengakses dokumen, hubungi anggota departemen {folder.dept_label || folder.name} atau Administrator.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-[18px] font-bold text-text tabular-nums">{value}</span>
      <span className="text-[11px] text-text-muted">{label}</span>
    </div>
  );
}
