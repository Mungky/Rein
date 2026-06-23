import { create } from "zustand";

const STORAGE_KEY = "rein-sidebar-desktop-open";

function readInitialDesktopOpen(): boolean {
  if (typeof window === "undefined") return true;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "false") return false;
  if (stored === "true") return true;
  return true;
}

interface SidebarState {
  /** Sidebar visibility on desktop (≥ md). Persisted to localStorage. */
  desktopOpen: boolean;
  /** Reserved: pin behavior — currently unused but kept for future. */
  pinned: boolean;
  /** Icon-only collapsed mode (tablet width). */
  collapsed: boolean;
  /** Mobile drawer open state. */
  mobileOpen: boolean;
  setDesktopOpen: (open: boolean) => void;
  toggleDesktopOpen: () => void;
  setPinned: (pinned: boolean) => void;
  setCollapsed: (collapsed: boolean) => void;
  setMobileOpen: (open: boolean) => void;
  toggleCollapsed: () => void;
  toggleMobileOpen: () => void;
}

export const useSidebar = create<SidebarState>((set) => ({
  desktopOpen: readInitialDesktopOpen(),
  pinned: true,
  collapsed: false,
  mobileOpen: false,

  setDesktopOpen: (desktopOpen) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, String(desktopOpen));
    }
    set({ desktopOpen });
  },
  toggleDesktopOpen: () =>
    set((s) => {
      const next = !s.desktopOpen;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, String(next));
      }
      return { desktopOpen: next };
    }),
  setPinned: (pinned) => set({ pinned }),
  setCollapsed: (collapsed) => set({ collapsed }),
  setMobileOpen: (mobileOpen) => set({ mobileOpen }),
  toggleCollapsed: () => set((s) => ({ collapsed: !s.collapsed })),
  toggleMobileOpen: () => set((s) => ({ mobileOpen: !s.mobileOpen })),
}));
