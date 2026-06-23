"use client";

import { useCallback } from "react";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "@/components/providers/theme-provider";
import { useSidebar } from "@/hooks/use-sidebar";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth, useAuthDisplay } from "@/hooks/use-auth";
import { Topbar } from "@/components/layout/topbar";
import { Sidebar } from "@/components/layout/sidebar";
import { SidebarDrawer } from "@/components/layout/sidebar-drawer";
import { MobileNav } from "@/components/layout/mobile-nav";
import type { AppRole } from "@/lib/utils/roles";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();
  const { mobileOpen, setMobileOpen, desktopOpen, toggleDesktopOpen } = useSidebar();
  const isMobile = useIsMobile();
  const { loading: authLoading, logout } = useAuth();
  const { userName, userInitials, role: userRole } = useAuthDisplay();

  const handleLogout = useCallback(async () => {
    await logout();
    router.push("/login");
  }, [logout, router]);

  // Map pathname to screen ID
  const getScreen = () => {
    if (pathname?.startsWith("/approvals")) return "approvals";
    if (pathname?.startsWith("/dcc")) return "dcc";
    if (pathname?.startsWith("/admin")) return "admin";
    if (pathname?.startsWith("/workspace")) return "workspace";
    return "dashboard";
  };
  const screen = getScreen();

  const handleSetScreen = useCallback(
    (s: string) => {
      const routes: Record<string, string> = {
        dashboard: "/dashboard",
        dcc: "/dcc",
        approvals: "/approvals",
        admin: "/admin",
        workspace: "/workspace",
        crm: "/crm",
        projects: "/projects",
        finance: "/finance",
        hr: "/hr",
      };
      router.push(routes[s] ?? "/dashboard");
      if (isMobile) setMobileOpen(false);
    },
    [isMobile, router, setMobileOpen]
  );

  const sidebarProps = {
    screen,
    setScreen: handleSetScreen,
    userRole: userRole as AppRole,
    userName,
    userInitials,
  };

  // Show loading state while auth is being checked
  if (authLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg-sidebar">
        <div className="text-center">
          <div className="relative mx-auto size-14 animate-pulse">
            <Image
              src="/rein-logo.png"
              alt="REIN"
              fill
              sizes="56px"
              priority
              className="object-contain"
            />
          </div>
          <p className="mt-4 text-[13px] font-medium text-text-muted">Memuat…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Topbar */}
      <Topbar
        screen={screen}
        theme={theme}
        toggleTheme={toggleTheme}
        userName={userName}
        userRole={userRole as AppRole}
        userInitials={userInitials}
        sidebarOpen={desktopOpen}
        onMenuClick={() => {
          if (isMobile) setMobileOpen(!mobileOpen);
          else toggleDesktopOpen();
        }}
        onLogout={handleLogout}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Desktop sidebar — honors desktopOpen */}
        {!isMobile && desktopOpen && <Sidebar {...sidebarProps} />}

        {/* Mobile sidebar drawer */}
        {isMobile && (
          <SidebarDrawer
            open={mobileOpen}
            onOpenChange={setMobileOpen}
            {...sidebarProps}
          />
        )}

        {/* Main content */}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {children}
          </div>
        </main>
      </div>

      {/* Bottom nav for mobile */}
      {isMobile && <MobileNav screen={screen} setScreen={handleSetScreen} userRole={userRole as AppRole} />}
    </div>
  );
}