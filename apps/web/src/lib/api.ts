/** Klien API: JSON, cookie sesi same-origin, header CSRF `X-Requested-With: rein` (PRD §5). */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields: Record<string, string> = {},
    public readonly retryAfter = 0,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        'x-requested-with': 'rein',
        ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Tidak dapat terhubung ke server. Periksa koneksi Anda.');
  }
  const data = (await res.json().catch(() => null)) as {
    error?: { code: string; message: string; fields?: Record<string, string> };
  } | null;
  if (!res.ok) {
    // FR-004: sesi terkunci PIN → layout (app) menampilkan layar PIN.
    if (res.status === 423 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('rein:locked'));
    }
    const e = data?.error;
    const retryAfter = Number(res.headers.get('retry-after'));
    throw new ApiError(
      res.status,
      e?.code ?? 'HTTP_' + res.status,
      e?.message ?? 'Terjadi kesalahan',
      e?.fields,
      Number.isSafeInteger(retryAfter) && retryAfter > 0 ? retryAfter : 0,
    );
  }
  return data as T;
}
