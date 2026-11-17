/**
 * Real-time (FR-080): satu EventSource `/api/stream` per tab. Menyimpan jumlah notifikasi
 * belum dibaca untuk badge sidebar/bottom nav, dan meneruskan event `wo`/`project` ke halaman
 * yang sedang terbuka agar memuat ulang datanya. EventSource menyambung ulang sendiri.
 */
type LiveEvent =
  | { type: 'notification'; unread: number }
  | { type: 'wo'; woId: string; projectId: string }
  | { type: 'project'; projectId: string }
  | { type: 'verification' };

export const live = $state({ unread: 0, connected: false });

// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Registry event internal, bukan state tampilan.
const listeners = new Set<(e: LiveEvent) => void>();
let source: EventSource | null = null;

export function onLive(fn: (e: LiveEvent) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(e: LiveEvent) {
  for (const fn of listeners) fn(e);
}

export function startLive(): void {
  if (source || typeof EventSource === 'undefined') return;
  source = new EventSource('/api/stream');
  source.addEventListener('open', () => (live.connected = true));
  source.addEventListener('error', () => (live.connected = false));
  const parse = (m: MessageEvent) => {
    try {
      return JSON.parse(m.data as string) as Record<string, unknown>;
    } catch {
      return {};
    }
  };
  source.addEventListener('hello', (m) => {
    live.unread = Number(parse(m).unread ?? 0);
  });
  source.addEventListener('notification', (m) => {
    live.unread = Number(parse(m).unread ?? live.unread);
    emit({ type: 'notification', unread: live.unread });
  });
  for (const type of ['wo', 'project', 'verification'] as const) {
    source.addEventListener(type, (m) => emit({ ...(parse(m) as object), type } as LiveEvent));
  }
}

export function stopLive(): void {
  source?.close();
  source = null;
  live.connected = false;
}

export function setUnread(n: number): void {
  live.unread = Math.max(0, n);
}
