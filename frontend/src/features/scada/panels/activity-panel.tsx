"use client";

/** Activity panel — live "who's on REIN right now", friendlist-style.
 *  Fed by Supabase Realtime Presence (PresenceProvider, mounted app-wide), so
 *  it reflects everyone on REIN — not just people looking at R-Net — with no
 *  DB load and no pooler connections. "Sudah berapa lama" comes from each
 *  user's earliest still-open session. */

import { useEffect, useState } from "react";
import { Users2 } from "lucide-react";
import { usePresence } from "@/components/providers/presence-provider";
import { ROLE_LABELS, getInitials } from "@/lib/utils/roles";

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  if (totalSec < 60) return `${totalSec} dtk`;
  const totalMin = Math.floor(totalSec / 60);
  if (totalMin < 60) return `${totalMin} mnt`;
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  return mins ? `${hours} jam ${mins} mnt` : `${hours} jam`;
}

export function ActivityPanel() {
  const online = usePresence();
  // Tick every second so durations update live.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex h-full w-full flex-col bg-bg">
      {/* Header strip */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border-soft px-3 py-2">
        <span className="text-[12px] font-semibold text-text-muted">
          Sedang memantau REIN
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 px-2 py-0.5 text-[12px] font-bold text-green-600">
          <span className="size-1.5 animate-pulse rounded-full bg-green-500" />
          {online.length}
        </span>
      </div>

      {online.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 text-center">
          <Users2 className="size-7 text-text-light" />
          <p className="text-[12px] text-text-muted">Belum ada yang online</p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {online.map((u) => {
            const duration = formatDuration(now - new Date(u.online_at).getTime());
            return (
              <div
                key={u.id}
                className="flex items-center gap-2.5 border-b border-border-soft/60 px-3 py-2 last:border-0"
              >
                <div className="relative shrink-0">
                  <div className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-hover text-[11px] font-bold text-white">
                    {u.name ? getInitials(u.name) : "U"}
                  </div>
                  <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-bg bg-green-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-semibold text-text">
                    {u.name || u.username || "Pengguna"}
                  </div>
                  <div className="truncate text-[11px] text-text-muted">
                    {ROLE_LABELS[u.role] ?? u.role}
                    {u.connections > 1 ? ` · ${u.connections} perangkat` : ""}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[12px] font-bold tabular-nums text-text">
                    {duration}
                  </div>
                  <div className="text-[10px] text-text-light">memantau</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
