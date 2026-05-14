export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-bg-hover rounded-full h-1.5 overflow-hidden">
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
      <span className="text-[10.5px] text-text-muted shrink-0">{value}%</span>
    </div>
  );
}