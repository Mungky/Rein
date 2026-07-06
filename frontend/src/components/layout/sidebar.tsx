"use client";

import { cn } from "@/lib/utils";
import {
  LayoutGrid,
  FolderOpen,
  Settings,
  Lock,
  Shield,
  FolderKanban,
  MonitorPlay,
} from "lucide-react";
import { ROLE_LABELS } from "@/lib/utils/roles";
import type { AppRole, Permission } from "@/lib/utils/roles";
import { usePermissions } from "@/components/providers/permissions-provider";

/* ── Navigation items ── */
interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  locked?: boolean;
  permission?: Permission;
}

const NAV_PRIMARY: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutGrid },
  { id: "workspace", label: "Workspace", icon: FolderKanban, permission: "workspace:view" },
  { id: "dcc", label: "Document Manager", icon: FolderOpen },
  { id: "scada", label: "R-Net", icon: MonitorPlay, permission: "scada:view" },
];

const NAV_ADMIN: NavItem[] = [
  { id: "admin", label: "Admin", icon: Shield, permission: "admin:manage_users" },
];

const NAV_SETTINGS: NavItem[] = [
  { id: "settings", label: "Pengaturan", icon: Settings, locked: true },
];

export interface SidebarProps {
  screen: string;
  setScreen: (screen: string) => void;
  userRole: AppRole;
  userName?: string;
  userInitials?: string;
  /** When true, show icon-only collapsed sidebar (for tablet). */
  collapsed?: boolean;
}

function SidebarItem({
  item,
  active,
  onClick,
  collapsed,
}: {
  item: NavItem;
  active: boolean;
  onClick?: () => void;
  collapsed?: boolean;
}) {
  const Icon = item.icon;

  return (
    <button
      type="button"
      onClick={onClick}
      title={item.label}
      className={cn(
        "relative flex h-[38px] items-center",
        "border-none text-left font-medium whitespace-nowrap",
        "font-sans text-[13px] cursor-pointer",
        "transition-all duration-[var(--tr)]",
        collapsed
          ? "justify-center px-0 w-full mx-0 rounded-none"
          : "mx-2.5 gap-2.5 px-3 rounded-[var(--r)] w-[calc(100%-20px)]",
        active
          ? "bg-nav-active-bg text-nav-active-fg font-semibold shadow-[var(--rein-nav-active-shadow)]"
          : "bg-transparent text-text-muted hover:bg-bg-hover hover:text-text",
        item.locked && "pointer-events-none opacity-45"
      )}
    >
      {/* Collapsed-mode active stripe on the left edge */}
      {active && collapsed && (
        <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-[2px] bg-primary" />
      )}
      <span className="flex shrink-0">
        <Icon className="size-[18px]" />
      </span>
      {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
      {!collapsed && item.locked && (
        <span className="ml-auto flex shrink-0 opacity-60">
          <Lock className="size-3" />
        </span>
      )}
      {collapsed && item.locked && (
        <Lock className="absolute top-1.5 right-1.5 size-2.5 opacity-50" />
      )}
    </button>
  );
}

export function Sidebar({
  screen,
  setScreen,
  userRole,
  userName = "Pengguna",
  userInitials = "U",
  collapsed = false,
}: SidebarProps) {
  const roleLabel = ROLE_LABELS[userRole] ?? userRole;
  const { can } = usePermissions();
  const hasPerm = (perm: Permission) => can(userRole, perm);
  return (
    <aside
      className={cn(
        "flex h-full min-h-0 shrink-0 flex-col overflow-hidden",
        "border-r border-border bg-bg-sidebar",
        collapsed
          ? "w-[60px] min-w-[60px]"
          : "w-[var(--sidebar-w)] min-w-[var(--sidebar-w)]"
      )}
    >
      {/* Scrollable navigation */}
      <div className="flex-1 overflow-y-auto py-3 px-0">
        {/* Main navigation */}
        {!collapsed && (
          <div className="px-5 pt-1 pb-2 text-[10px] font-bold uppercase tracking-[0.10em] text-text-light">
            Menu Utama
          </div>
        )}
        <div className="flex flex-col gap-0.5">
          {NAV_PRIMARY.map((item) => {
            if (item.permission && !hasPerm(item.permission)) return null;
            return (
              <SidebarItem
                key={item.id}
                item={item}
                active={screen === item.id}
                onClick={() => setScreen(item.id)}
                collapsed={collapsed}
              />
            );
          })}
        </div>

        {/* Admin — only visible to admin role */}
        {NAV_ADMIN.some((item) => !item.permission || hasPerm(item.permission)) && (
          <>
            {!collapsed && (
              <div className="px-5 pt-5 pb-2 text-[10px] font-bold uppercase tracking-[0.10em] text-text-light">
                Administrasi
              </div>
            )}
            {collapsed && <div className="mx-3 my-3 h-px bg-border-soft" />}
            <div className="flex flex-col gap-0.5">
              {NAV_ADMIN.map((item) => {
                if (item.permission && !hasPerm(item.permission)) return null;
                return (
                  <SidebarItem
                    key={item.id}
                    item={item}
                    active={screen === item.id}
                    onClick={() => setScreen(item.id)}
                    collapsed={collapsed}
                  />
                );
              })}
            </div>
          </>
        )}

        {/* Settings */}
        {!collapsed && (
          <div className="px-5 pt-5 pb-2 text-[10px] font-bold uppercase tracking-[0.10em] text-text-light">
            Lainnya
          </div>
        )}
        {collapsed && <div className="mx-3 my-3 h-px bg-border-soft" />}
        <div className="flex flex-col gap-0.5">
          {NAV_SETTINGS.map((item) => (
            <SidebarItem key={item.id} item={item} active={screen === item.id} collapsed={collapsed} />
          ))}
        </div>
      </div>

      {/* Bottom user info */}
      <div className="border-t border-border-soft py-3 px-0">
        <div
          className={cn(
            "flex cursor-pointer items-center gap-2.5 px-4 py-1.5",
            "transition-[background] duration-[var(--tr)]",
            "hover:bg-bg-hover",
            collapsed && "justify-center px-0"
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
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-semibold text-text">
                {userName}
              </span>
              <span className="block truncate text-[10.5px] text-text-muted">
                {roleLabel}
              </span>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
