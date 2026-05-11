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