import type { IconName } from './icons';

export interface ToastItem {
  id: number;
  message: string;
  icon: IconName;
  tone: 'default' | 'danger';
  duration: number;
  link?: { label: string; onclick: () => void };
}

export const toasts = $state<ToastItem[]>([]);
let seq = 0;

export function dismissToast(id: number): void {
  const i = toasts.findIndex((t) => t.id === id);
  if (i >= 0) toasts.splice(i, 1);
}

/** Tampilkan toast (prototype: 3,6 detik, bar progres di bawah). */
export function toast(
  message: string,
  opts: Partial<Omit<ToastItem, 'id' | 'message'>> = {},
): number {
  const item: ToastItem = {
    id: ++seq,
    message,
    icon: opts.icon ?? (opts.tone === 'danger' ? 'alert' : 'check'),
    tone: opts.tone ?? 'default',
    duration: opts.duration ?? 3600,
    ...(opts.link ? { link: opts.link } : {}),
  };
  toasts.push(item);
  if (toasts.length > 4) toasts.shift();
  setTimeout(() => dismissToast(item.id), item.duration);
  return item.id;
}
