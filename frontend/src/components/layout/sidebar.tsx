"use client";

import { cn } from "@/lib/utils";
import {
  LayoutGrid,
  FolderOpen,
  Settings,
  Lock,
  Shield,
  FolderKanban,
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
        "relative flex h-[32px] items-center",
        "border-none bg-transparent text-left font-medium whitespace-nowrap",
        "font-sans text-[13.5px] text-text-muted cursor-pointer",
        "transition-[background,color] duration-[var(--tr)]",
        "hover:bg-bg-hover hover:text-text",
        collapsed
          ? "justify-center px-0 w-full"
          : "mx-2 gap-[9px] px-2.5 rounded-[var(--r)] w-[calc(100%-16px)]",
        active && "bg-bg-sel font-semibold text-primary",
        item.locked && "pointer-events-none opacity-45"
      )}
    >
      {active && !collapsed && (
        <span className="absolute left-0 top-[5px] bottom-[5px] w-[3px] rounded-r-[2px] bg-primary" />
      )}
      <span className="flex shrink-0">
        <Icon className={cn("size-4", active && !collapsed && "ml-[3px]")} />
      </span>
      {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
      {!collapsed && item.locked && (
        <span className="ml-auto flex shrink-0">
          <Lock className="size-[11px]" />
        </span>
      )}
      {collapsed && item.locked && (
        <Lock className="absolute top-1 right-1 size-[8px] opacity-60" />
      )}
      {active && collapsed && (
        <span className="absolute left-0 top-0 bottom-0 w-[3px] rounded-r-[2px] bg-primary" />
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
        "flex shrink-0 flex-col overflow-hidden",
        "border-r border-border bg-bg-sidebar",
        collapsed
          ? "w-[56px] min-w-[56px]"
          : "w-[var(--sidebar-w)] min-w-[var(--sidebar-w)]"
      )}
    >
      {/* Scrollable navigation */}
      <div className="flex-1 overflow-y-auto py-1.5 px-0">
        {/* Main navigation */}
        {!collapsed && (
          <div className="px-4 pt-3 pb-[3px] text-[10px] font-bold uppercase tracking-[0.09em] text-text-light">
            Menu Utama
          </div>
        )}
        {NAV_PRIMARY.map((item) => {
          // Hide items that require a permission the user doesn't have
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

        {!collapsed && <div className="mx-4 my-1.5 h-px bg-border-soft" />}

        {/* Admin — only visible to admin role */}
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

        {!collapsed && <div className="mx-4 my-1.5 h-px bg-border-soft" />}

        {/* Settings */}
        {NAV_SETTINGS.map((item) => (
          <SidebarItem key={item.id} item={item} active={screen === item.id} collapsed={collapsed} />
        ))}
      </div>

      {/* Bottom user info */}
      <div className="border-t border-border py-1.5 px-0">
        <div
          className={cn(
            "flex cursor-pointer items-center gap-[9px] px-3.5 py-[7px]",
            "transition-[background] duration-[var(--tr)]",
            "hover:bg-bg-hover",
            collapsed && "justify-center px-0"
          )}
        >
          <div
            className={cn(
              "flex size-7 shrink-0 items-center justify-center",
              "rounded-full bg-primary text-text-inv",
              "text-[10.5px] font-bold"
            )}
          >
            {userInitials}
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <span className="block text-[12.5px] font-semibold text-text">
                {userName}
              </span>
              <span className="block text-[10px] text-text-muted">
                {roleLabel}
              </span>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}