/**
 * Kanal WhatsApp di balik interface (PRD §10.4): logika notifikasi tidak tahu gateway apa yang
 * dipakai. `OpenWAProvider` (self-host, engine baileys) untuk produksi, `NullWhatsApp` untuk
 * dev/test. Pindah ke Cloud API resmi = tambah adapter baru, tanpa mengubah notifikasi.
 */
import type { Logger } from 'pino';
import { waProviderOf, type Env } from '../env';

export class WaPermanentError extends Error {}

/**
 * Status sesi OpenWA (nilai wire, huruf kecil): created | initializing | qr_ready |
 * authenticating | ready | disconnected | action_required | failed. Hanya `ready` yang bisa kirim.
 */
export const WA_READY = 'ready';

export interface WaSessionInfo {
  id: string | null;
  status: string;
  phone?: string | null;
}

export interface WhatsAppProvider {
  readonly name: 'openwa' | 'null';
  /** `to` = E.164 (`+62…`). `key` = kunci idempotensi (id delivery). */
  sendText(to: string, text: string, key: string): Promise<{ id: string }>;
  session(): Promise<WaSessionInfo>;
  /** PNG data URL untuk dipindai Admin, atau null bila tidak perlu/tersedia. */
  qr(): Promise<string | null>;
  /** Buat sesi & webhook bila belum ada (idempoten). */
  ensureSetup(webhookUrl: string, secret: string): Promise<WaSessionInfo>;
}

export class NullWhatsApp implements WhatsAppProvider {
  readonly name = 'null' as const;
  readonly outbox: Array<{ to: string; text: string; key: string }> = [];
  constructor(private readonly logger?: Logger) {}
  async sendText(to: string, text: string, key: string) {
    this.outbox.push({ to, text, key });
    if (this.outbox.length > 200) this.outbox.shift();
    this.logger?.info({ to }, 'whatsapp (NullWhatsApp) — tidak dikirim');
    return { id: `null-${key}` };
  }
  async session(): Promise<WaSessionInfo> {
    return { id: null, status: 'disabled' };
  }
  async qr() {
    return null;
  }
  async ensureSetup() {
    return this.session();
  }
}

export interface OpenWAConfig {
  baseUrl: string;
  apiKey: string;
  sessionName: string;
  fetch?: typeof fetch;
}

interface SessionRow {
  id: string;
  name: string;
  status: string;
  phone?: string;
}

/**
 * Klien OpenWA (`/api/sessions…`, list = array polos, kirim → `{messageId}`).
 * Dipanggil hanya lewat jaringan internal Docker.
 */
export class OpenWAProvider implements WhatsAppProvider {
  readonly name = 'openwa' as const;
  private sessionId: string | null = null;
  private readonly http: typeof fetch;

  constructor(private readonly cfg: OpenWAConfig) {
    this.http = cfg.fetch ?? fetch;
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.http(`${this.cfg.baseUrl.replace(/\/$/, '')}${path}`, {
      ...init,
      headers: {
        'x-api-key': this.cfg.apiKey,
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...((init.headers as Record<string, string>) ?? {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    if (!res.ok) {
      const msg = `OpenWA ${init.method ?? 'GET'} ${path}: HTTP ${res.status} ${text.slice(0, 200)}`;
      // 4xx tidak akan berhasil bila diulang (nomor tidak valid, dsb.), kecuali 408/429 dan
      // 409 (OpenWA: "session not connected" — sesi belum `ready`).
      if (res.status >= 400 && res.status < 500 && ![408, 409, 429].includes(res.status)) {
        throw new WaPermanentError(msg);
      }
      throw new Error(msg);
    }
    return (text ? JSON.parse(text) : null) as T;
  }

  private async findSession(): Promise<SessionRow | null> {
    const list = await this.call<SessionRow[] | { data?: SessionRow[] }>('/api/sessions');
    const items = Array.isArray(list) ? list : (list?.data ?? []);
    const s = items.find((x) => x.name === this.cfg.sessionName) ?? null;
    if (s) this.sessionId = s.id;
    return s;
  }

  private async id(): Promise<string> {
    if (this.sessionId) return this.sessionId;
    const s = await this.findSession();
    if (!s) throw new Error(`Sesi OpenWA "${this.cfg.sessionName}" belum dibuat`);
    return s.id;
  }

  async sendText(to: string, text: string, key: string) {
    const digits = to.replace(/\D/g, '');
    const res = await this.call<{ id?: string; messageId?: string }>(
      `/api/sessions/${await this.id()}/messages/send-text`,
      {
        method: 'POST',
        headers: { 'idempotency-key': key },
        body: JSON.stringify({ chatId: `${digits}@c.us`, text, linkPreview: false }),
      },
    );
    return { id: res?.messageId ?? res?.id ?? key };
  }

  async session(): Promise<WaSessionInfo> {
    const s = await this.findSession();
    return s
      ? { id: s.id, status: s.status, phone: s.phone ?? null }
      : { id: null, status: 'missing' };
  }

  async qr(): Promise<string | null> {
    try {
      const r = await this.call<{ qrCode?: string }>(`/api/sessions/${await this.id()}/qr`);
      return r?.qrCode ?? null;
    } catch {
      return null;
    }
  }

  async ensureSetup(webhookUrl: string, secret: string): Promise<WaSessionInfo> {
    let s = await this.findSession();
    if (!s) {
      const created = await this.call<SessionRow>('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({ name: this.cfg.sessionName }),
      });
      this.sessionId = created.id;
      s = created;
    }
    if (['created', 'disconnected', 'failed'].includes(s.status.toLowerCase())) {
      await this.call(`/api/sessions/${s.id}/start`, { method: 'POST' }).catch(() => null);
    }
    const hooks = await this.call<Array<{ id: string; url: string }>>(
      `/api/sessions/${s.id}/webhooks`,
    ).catch(() => [] as Array<{ id: string; url: string }>);
    if (!(hooks ?? []).some((h) => h.url === webhookUrl)) {
      await this.call(`/api/sessions/${s.id}/webhooks`, {
        method: 'POST',
        body: JSON.stringify({
          url: webhookUrl,
          events: ['message.received', 'session.status'],
          secret,
          retryCount: 3,
        }),
      });
    }
    return this.session();
  }
}

export function createWhatsApp(e: Env, logger: Logger): WhatsAppProvider {
  if (waProviderOf(e) === 'openwa') {
    return new OpenWAProvider({
      baseUrl: e.OPENWA_URL!,
      apiKey: e.OPENWA_API_KEY!,
      sessionName: e.OPENWA_SESSION_ID,
    });
  }
  return new NullWhatsApp(logger);
}
