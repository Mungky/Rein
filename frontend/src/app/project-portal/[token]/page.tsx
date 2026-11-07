import type { Metadata } from "next";
import { CustomerPortal } from "@/features/workspace/customer-portal";

export const metadata: Metadata = { title: "Portal Proyek — REIN", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function ProjectPortalPage({ params, searchParams }: {
  params: Promise<{ token: string }>; searchParams: Promise<{ preview?: string }>;
}) {
  const { token } = await params;
  const { preview } = await searchParams;
  const apiBase = process.env.NODE_ENV === "development" && process.env.WORKSPACE_LOCAL_PREVIEW === "1" && preview === "1"
    ? "http://127.0.0.1:8001" : process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  return <CustomerPortal token={token} apiBase={apiBase} />;
}
