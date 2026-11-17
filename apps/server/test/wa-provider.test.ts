import { describe, expect, it } from 'vitest';
import { OpenWAProvider, WaPermanentError } from '../src/wa/provider';

type Call = { url: string; init: RequestInit };

function fakeFetch(routes: Record<string, (init: RequestInit) => [number, unknown]>) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const key = `${init.method ?? 'GET'} ${new URL(url).pathname}`;
    const handler = routes[key];
    const [status, body] = handler ? handler(init) : [404, { message: 'not found' }];
    return new Response(body === undefined ? '' : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const SESSION = { id: '0d3c2a52-5c1f-4d8e-9c55-2a1a5d9b0f11', name: 'rein', status: 'ready' };

describe('OpenWAProvider', () => {
  it('kirim teks: cari sesi per nama, chatId @c.us, X-API-Key & Idempotency-Key', async () => {
    const { fn, calls } = fakeFetch({
      'GET /api/sessions': () => [200, [{ ...SESSION, name: 'lain', id: 'x' }, SESSION]],
      [`POST /api/sessions/${SESSION.id}/messages/send-text`]: () => [201, { messageId: 'm-1' }],
    });
    const wa = new OpenWAProvider({
      baseUrl: 'http://openwa:2785/',
      apiKey: 'kunci-rahasia',
      sessionName: 'rein',
      fetch: fn,
    });
    const res = await wa.sendText('+62 812-3456-789', 'Halo', 'delivery-1');
    expect(res.id).toBe('m-1');
    const send = calls.at(-1)!;
    expect(send.url).toBe(`http://openwa:2785/api/sessions/${SESSION.id}/messages/send-text`);
    const headers = send.init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('kunci-rahasia');
    expect(headers['idempotency-key']).toBe('delivery-1');
    expect(JSON.parse(String(send.init.body))).toEqual({
      chatId: '628123456789@c.us',
      text: 'Halo',
      linkPreview: false,
    });
  });

  it('4xx permanen → WaPermanentError; 409 (sesi belum siap) & 5xx → error biasa', async () => {
    let status = 400;
    const { fn } = fakeFetch({
      'GET /api/sessions': () => [200, [SESSION]],
      [`POST /api/sessions/${SESSION.id}/messages/send-text`]: () => [status, { message: 'x' }],
    });
    const wa = new OpenWAProvider({
      baseUrl: 'http://o',
      apiKey: 'k',
      sessionName: 'rein',
      fetch: fn,
    });
    await expect(wa.sendText('+6281', 't', 'k1')).rejects.toBeInstanceOf(WaPermanentError);
    for (const s of [409, 429, 503]) {
      status = s;
      const err = await wa.sendText('+6281', 't', 'k1').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(WaPermanentError);
    }
  });

  it('ensureSetup membuat sesi, start, dan webhook bila belum ada (idempoten)', async () => {
    const sessions: Array<typeof SESSION> = [];
    const hooks: Array<{ id: string; url: string }> = [];
    const { fn, calls } = fakeFetch({
      'GET /api/sessions': () => [200, sessions],
      'POST /api/sessions': () => {
        const s = { ...SESSION, status: 'created' };
        sessions.push(s);
        return [201, s];
      },
      [`POST /api/sessions/${SESSION.id}/start`]: () => [200, {}],
      [`GET /api/sessions/${SESSION.id}/webhooks`]: () => [200, hooks],
      [`POST /api/sessions/${SESSION.id}/webhooks`]: (init) => {
        const b = JSON.parse(String(init.body)) as {
          url: string;
          secret: string;
          events: string[];
        };
        expect(b.events).toEqual(['message.received', 'session.status']);
        expect(b.secret).toBe('rahasia-webhook-0123');
        hooks.push({ id: 'h1', url: b.url });
        return [201, { id: 'h1' }];
      },
    });
    const wa = new OpenWAProvider({
      baseUrl: 'http://o',
      apiKey: 'k',
      sessionName: 'rein',
      fetch: fn,
    });
    await wa.ensureSetup('http://app:3000/webhooks/openwa', 'rahasia-webhook-0123');
    await wa.ensureSetup('http://app:3000/webhooks/openwa', 'rahasia-webhook-0123');
    const posts = calls.filter((c) => c.init.method === 'POST').map((c) => new URL(c.url).pathname);
    expect(posts.filter((p) => p === '/api/sessions')).toHaveLength(1);
    expect(posts.filter((p) => p.endsWith('/webhooks'))).toHaveLength(1);
  });
});
