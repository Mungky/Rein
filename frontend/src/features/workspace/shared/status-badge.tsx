import { STATUS_LABEL, STATUS_COLOR } from "../constants";

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`text-[10px] font-bold px-1.5 py-[1.5px] rounded-full ${STATUS_COLOR[status] ?? "bg-bg-hover text-text-muted"}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}