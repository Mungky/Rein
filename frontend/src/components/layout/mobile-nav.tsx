"use client";

import { cn } from "@/lib/utils";
import { Home, FolderOpen, FolderKanban, MonitorPlay } from "lucide-react";
import type { AppRole, Permission } from "@/lib/utils/roles";
import { usePermissions } from "@/components/providers/permissions-provider";

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
}[] = [
  { id: "dashboard", label: "Beranda", icon: Home },
  { id: "workspace", label: "Proyek", icon: FolderKanban, permission: "workspace:view" },
  { id: "dcc", label: "Dokumen", icon: FolderOpen },
  { id: "scada", label: "R-Net", icon: MonitorPlay, permission: "scada:view" },
];

export function MobileNav({ screen, setScreen, userRole }: MobileNavProps) {
  const { can } = usePermissions();
  const visible = items.filter(
    (item) => !item.permission || (userRole && can(userRole as AppRole, item.permission))
  );

  return (
    <nav
      className={cn(
        "flex h-14 shrink-0 items-center justify-around border-t border-border bg-bg",
        "md:hidden"
      )}
    >
      {visible.map(({ id, label, icon: Icon }) => {
        const active = screen === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => setScreen(id)}
            className={cn(
              "relative flex min-w-0 flex-1 flex-col items-center gap-0.5 py-1.5",
              "cursor-pointer border-none bg-transparent",
              "transition-[color] duration-[var(--tr)]",
              active ? "text-primary" : "text-text-muted hover:text-text"
            )}
          >
            <Icon className="size-5" />
            <span className="text-[10px] font-medium leading-tight">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
