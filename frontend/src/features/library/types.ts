export type FolderType = "department" | "project" | "client" | "custom";

export type LibraryFileStatus =
  | "uploading"
  | "in_audit"
  | "passed"
  | "failed"
  | "archived";

export type ViewRequestStatus = "pending" | "approved" | "denied" | "expired" | "none";

export interface FolderNode {
  id: string;
  name: string;
  department: string;
  dept_label: string;
  folder_type: FolderType;
  path: string;
  gdrive_folder_id: string | null;
  file_count: number;
  last_updated: string | null;
  children: FolderNode[];
}

export interface AuditLayer {
  layer: number;
  layer_name: string;
  status: string;
  result: Record<string, unknown> | null;
}

export interface TempFile extends LibraryFileMeta {
  upload_status: LibraryFileStatus;
  audit_layers: AuditLayer[];
}

export interface ActivityLogEntry {
  id: string;
  action: string;
  actor_id: string | null;
  target_type: string | null;
  target_id: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
}

export interface LibraryFileMeta {
  id: string;
  file_name: string;
  original_name: string;
  doc_type: string | null;
  doc_number: string | null;
  title: string | null;
  client_code: string | null;
  client_name: string | null;
  project_code: string | null;
  project_name: string | null;
  note: string | null;
  file_size: number;
  mime_type: string | null;
  uploader_id: string;
  upload_status: LibraryFileStatus;
  created_at: string;
}

export interface DetectedField {
  value: string | null;
  code?: string | null;
  confidence: number;
}

export interface ProposeResult {
  filename: string;
  detected: {
    doc_type: DetectedField;
    client: DetectedField & { code: string | null };
    project: DetectedField & { code: string | null };
    folder: DetectedField;
  };
}

export interface UploadFormValues {
  folder_id: string;
  doc_type: string;
  client_code: string;
  client_name: string;
  project_code: string;
  project_name: string;
  title: string;
  note: string;
}

export interface ViewRequestResponse {
  status: ViewRequestStatus;
  request_id?: string;
  expires_at?: string;
  direct_access?: boolean;
  temp_link?: string;
  link_expires_at?: string;
  message?: string;
}
