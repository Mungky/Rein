"use client";
import { PageGuard } from "@/components/guards/page-guard";
import { OperationsDashboard } from "@/features/workspace/operations-dashboard";
export default function DashboardPage() { return <PageGuard permission="dashboard:view"><OperationsDashboard /></PageGuard>; }
