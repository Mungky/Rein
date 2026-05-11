import { create } from "zustand";

interface SidebarState {
  pinned: boolean;
  collapsed: boolean;
  mobileOpen: boolean;
  setPinned: (pinned: boolean) => void;
  setCollapsed: (collapsed: boolean) => void;
  setMobileOpen: (open: boolean) => void;
  toggleCollapsed: () => void;
  toggleMobileOpen: () => void;
}

export const useSidebar = create<SidebarState>((set) => ({
  pinned: true,
  collapsed: false,
  mobileOpen: false,

  setPinned: (pinned) => set({ pinned }),
  setCollapsed: (collapsed) => set({ collapsed }),
  setMobileOpen: (mobileOpen) => set({ mobileOpen }),
  toggleCollapsed: () => set((s) => ({ collapsed: !s.collapsed })),
  toggleMobileOpen: () => set((s) => ({ mobileOpen: !s.mobileOpen })),
}));