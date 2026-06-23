"use client";

import { Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";

interface ThemeToggleProps {
  theme: "light" | "dark";
  toggleTheme: () => void;
  className?: string;
}

export function ThemeToggle({ theme, toggleTheme, className }: ThemeToggleProps) {
  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={theme === "dark" ? "Mode terang" : "Mode gelap"}
      className={cn(
        "inline-flex size-9 shrink-0 cursor-pointer items-center justify-center",
        "rounded-[var(--r)] border-none bg-transparent text-text-muted",
        "transition-all duration-[var(--tr)]",
        "hover:bg-bg-hover hover:text-primary",
        className
      )}
    >
      {theme === "dark" ? (
        <Sun className="size-[16px]" />
      ) : (
        <Moon className="size-[16px]" />
      )}
    </button>
  );
}
