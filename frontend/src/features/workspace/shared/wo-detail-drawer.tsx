"use client";

/**
 * Work Order Detail View — full-screen enterprise view for a task/WO.
 * Replaces the old narrow drawer with the comprehensive widescreen WorkOrderDetail.
 */

import { type ReactNode } from "react";
import { workspaceApi, type Task } from "@/lib/api/workspace";
import { WorkOrderDetail } from "../work-order-detail";

export interface WoDetailDrawerProps {
  operationalPanel?: ReactNode;
  projectFeatures?: boolean;
  api?: typeof workspaceApi;
  taskId: string;
  /** Optional initial data — if provided, view displays immediately. */
  initial?: Task;
  /** When closed, refetch parent's data — caller decides which lists to reload. */
  onClose: () => void;
  /** Permissions calculated by parent (uses useCan from permissions-provider). */
  canManage: boolean;
  canExecute: boolean;
  canReview: boolean;
  /** Optional callback when task is mutated, so caller can refresh siblings. */
  onTaskChanged?: (task: Task) => void;
  /** RPO + phase name for breadcrumb context. */
  rpoNumber?: string | null;
  phaseName?: string | null;
}

export function WoDetailDrawer({
  operationalPanel,
  projectFeatures,
  api = workspaceApi,
  taskId,
  initial,
  onClose,
  canManage,
  canExecute,
  canReview,
  onTaskChanged,
  rpoNumber,
  phaseName,
}: WoDetailDrawerProps) {
  return (
    <WorkOrderDetail
      api={api}
      taskId={taskId}
      initial={initial}
      onClose={onClose}
      onChanged={onTaskChanged ? () => onTaskChanged(initial!) : undefined}
      canManage={canManage}
      canExecute={canExecute}
      canReview={canReview}
      rpoNumber={rpoNumber}
      phaseName={phaseName}
      operationalPanel={operationalPanel}
      projectFeatures={projectFeatures}
    />
  );
}
