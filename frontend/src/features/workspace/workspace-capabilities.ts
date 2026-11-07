"use client";
import { usePermissions } from "@/components/providers/permissions-provider";
import type { AppRole } from "@/lib/utils/roles";
import type { WorkspaceCapabilities } from "./project-hub";
export function useWorkspaceCapabilities(role: AppRole | null): WorkspaceCapabilities {
  const {can}=usePermissions();
  const allowed=(key: Parameters<typeof can>[1])=>!!role&&can(role,key);
  const manage=allowed("workspace:manage");
  return {manage,createWo:manage||allowed("workspace:create_wo"),execute:manage||allowed("workspace:execute_wo"),review:manage||allowed("workspace:review_wo"),publish:allowed("workspace:publish_document"),approve:allowed("workspace:approve_document"),release:allowed("workspace:release_work"),verify:allowed("workspace:verify_issue"),warehouse:allowed("workspace:warehouse"),purchase:allowed("workspace:purchase"),archive:allowed("workspace:archive")};
}
