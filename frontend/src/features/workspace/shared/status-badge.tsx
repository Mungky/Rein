import { STATUS_LABEL, STATUS_COLOR } from "../constants";

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={STATUS_COLOR[status] ?? "badge badge-muted"}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
