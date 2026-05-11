"use client";

import { useCallback } from "react";
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
  const { mobileOpen, setMobileOpen } = useSidebar();
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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          background: "var(--rein-bg-sidebar)",
        }}
      >
        <div style={{ textAlign: "center" }}>
          {/* REIN diamond spinner */}
          <svg
            width="36"
            height="36"
            viewBox="0 0 48 48"
            fill="none"
            style={{ animation: "pulse 1.5s ease-in-out infinite", margin: "0 auto" }}
          >
            <path d="M24 4L44 24L24 44L4 24Z" fill="var(--rein-primary)" opacity="0.5" />
          </svg>
          <p
            style={{
              marginTop: 12,
              fontSize: 13,
              color: "var(--rein-text-muted)",
            }}
          >
            Memuat...
          </p>
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
        onMenuClick={() => setMobileOpen(!mobileOpen)}
        onLogout={handleLogout}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Desktop sidebar */}
        {!isMobile && <Sidebar {...sidebarProps} />}

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