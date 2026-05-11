"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/lib/supabase/client";

const SupabaseContext = createContext<SupabaseClient | null>(null);

export function useSupabase() {
  const client = useContext(SupabaseContext);
  return client;
}

export function SupabaseProvider({ children }: { children: ReactNode }) {
  const client = useMemo(() => getSupabaseClient(), []);

  return (
    <SupabaseContext.Provider value={client}>
      {children}
    </SupabaseContext.Provider>
  );
}