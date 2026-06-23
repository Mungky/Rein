"use client";

import { RefreshCw } from "lucide-react";

function relSync(d: Date | null): string {
  if (!d) return "belum sinkron";
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 5) return "baru saja";
  if (s < 60) return `${s} dtk lalu`;
  if (s < 3600) return `${Math.floor(s / 60)} mnt lalu`;
  return d.toLocaleTimeString("id", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Floating, unobtrusive sync widget (bottom-right).
 *
 * The file list refreshes silently in the background — no spinner, no list
 * clearing, no re-animation. This widget is the only visible hint that syncing
 * happens: a small pill that expands on hover to show the last-sync time, and
 * acts as a manual "sync now" button.
 */
export function SyncIndicator({
  lastSync, syncing, onSync,
}: {
  lastSync: Date | null;
  syncing: boolean;
  onSync: () => void;
}) {
  return (
    <div className="fixed right-4 bottom-[72px] sm:bottom-4 z-30">
      <button
        onClick={onSync}
        disabled={syncing}
        title="Sinkronkan sekarang"
        aria-label={syncing ? "Menyinkronkan" : `Tersinkron ${relSync(lastSync)} — klik untuk sinkronkan`}
        className="group flex items-center h-10 rounded-full border border-border bg-bg/95 backdrop-blur-sm shadow-[var(--shadow-lg)] pl-3.5 pr-3 hover:border-primary/40 transition-colors"
      >
        <span className="max-w-0 group-hover:max-w-[170px] overflow-hidden whitespace-nowrap transition-[max-width,margin] duration-300 text-[11.5px] text-text-muted group-hover:mr-2">
          {syncing ? "Menyinkronkan…" : `Tersinkron · ${relSync(lastSync)}`}
        </span>
        <span className="relative flex items-center justify-center shrink-0">
          <RefreshCw
            className={`size-4 transition-colors ${syncing ? "animate-spin text-primary" : "text-text-muted group-hover:text-primary"}`}
          />
          {/* "live" dot — static so it doesn't feel like a reload */}
          {!syncing && (
            <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-green ring-2 ring-bg" />
          )}
        </span>
      </button>
    </div>
  );
}
