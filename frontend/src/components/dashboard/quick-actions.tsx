"use client";

import { useRouter } from "next/navigation";
import { Upload, Search, Clock } from "lucide-react";

export function QuickActions() {
  const router = useRouter();

  return (
    <div className="p-2 flex flex-col gap-1">
      <button
        onClick={() => router.push("/dcc")}
        className="flex items-center gap-2.5 px-2.5 py-2 rounded-md border border-border-soft bg-bg text-[13px] font-medium text-text hover:border-primary hover:text-primary hover:bg-primary-bg transition-all duration-140"
      >
        <span className="w-[26px] h-[26px] rounded flex items-center justify-center shrink-0 badge-purple">
          <Upload className="w-3.5 h-3.5" />
        </span>
        Unggah ke DCC
      </button>
      <button
        onClick={() => router.push("/dcc")}
        className="flex items-center gap-2.5 px-2.5 py-2 rounded-md border border-border-soft bg-bg text-[13px] font-medium text-text hover:border-primary hover:text-primary hover:bg-primary-bg transition-all duration-140"
      >
        <span className="w-[26px] h-[26px] rounded flex items-center justify-center shrink-0 bg-green-bg text-green">
          <Search className="w-3.5 h-3.5" />
        </span>
        Cari di Arsip Nimbus
      </button>
      <button
        onClick={() => router.push("/dcc")}
        className="flex items-center gap-2.5 px-2.5 py-2 rounded-md border border-border-soft bg-bg text-[13px] font-medium text-text hover:border-primary hover:text-primary hover:bg-primary-bg transition-all duration-140"
      >
        <span className="w-[26px] h-[26px] rounded flex items-center justify-center shrink-0 bg-amber-bg text-amber">
          <Clock className="w-3.5 h-3.5" />
        </span>
        Lihat Antrian Upload
      </button>
    </div>
  );
}