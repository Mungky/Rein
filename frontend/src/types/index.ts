/** Type definitions for REIN application. */

import type { AppRole } from "@/lib/utils/roles";

export type { AppRole };

export interface User {
  id: string;
  email: string;
  full_name: string;
  initials: string;
  avatar_url: string | null;
  role: AppRole;
}

export interface Document {
  id: string;
  doc_number: string;
  doc_type: DocType;
  title: string;
  description: string | null;
  client_name: string | null;
  client_code: string | null;
  project_name: string | null;
  project_code: string | null;
  folder_path: string | null;
  file_name: string;
  file_size: number;
  mime_type: string | null;
  gdrive_file_id: string | null;
  gdrive_web_link: string | null;
  status: DocStatus;
  version: number;
  uploaded_by: string;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}

export type DocType = "DRW" | "INV" | "PO" | "SPK" | "RFP" | "RPT" | "SPEC" | "OTHER";
export type DocStatus = "draft" | "pending_review" | "approved" | "rejected" | "archived";

export interface UploadQueueItem {
  id: string;
  original_name: string;
  file_size: number;
  mime_type: string | null;
  detected_type: string | null;
  detected_client: string | null;
  detected_project: string | null;
  detected_folder: string | null;
  confidence_type: number | null;
  confidence_client: number | null;
  confidence_project: number | null;
  confidence_folder: number | null;
  status: UploadStatus;
  gdrive_file_id: string | null;
  created_at: string;
}

export type UploadStatus = "detecting" | "awaiting_confirmation" | "uploading" | "completed" | "failed";

export interface ChatMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  message_type: "text" | "tool_call" | "search_results" | "proposal" | "confirmation";
  content: Record<string, unknown>;
  created_at: string;
}

export interface Approval {
  id: string;
  document_id: string;
  requested_by: string;
  assigned_to: string;
  action: "approve" | "reject" | "request_changes" | null;
  comment: string | null;
  acted_at: string | null;
  created_at: string;
}

export interface AccessRequest {
  id: string;
  document_id: string;
  requested_by: string;
  status: "pending" | "approved" | "denied" | "expired";
  approved_by: string | null;
  expires_at: string | null;
  temp_token: string | null;
  created_at: string;
}