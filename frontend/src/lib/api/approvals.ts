/** Approvals API functions for REIN. */

import { apiClient } from "@/lib/api/client";

export interface Approval {
  id: string;
  documentId: string;
  documentNumber: string;
  documentTitle: string;
  documentType: string;
  requestedBy: string;
  requestedByName: string;
  status: "pending" | "approved" | "rejected";
  comment?: string;
  createdAt: string;
}

export const approvalsApi = {
  /** Get pending approvals. */
  getPending() {
    return apiClient.get<Approval[]>("/api/approvals/pending");
  },

  /** Approve a document. */
  approve(approvalId: string, comment?: string) {
    return apiClient.post<Approval>(`/api/approvals/${approvalId}/approve`, {
      comment,
    });
  },

  /** Reject a document. */
  reject(approvalId: string, comment?: string) {
    return apiClient.post<Approval>(`/api/approvals/${approvalId}/reject`, {
      comment,
    });
  },
};