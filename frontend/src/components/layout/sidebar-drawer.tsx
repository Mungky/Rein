"use client";

import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Sidebar, type SidebarProps } from "@/components/layout/sidebar";

export interface SidebarDrawerProps extends SidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SidebarDrawer({ open, onOpenChange, ...sidebarProps }: SidebarDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        showCloseButton={true}
        // Inline style overrides the primitive's `inset-y-0 h-full`: sit BELOW the
        // app topbar (z-[100]) so its top items aren't hidden behind it, with a
        // bounded height so the nav scrolls internally.
        style={{ top: "var(--topbar-h)", height: "calc(100dvh - var(--topbar-h))" }}
        className={cn(
          "w-[var(--sidebar-w)] p-0",
          "bg-bg-sidebar border-r border-border"
        )}
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Menu navigasi</SheetTitle>
        </SheetHeader>
        <Sidebar {...sidebarProps} />
      </SheetContent>
    </Sheet>
  );
}