"use client";

import { cn } from "@/lib/utils";
import { Home, FolderOpen, FolderKanban, MonitorPlay, Lock } from "lucide-react";
import type { AppRole, Permission } from "@/lib/utils/roles";
import { usePermissions } from "@/components/providers/permissions-provider";
import { isLocked } from "@/lib/feature-flags";

export interface MobileNavProps {
  screen: string;
  setScreen: (screen: string) => void;
  userRole?: string;
}

/** Bottom nav = primary navigation on mobile. Items mirror the sidebar's
 *  main menu (permission-gated); the drawer stays for Admin & account info. */
const items: {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  permission?: Permission;
  locked?: boolean;
}[] = [
  { id: "dashboard", label: "Beranda", icon: Home, locked: isLocked("dashboard") },
  { id: "workspace", label: "Proyek", icon: FolderKanban, permission: "workspace:view", locked: isLocked("workspace") },
  { id: "dcc", label: "Dokumen", icon: FolderOpen },
  { id: "scada", label: "R-Net", icon: MonitorPlay, permission: "scada:view" },
];

export function MobileNav({ screen, setScreen, userRole }: MobileNavProps) {
  const { can } = usePermissions();
  const visible = items.filter(
    // Locked modules are hidden until finished; the rest are permission-gated.
    (item) => !item.locked && (!item.permission || (userRole && can(userRole as AppRole, item.permission)))
  );

  return (
    <nav
      className={cn(
        "flex h-14 shrink-0 items-center justify-around border-t border-border bg-bg",
        "md:hidden"
      )}
    >
      {visible.map(({ id, label, icon: Icon, locked }) => {
        const active = screen === id;
        return (
          <button
            key={id}
            type="button"
            onClick={locked ? undefined : () => setScreen(id)}
            disabled={locked}
            className={cn(
              "relative flex min-w-0 flex-1 flex-col items-center gap-0.5 py-1.5",
              "border-none bg-transparent",
              "transition-[color] duration-[var(--tr)]",
              locked
                ? "cursor-not-allowed text-text-muted opacity-45"
                : active
                  ? "cursor-pointer text-primary"
                  : "cursor-pointer text-text-muted hover:text-text"
            )}
          >
            <Icon className="size-5" />
            {locked && <Lock className="absolute right-1/2 top-1 size-2.5 translate-x-[10px] opacity-60" />}
            <span className="text-[10px] font-medium leading-tight">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
