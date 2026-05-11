"use client";

import { cn } from "@/lib/utils";
import { Home, FolderOpen, Search, Bell, User } from "lucide-react";

export interface MobileNavProps {
  screen: string;
  setScreen: (screen: string) => void;
  userRole?: string;
}

const items = [
  { id: "dashboard", label: "Beranda", icon: Home },
  { id: "dcc", label: "Dokumen", icon: FolderOpen },
  { id: "search", label: "Cari", icon: Search },
  { id: "notifications", label: "Notifikasi", icon: Bell },
  { id: "profile", label: "Profil", icon: User },
];

export function MobileNav({ screen, setScreen }: MobileNavProps) {

  return (
    <nav
      className={cn(
        "flex h-14 shrink-0 items-center justify-around border-t border-border bg-bg",
        "md:hidden"
      )}
    >
      {items.map(({ id, label, icon: Icon }) => {
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