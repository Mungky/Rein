"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import {
  ChevronDown,
  Clock,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import type { AppRole } from "@/lib/utils/roles";
import { ROLE_LABELS } from "@/lib/utils/roles";

const SCREEN_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  dcc: "Document Manager",
  approvals: "Persetujuan",
  admin: "Administrasi",
  workspace: "Workspace",
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
  /** Desktop sidebar visibility — used to flip the toggle icon. */
  sidebarOpen?: boolean;
  onMenuClick?: () => void;
  onLogout?: () => void;
}

const DAY_NAMES = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
];

/** Jam RTC + timestamp live — dipakai sebagai judul halaman R-Net
 *  (menggantikan label "scada"). Nilai server vs klien bisa beda sedetik,
 *  jadi hydration warning ditekan (terkoreksi pada tick berikutnya). */
function RtcClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const p = (n: number) => String(n).padStart(2, "0");
  const time = `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
  const date = `${DAY_NAMES[now.getDay()]}, ${now.getDate()} ${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;

  return (
    <span className="inline-flex items-center gap-1.5 rounded-[var(--r)] bg-primary-soft px-2.5 py-1 text-[12px] font-semibold text-primary">
      <Clock className="size-3.5 shrink-0" />
      <span className="tabular-nums tracking-tight" suppressHydrationWarning>
        {time}
      </span>
      <span
        className="hidden font-medium text-primary/70 md:inline"
        suppressHydrationWarning
      >
        · {date}
      </span>
    </span>
  );
}

function ReinLogo() {
  return (
    <span className="relative inline-block size-10 shrink-0">
      <Image
        src="/rein-logo.png"
        alt="REIN"
        fill
        sizes="40px"
        priority
        className="object-contain drop-shadow-[0_1px_2px_rgba(15,23,42,0.10)]"
      />
    </span>
  );
}

export function Topbar({
  screen,
  theme,
  toggleTheme,
  userName = "Pengguna",
  userRole,
  userInitials = "U",
  sidebarOpen = true,
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
  const screenLabel = SCREEN_LABELS[screen] ?? screen;

  return (
    <header
      className={cn(
        "flex h-[var(--topbar-h)] min-h-[var(--topbar-h)] shrink-0 items-center",
        "bg-bg-sidebar border-b border-border z-[100]"
      )}
    >
      {/* Brand slot — collapses to logo-only when sidebar hidden */}
      <div
        className={cn(
          "flex h-full shrink-0 items-center gap-2.5 overflow-hidden border-r border-border transition-[width] duration-200 ease-out",
          sidebarOpen
            ? "w-[var(--sidebar-w)] min-w-[var(--sidebar-w)] px-4"
            : "w-auto px-3",
          "max-md:w-auto max-md:min-w-0 max-md:border-r-0 max-md:pl-3"
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <ReinLogo />
          <div className={cn(
            "min-w-0 overflow-hidden max-md:hidden transition-all duration-200",
            sidebarOpen ? "opacity-100 w-auto" : "opacity-0 w-0"
          )}>
            <span className="block text-[15px] font-extrabold tracking-[0.02em] text-text leading-tight">
              REIN
            </span>
            <span className="block text-[10.5px] tracking-tight text-text-muted leading-tight">
              Remula Inti Rekayasa
            </span>
          </div>
        </div>
      </div>

      {/* Right slot */}
      <div className="flex flex-1 items-center gap-2 px-4 max-md:px-3">
        {/* Sidebar toggle — mobile opens drawer, desktop hides/shows sidebar */}
        <button
          type="button"
          onClick={onMenuClick}
          className="btn btn-ghost btn-icon btn-sm -ml-1"
          aria-label={sidebarOpen ? "Sembunyikan sidebar" : "Tampilkan sidebar"}
          title={sidebarOpen ? "Sembunyikan sidebar" : "Tampilkan sidebar"}
        >
          {sidebarOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
        </button>
        {/* Screen pill — halaman R-Net menampilkan RTC + timestamp,
            bukan nama layar */}
        <div className="flex items-center gap-2">
          {screen === "scada" ? (
            <RtcClock />
          ) : (
            <>
              <span className="hidden sm:inline-flex items-center gap-1.5 rounded-[var(--r)] bg-primary-soft px-2.5 py-1 text-[12px] font-semibold text-primary">
                {screenLabel}
              </span>
              <span className="sm:hidden text-[13px] font-semibold text-text">
                {screenLabel}
              </span>
            </>
          )}
        </div>

        <div className="flex-1" />

        <ThemeToggle theme={theme} toggleTheme={toggleTheme} />

        <div className="mx-1 h-6 w-px shrink-0 bg-border" />

        {/* User menu */}
        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setUserMenuOpen((prev) => !prev)}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-[var(--r)] p-1 pr-2",
              "transition-[background] duration-[var(--tr)]",
              "hover:bg-bg-hover"
            )}
          >
            <div
              className={cn(
                "flex size-8 shrink-0 items-center justify-center",
                "rounded-full bg-gradient-to-br from-primary to-primary-hover text-text-inv",
                "text-[11px] font-bold shadow-[0_1px_2px_rgba(37,99,235,0.30)]"
              )}
            >
              {userInitials}
            </div>
            <div className="min-w-0 max-md:hidden text-left">
              <div className="whitespace-nowrap text-[12.5px] font-semibold text-text leading-tight">
                {userName}
              </div>
              <div className="whitespace-nowrap text-[10.5px] text-text-muted leading-tight">
                {roleLabel}
              </div>
            </div>
            <ChevronDown className="size-3 text-text-muted max-md:hidden" />
          </button>

          {/* Dropdown */}
          {userMenuOpen && (
            <div
              className={cn(
                "absolute right-0 top-full mt-1.5 min-w-[200px]",
                "rounded-[var(--r-lg)] border border-border bg-bg",
                "py-1.5 shadow-[var(--shadow-lg)] z-[200]"
              )}
            >
              <div className={cn("flex items-center gap-2.5 px-3 py-2.5 mb-1", "border-b border-border-soft")}>
                <div
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center",
                    "rounded-full bg-gradient-to-br from-primary to-primary-hover text-text-inv",
                    "text-[11px] font-bold"
                  )}
                >
                  {userInitials}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold text-text">{userName}</div>
                  <div className="truncate text-[10.5px] text-text-muted">{roleLabel}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setUserMenuOpen(false); onLogout?.(); }}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2",
                  "text-[13px] text-text cursor-pointer border-none bg-transparent",
                  "transition-[background,color] duration-[var(--tr)]",
                  "hover:bg-red-bg hover:text-red",
                  "text-left font-sans"
                )}
              >
                <LogOut className="size-4" />
                Keluar
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
