/** Access request API functions for REIN. */

import { apiClient } from "@/lib/api/client";

export interface AccessRequest {
  id: string;
  documentId: string;
  documentName: string;
  documentNumber?: string;
  documentTitle?: string;
  requestedBy: string;
  requestedByName: string;
  reason?: string;
  status: "pending" | "approved" | "denied" | "expired";
  token?: string;
  expiresAt?: string;
  createdAt: string;
}

export interface AccessVerifyResult {
  valid: boolean;
  documentId: string;
  documentName: string;
  expiresAt: string;
}

export const accessApi = {
  /** Request access to a document. */
  requestAccess(documentId: string, reason?: string) {
    return apiClient.post<AccessRequest>("/api/access/request", {
      documentId,
      reason,
    });
  },

  /** Get pending access requests. */
  getPending() {
    return apiClient.get<AccessRequest[]>("/api/access/pending");
  },

  /** Verify an access token. */
  verifyToken(token: string) {
    return apiClient.get<AccessVerifyResult>(`/api/access/${token}`);
  },

  /** Approve an access request. */
  approveAccess(requestId: string) {
    return apiClient.post<AccessRequest>(`/api/access/${requestId}/approve`);
  },

  /** Deny an access request. */
  denyAccess(requestId: string) {
    return apiClient.post<AccessRequest>(`/api/access/${requestId}/deny`);
  },
};