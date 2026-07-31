"use client";

/** "Diperbarui HH:MM:SS" + manual refresh, next to the alarm bell.
 *  The button re-pulls DATA only (tags, latest values, active alarms, and —
 *  via dataRefreshNonce — every open recent-samples list); layout, streams,
 *  and video players are untouched. */

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useScadaStore } from "./store";
import { useNowMs } from "./use-now";

export function DataRefresh() {
  const dataUpdatedAt = useScadaStore((s) => s.dataUpdatedAt);
  const refreshData = useScadaStore((s) => s.refreshData);
  const [busy, setBusy] = useState(false);

  // Wall-clock in STATE (never Date.now() in render — purity rule),
  // refreshed every 10 s so a stale "Diperbarui" timestamp visibly ages
  const nowMs = useNowMs(10_000);

  async function refresh() {
    setBusy(true);
    try {
      await refreshData();
    } finally {
      setBusy(false);
    }
  }

  const label =
    dataUpdatedAt === null
      ? "—"
      : new Date(dataUpdatedAt).toLocaleTimeString("id", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });
  const stale =
    dataUpdatedAt !== null && nowMs !== null && nowMs - dataUpdatedAt > 2 * 60_000;

  return (
    <div className="flex items-center gap-1">
      <span
        className={cn(
          "hidden text-[10.5px] tabular-nums sm:inline",
          stale ? "text-amber" : "text-text-light"
        )}
        title="Waktu data terakhir diterima"
      >
        Diperbarui {label}
      </span>
      <button
        type="button"
        onClick={() => void refresh()}
        disabled={busy}
        className="btn btn-ghost btn-icon btn-sm"
        title="Perbarui data sekarang (data saja, tampilan tidak dimuat ulang)"
      >
        <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
      </button>
    </div>
  );
}
