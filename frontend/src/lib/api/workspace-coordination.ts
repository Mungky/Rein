export interface UploadDestination {enabled:boolean;requires_choice:boolean;default_department:string|null;project_folder:string;departments:{key:string;label:string}[]}
import type { ApiClient } from "./client";

export interface WorkControl { task_id: string; division: string; pic_id: string | null; pic_name: string | null; planned_start: string | null; planned_end: string | null; drawing_required: boolean; material_required: boolean; released_at: string | null; released_by: string | null; release_note: string | null }
export interface WorkReadiness { task_id: string; can_release: boolean; released: boolean; ready: boolean; reasons: string[]; state: string }
export interface ProjectDocument { storage?:"drive"|"database"; archive_department?:string; archive_path?:string; library_file_id?:string; library_folder_id?:string; file_deleted?:boolean; author_id?:string; attachment_id?:string|null; source?:string; log_id?:string|null; id: string; task_id: string | null; code: string; title: string; kind: string; revision: number; status: string; filename: string; size: number; client_approved: boolean; approval_evidence: string | null; approved_at: string | null; approved_by: string | null; author: string; current: boolean; created_at: string; receipts: {profile_id: string; name: string; acknowledged_at: string | null}[] }
export interface ProjectIssue { author_id?:string; source_log_id?:string|null; id: string; task_id: string | null; kind: "blocker" | "punch"; title: string; description: string; pic_id: string; pic_name: string; pic_inactive?: boolean; due_date: string; status: string; resolution: string | null; evidence: string | null; created_at: string; resolved_at: string | null; verified_by: string | null; verified_at: string | null; waiting_hours: number }
export interface Coordination { archive_enabled?:boolean; daily_updates?: Record<string,{work_date:string;count:number}>; members: { profile_id: string; name: string; avatar_url?:string|null; inactive?: boolean; division: string; source?:string; work_orders?:{id:string;name:string;wo_number:number;status:string}[] }[]; people: {id: string; name: string; role: string; avatar_url?:string|null}[]; controls: WorkControl[]; readiness: WorkReadiness[]; documents: ProjectDocument[]; issues: ProjectIssue[]; logged_minutes: Record<string,number>; events: {id: string; actor: string; action: string; payload: Record<string, unknown>; created_at: string}[] }
export interface StockItem { id: string; sku: string; name: string; unit: string; usable: number; reserved: number; available: number; unusable: number; loaned: number }
export interface ProjectMaterial { line_number?:number|null; specification?:string; updated_at?:string; author_id?:string; project_id?: string; project_name?: string; id: string; task_id: string | null; item_id: string; sku: string; name: string; unit: string; quantity: number; received: number; reserved: number; issued: number; shortage: number; status: string; eta: string | null; order_reference: string | null; notes: string | null }
export type MovementKind = "receipt" | "receipt_rejected" | "reserve" | "unreserve" | "issue" | "loan" | "return_loan" | "return_project" | "quarantine" | "restore" | "stocktake";
export interface Movement { id: string; item_id: string; name: string; sku: string; unit: string; kind: MovementKind; quantity: number; reference: string; notes: string; actor: string; material_request_id: string | null; created_at: string }
export interface Staffing { id: string; name: string; role: string; conflicts: number; jobs: {task_id: string; name: string; project_id: string; project: string; division: string; pic: string | null; start: string | null; end: string | null; estimated_minutes: number; actual_minutes: number; state: string; conflict: boolean}[] }
export interface OperationsSummary { counts: {active_projects: number; late_projects: number; ready: number; blocked: number; review: number; document_approvals: number; pending_receipts: number; material_shortages: number; open_issues: number}; projects: {id: string; name: string; rpo_number: string | null; client_name: string | null; deadline: string | null; late: boolean; progress: number; status: string}[]; work: (WorkReadiness & {name: string; project_id: string; project: string; pic: string | null; deadline: string | null; status: string})[]; issues: {id: string; project_id: string; project: string; title: string; kind: string; pic: string; due_date: string; status: string; waiting_hours: number}[]; documents: {id: string; project_id: string; project: string; title: string; revision: number; status: string; awaiting_me: boolean}[]; materials: {id: string; project_id: string; project: string; item_id: string; shortage: number; status: string; eta: string | null}[] }

export interface MaterialLineInput { request_id:string; line_number?:number|null; description:string; specification:string; quantity:number; unit:string; status:string; notes:string; task_id:string|null; expected_updated_at?:string }
export interface MaterialImportPreview { valid:boolean; items:{row:number;line_number:number|null;description:string;specification:string;quantity:string;unit:string;status:string;notes:string;wo:string}[]; errors:{row:number;message:string}[] }

export interface ProjectActivity { total:number; items:{id:string;actor:string;avatar_url:string|null;action:string;task_id:string|null;payload:Record<string,unknown>;created_at:string}[] }

