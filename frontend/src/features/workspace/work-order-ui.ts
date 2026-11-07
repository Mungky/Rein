import type { BoardTask, Task } from "@/lib/api/workspace";
export const documentKinds = ["Gambar Detail", "Gambar Proses", "Gambar Fabrikasi", "Gambar Penawaran", "Wiring Diagram", "Dokumen QC", "Surat Jalan", "BAST", "Dokumentasi Proses", "Lainnya"];
export const materialStatuses: Record<string,string> = { requested:"Add Req", stock:"Stock", purchased:"PO", in_transit:"PO", received:"Recieved" };
export function workOrderLabel(task: Pick<Task,"name"|"wo_number">) { return task.wo_number ? `WO-${task.wo_number} - ${task.name}` : task.name; }
export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
export function picNames(task: BoardTask) {
  const names = task.planning?.assignees?.map(a=>a.name) ?? [];
  return names.length ? names.join(", ") : task.assigned_name ?? "PIC belum ditetapkan";
}
