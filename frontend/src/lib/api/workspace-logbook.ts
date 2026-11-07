import type { ApiClient } from "./client";
import type { Task, TaskStatus } from "./workspace";

export interface WorkOrderFile { id:string; document_id?:string|null; name:string; content_type:string; bytes:number; status?:string; kind?:string }
export interface WorkLog { id:string; author_id:string; author_name:string; author_inactive?:boolean; work_date:string; body:string; minutes:number; created_at:string; attachments:WorkOrderFile[]; issue_id?:string|null; issue_status?:string|null }
export interface WorkOrderDetail {
  task:Task; project_id:string; project_name:string; rpo_number:string|null; archived:boolean;
  start_date:string|null; end_date:string|null; can_edit:boolean; can_execute:boolean; can_review:boolean;
  allowed_statuses:TaskStatus[];
  status_history:{id:string;author_name:string|null;created_at:string;from:TaskStatus;status:TaskStatus;note:string}[];
  assignees:{id:string;name:string;avatar_url?:string|null;inactive?:boolean}[];
  materials:{id:string;name:string;specification:string;quantity:number;unit:string;status:string;notes:string|null}[];
  issues:{id:string;title:string;status:string;source_log_id:string|null}[];
  attachments:WorkOrderFile[]; logged_minutes:number; log_total:number; logs:WorkLog[];
  previous_reports:{id:string;author_name:string;created_at:string;body:string|null;photos:string[]}[];
  previous_notes:{id:string;author_name:string|null;created_at:string;body:string}[];
}
export interface WorkOrderInput { archive_department?:string; request_id:string; name:string; description:string; pic_id?:string; pic_ids?:string[]; attachment_kind?:string; start_date:string; end_date:string; expected_updated_at?:string|null }
export interface WorkLogInput { archive_department?:string; request_id:string; work_date:string; body:string; minutes:number; is_issue?:boolean }
export function createLogbookApi(client:ApiClient) {return {
  workOrderPeople:(projectId:string) => client.get<{id:string;name:string}[]>(`/api/workspace/projects/${projectId}/work-order-people`),
  createWorkOrder:(projectId:string,body:WorkOrderInput,files:File[]) => client.multipart<Task>(`/api/workspace/projects/${projectId}/work-orders`,{metadata:JSON.stringify(body)},files),
  editWorkOrder:(taskId:string,body:WorkOrderInput,files:File[]) => client.multipart<Task>(`/api/workspace/tasks/${taskId}/work-order`,{metadata:JSON.stringify(body)},files,"PUT"),
  workOrderDetail:(taskId:string,offset=0) => client.get<WorkOrderDetail>(`/api/workspace/tasks/${taskId}/work-order`,{offset:String(offset)}),
  addWorkLog:(taskId:string,body:WorkLogInput,files:File[]) => client.multipart<{id:string}>(`/api/workspace/tasks/${taskId}/logbook`,{metadata:JSON.stringify(body)},files),
  finishWorkOrder:(taskId:string) => client.post<Task>(`/api/workspace/tasks/${taskId}/finish`),
  setWorkOrderStatus:(taskId:string,body:{status:TaskStatus;expected_updated_at:string;note?:string}) => client.put<Task>(`/api/workspace/tasks/${taskId}/work-order/status`,body),
  rescheduleWorkOrder:(taskId:string,body:{end_date:string;expected_updated_at:string}) => client.put<Task>(`/api/workspace/tasks/${taskId}/work-order/schedule`,body),
};}
