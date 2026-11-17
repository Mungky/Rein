import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('batas kirim API', () => {
  it('mempertahankan pesan server dan waktu tunggu Retry-After', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Tunggu satu menit.' } }),
            { status: 429, headers: { 'retry-after': '57' } },
          ),
        ),
    );
    const err = await api('/api/auth/verify-whatsapp/start').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
      message: 'Tunggu satu menit.',
      retryAfter: 57,
    });
  });
  it('header waktu tunggu yang tidak valid tidak membuat countdown rusak', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('', { status: 502, headers: { 'retry-after': 'invalid' } }),
        ),
    );
    await expect(api('/api/auth/verify-whatsapp/start')).rejects.toMatchObject({
      status: 502,
      retryAfter: 0,
    });
  });
});
