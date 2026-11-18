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
  opts: { method?: string; body?: unknown; signal?: AbortSignal; account?: string } = {},
): Promise<T> {
  const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
  const timeout = AbortSignal.timeout(15_000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  let res: Response;
  let data: { error?: { code: string; message: string; fields?: Record<string, string> } } | null;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        'x-requested-with': 'rein',
        ...(opts.account ? { 'x-rein-account': opts.account } : {}),
        ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
      signal,
    });
    data = await res.json().catch((err: unknown) => {
      if (signal.aborted) throw err;
      return null;
    });
  } catch {
    if (timeout.aborted)
      throw new ApiError(0, 'TIMEOUT', 'Server belum merespons setelah 15 detik. Coba lagi.');
    throw new ApiError(0, 'NETWORK', 'Tidak dapat terhubung ke server. Periksa koneksi Anda.');
  }
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
