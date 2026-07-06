"use client";

/** Shared refresh cadence for historian panels: fetch on mount (deferred a
 *  tick so state lands after the effect commit), every 60s (the sampler
 *  cadence), and whenever the tab becomes visible again. */

import { useEffect } from "react";

const REFRESH_MS = 60_000;

export function usePanelRefresh(load: () => Promise<void>) {
  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const interval = setInterval(() => void load(), REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);
}
