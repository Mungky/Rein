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
      title="Ganti tema"
      className={cn(
        "inline-flex h-[30px] w-[30px] shrink-0 cursor-pointer items-center justify-center rounded-[var(--r)] border-none bg-transparent text-text-muted transition-[background,color] duration-[var(--tr)] hover:bg-bg-hover hover:text-text",
        className
      )}
    >
      {theme === "dark" ? (
        <Moon className="size-[15px]" />
      ) : (
        <Sun className="size-[15px]" />
      )}
    </button>
  );
}