export function createCoordinationApi(client: ApiClient) { return {
  linkDocument:(id:string,task_id:string|null)=>client.put(`/api/workspace/project-documents/${id}/work-order`,{task_id}),
  linkIssue:(id:string,task_id:string|null)=>client.put(`/api/workspace/project-issues/${id}/work-order`,{task_id}),
  addMaterialLine:(projectId:string,body:MaterialLineInput)=>client.post(`/api/workspace/projects/${projectId}/material-list`,body),
  updateMaterialLine:(id:string,body:MaterialLineInput)=>client.put(`/api/workspace/material-requests/${id}/details`,body),
  materialTemplate:(projectId:string)=>client.getBlob(`/api/workspace/projects/${projectId}/materials/template`),
  previewMaterialImport:(projectId:string,file:File)=>client.upload<MaterialImportPreview>(`/api/workspace/projects/${projectId}/materials/import-preview`,file),
  importMaterialList:(projectId:string,file:File,request_id:string)=>client.upload<{count:number}>(`/api/workspace/projects/${projectId}/materials/import`,file,"file",{request_id}),
  projectActivity:(projectId:string,offset=0,q="")=>client.get<ProjectActivity>(`/api/workspace/projects/${projectId}/activity`,{offset:String(offset),limit:"25",q}),
  coordination: (projectId: string) => client.get<Coordination>(`/api/workspace/projects/${projectId}/coordination`),
  operationsSummary: () => client.get<OperationsSummary>("/api/workspace/operations/summary"),
  manpower: () => client.get<Staffing[]>("/api/workspace/operations/manpower"),
  addProjectMember: (projectId: string, data: {profile_id: string; division: string}) => client.put(`/api/workspace/projects/${projectId}/members`, data),
  projectUploadDestination: (projectId:string,documentId?:string) => client.get<UploadDestination>(`/api/workspace/projects/${projectId}/upload-destination`,documentId?{document_id:documentId}:{}),
  archiveProjectDocument: (documentId:string,department?:string) => client.post(`/api/workspace/project-documents/${documentId}/archive`,{department:department||null}),
  archiveProject: (projectId: string, archive: boolean) => client.post(`/api/workspace/projects/${projectId}/archive?archive=${archive}`),
  deleteProject: (projectId: string, confirmation: string) => client.delete(`/api/workspace/projects/${projectId}?confirmation=${encodeURIComponent(confirmation)}`),
  saveWorkControl: (projectId: string, taskId: string, data: {division: string; pic_id: string; planned_start: string; planned_end: string; drawing_required: boolean; material_required: boolean}) => client.put(`/api/workspace/projects/${projectId}/work-controls/${taskId}`, data),
  releaseWork: (projectId: string, taskId: string, data: {note: string; release: boolean}) => client.post(`/api/workspace/projects/${projectId}/work-controls/${taskId}/release`, data),
  publishDocument: (projectId: string, file: File, fields: Record<string,string>) => client.upload(`/api/workspace/projects/${projectId}/documents`, file, "file", fields),
  approveProjectDocument: (id: string, data: {decision: "approved" | "rejected"; client_approved: boolean; evidence: string}) => client.post(`/api/workspace/project-documents/${id}/approval`, data),
  acknowledgeProjectDocument: (id: string) => client.post(`/api/workspace/project-documents/${id}/acknowledge`),
  addDocumentRecipients: (id: string, profile_ids: string[]) => client.post(`/api/workspace/project-documents/${id}/recipients`, {profile_ids}),
  downloadProjectDocument: (id: string) => client.getBlob(`/api/workspace/project-documents/${id}/download`),
  createIssue: (projectId: string, data: {request_id?: string; kind: "blocker" | "punch"; task_id: string | null; title: string; description: string; pic_id: string; due_date: string}) => client.post(`/api/workspace/projects/${projectId}/issues`, data),
  resolveIssue: (id: string, data: {resolution: string; evidence: string}) => client.post(`/api/workspace/project-issues/${id}/resolve`, data),
  verifyIssue: (id: string, accept: boolean) => client.post(`/api/workspace/project-issues/${id}/verify?accept=${accept}`),
  stockCatalog: () => client.get<StockItem[]>("/api/workspace/materials/catalog"),
  createStockItem: (data: {sku: string; name: string; unit: string}) => client.post("/api/workspace/materials/catalog", data),
  materialQueue: () => client.get<ProjectMaterial[]>("/api/workspace/materials/requests"),
  projectMaterials: (projectId: string) => client.get<ProjectMaterial[]>(`/api/workspace/projects/${projectId}/materials`),
  requestMaterial: (projectId: string, data: {request_id: string; item_id: string; task_id: string | null; quantity: number; notes: string}) => client.post(`/api/workspace/projects/${projectId}/materials`, data),
  purchaseMaterial: (id: string, data: {status: string; order_reference: string; eta: string; notes: string}) => client.put(`/api/workspace/material-requests/${id}/purchase`, data),
  moveStock: (data: {request_id: string; item_id: string; material_request_id: string | null; related_move_id: string | null; kind: MovementKind; quantity: number; reference: string; notes: string}) => client.post("/api/workspace/materials/movements", data),
  stockMovements: (params: Record<string,string> = {}) => client.get<{total:number; items:Movement[]}>("/api/workspace/materials/movements", params),
}; }
