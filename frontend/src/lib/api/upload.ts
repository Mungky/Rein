/** API client for the upload propose/confirm/cancel flow. */

import { apiClient } from "./client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UploadProposal {
  id: string;
  filename: string;
  size: number;
  mime_type: string | null;
  status: string;
  detected_type: string | null;
  detected_type_confidence: number;
  detected_client_code: string | null;
  detected_client_name: string | null;
  detected_client_confidence: number;
  detected_project_code: string | null;
  detected_project_name: string | null;
  detected_project_confidence: number;
  detected_folder: string | null;
  detected_folder_confidence: number;
  gdrive_link: string | null;
  expires_at: string | null;
}

export interface UploadConfirm {
  doc_type?: string;
  client_code?: string;
  client_name?: string;
  project_code?: string;
  project_name?: string;
  folder_path?: string;
  title?: string;
  note?: string;
}

export interface UploadConfirmResponse {
  id: string;
  document_id: string;
  doc_number: string;
  status: string;
  gdrive_link: string | null;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export const uploadApi = {
  /** PROPOSE: Upload a file and get metadata proposal back */
  propose: async (file: File): Promise<UploadProposal> => {
    const formData = new FormData();
    formData.append("file", file);

    // Use raw fetch for multipart upload (apiClient doesn't support FormData well)
    const { getSupabaseClient } = await import("@/lib/supabase/client");
    const supabase = getSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();

    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/upload/`, {
      method: "POST",
      headers: {
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: "Upload gagal" }));
      throw new Error(error.detail || `Upload gagal (${response.status})`);
    }

    return response.json();
  },

  /** CONFIRM: Accept/edit metadata and create document record */
  confirm: async (uploadId: string, edits: UploadConfirm): Promise<UploadConfirmResponse> => {
    return apiClient.post<UploadConfirmResponse>(`/api/upload/${uploadId}/confirm`, edits);
  },

  /** CANCEL: Cancel an upload proposal */
  cancel: async (uploadId: string): Promise<{ id: string; status: string }> => {
    return apiClient.delete(`/api/upload/${uploadId}`);
  },

  /** LIST: Get user's active proposals */
  listProposals: async (): Promise<UploadProposal[]> => {
    return apiClient.get<UploadProposal[]>("/api/upload/proposals");
  },
};