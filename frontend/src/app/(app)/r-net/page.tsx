"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import { PageGuard } from "@/components/guards/page-guard";

// react-grid-layout + hls.js measure the DOM — client-only, no prerender
const ScadaView = dynamic(
  () => import("@/features/scada/scada-view").then((m) => m.ScadaView),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    ),
  }
);

export default function ScadaPage() {
  return (
    <PageGuard permission="scada:view">
      <ScadaView />
    </PageGuard>
  );
}
