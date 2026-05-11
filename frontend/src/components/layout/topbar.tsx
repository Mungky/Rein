"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import {
  ChevronDown,
  LogOut,
} from "lucide-react";
import type { AppRole } from "@/lib/utils/roles";
import { ROLE_LABELS } from "@/lib/utils/roles";

const SCREEN_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  dcc: "Document Manager",
  approvals: "Persetujuan",
  crm: "CRM",
  projects: "Proyek",
  finance: "Keuangan",
  hr: "Tim & HR",
};

export interface TopbarProps {
  screen: string;
  theme: "light" | "dark";
  toggleTheme: () => void;
  userName?: string;
  userRole?: AppRole;
  userInitials?: string;
  onMenuClick?: () => void;
  onLogout?: () => void;
}

function ReinLogo() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" className="shrink-0">
      <path d="M11 2L20 11 11 20 2 11z" fill="var(--primary)" opacity="0.9" />
      <path d="M11 7L15 11 11 15 7 11z" fill="var(--bg-sidebar)" />
    </svg>
  );
}

export function Topbar({
  screen,
  theme,
  toggleTheme,
  userName = "Pengguna",
  userRole,
  userInitials = "U",
  onMenuClick,
  onLogout,
}: TopbarProps) {
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    if (userMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [userMenuOpen]);

  const roleLabel = userRole ? ROLE_LABELS[userRole] ?? userRole : "";

  return (
    <header
      className={cn(
        "flex h-[var(--topbar-h)] min-h-[var(--topbar-h)] shrink-0 items-center",
        "bg-bg-sidebar border-b border-border z-[100]"
      )}
    >
      {/* Brand slot */}
      <div
        className={cn(
          "flex h-full shrink-0 items-center gap-2 overflow-hidden",
          "w-[var(--sidebar-w)] min-w-[var(--sidebar-w)] border-r border-border px-3.5",
          "max-md:w-auto max-md:min-w-0 max-md:border-r-0 max-md:pl-3"
        )}
      >
<div className="flex min-w-0 flex-1 items-center gap-2 max-md:flex-initial">
          <ReinLogo />
          <div className="min-w-0 overflow-hidden max-md:hidden">
            <span className="block text-sm font-extrabold tracking-[0.06em] text-text">
              REIN
            </span>
            <span className="block text-[10px] tracking-[0.01em] text-text-muted -mt-px">
              Remula Inti Rekayasa
            </span>
          </div>
        </div>
      </div>

      {/* Right slot */}
      <div className="flex flex-1 items-center gap-0.5 px-3.5">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-[5px] text-[13.5px] text-text-muted">
          <span>REIN</span>
          <span className="text-[18px] leading-none text-text-light mx-px">›</span>
          <span className="font-semibold text-text">
            {SCREEN_LABELS[screen] ?? screen}
          </span>
        </nav>

        <div className="flex-1" />

        <ThemeToggle theme={theme} toggleTheme={toggleTheme} />

        <div className="mx-1.5 h-5 w-px shrink-0 bg-border" />

        {/* User menu */}
        <div ref={menuRef} style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => setUserMenuOpen((prev) => !prev)}
            className={cn(
              "flex cursor-pointer items-center gap-[7px] rounded-[var(--r)] px-1.5 py-1",
              "transition-[background] duration-[var(--tr)]",
              "hover:bg-bg-hover"
            )}
          >
            <div
              className={cn(
                "flex size-[26px] shrink-0 items-center justify-center",
                "rounded-full bg-primary text-text-inv",
                "text-[10px] font-bold tracking-[0.03em]"
              )}
            >
              {userInitials}
            </div>
            <div className="min-w-0 max-md:hidden">
              <div className="whitespace-nowrap text-[12.5px] font-semibold text-text">
                {userName}
              </div>
              <div className="whitespace-nowrap text-[10px] text-text-muted">
                {roleLabel}
              </div>
            </div>
            <ChevronDown className="size-2.5 text-text-muted" />
          </button>

          {/* Dropdown */}
          {userMenuOpen && (
            <div
              className={cn(
                "absolute right-0 top-full mt-1 min-w-[180px]",
                "rounded-[var(--r-lg)] border border-border bg-bg-sidebar",
                "py-1 shadow-md z-[200]"
              )}
            >
              <div className={cn("flex items-center gap-2 px-3 py-2", "border-b border-border-soft")}>
                <div
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center",
                    "rounded-full bg-primary text-text-inv",
                    "text-[10px] font-bold"
                  )}
                >
                  {userInitials}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[12.5px] font-semibold text-text">{userName}</div>
                  <div className="truncate text-[10px] text-text-muted">{roleLabel}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setUserMenuOpen(false); onLogout?.(); }}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-[7px]",
                  "text-[13px] text-text-muted cursor-pointer border-none bg-transparent",
                  "transition-[background,color] duration-[var(--tr)]",
                  "hover:bg-bg-hover hover:text-text",
                  "text-left font-sans"
                )}
              >
                <LogOut className="size-3.5" />
                Keluar
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
