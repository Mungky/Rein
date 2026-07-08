"use client";

import { Lock } from "lucide-react";

/**
 * Full-screen placeholder for a module that is intentionally locked
 * (see lib/feature-flags.ts). Shown in place of the real page so the
 * feature can't be reached even by typing its URL.
 */
export function LockedFeature({ title }: { title: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-bg-hover text-text-muted">
        <Lock className="size-6" />
      </div>
      <div>
        <p className="mb-1 text-[15px] font-bold text-text">{title} terkunci</p>
        <p className="max-w-xs text-[13px] text-text-muted">
          Fitur ini belum diaktifkan. Hubungi administrator bila perlu diaktifkan.
        </p>
      </div>
    </div>
  );
}
