import { randomUUID } from 'node:crypto';
import type { MailMessage, MailProvider } from './provider';

/**
 * Kirim email lewat Gmail API (`users.messages.send`, scope gmail.send) dari akun pengirim khusus.
 * Refresh token diambil sekali lewat `pnpm gmail:token`.
 */
export interface GmailConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  sender: string;
  senderName: string;
  fetch?: typeof fetch;
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

export class GmailApiProvider implements MailProvider {
  readonly name = 'gmail';
  private accessToken: { value: string; expiresAt: number } | null = null;
  private readonly http: typeof fetch;

  constructor(private readonly cfg: GmailConfig) {
    this.http = cfg.fetch ?? fetch;
  }

  private async token(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60_000) {
      return this.accessToken.value;
    }
    const res = await this.http(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        refresh_token: this.cfg.refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) throw new Error(`Gmail token gagal: HTTP ${res.status}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.accessToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return json.access_token;
  }

  async send(message: MailMessage): Promise<{ id: string }> {
    const raw = Buffer.from(buildMime(this.cfg.sender, this.cfg.senderName, message)).toString(
      'base64url',
    );
    const res = await this.http(SEND_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await this.token()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    });
    if (!res.ok) throw new Error(`Gmail send gagal: HTTP ${res.status}`);
    const json = (await res.json()) as { id: string };
    return { id: json.id };
  }
}

/** RFC 2047 untuk header non-ASCII. */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex -- deteksi karakter non-ASCII
  return /^[\x00-\x7F]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function stripCrlf(value: string): string {
  return value.replace(/[\r\n]+/g, ' ');
}

export function buildMime(sender: string, senderName: string, m: MailMessage): string {
  const boundary = `rein-${randomUUID()}`;
  const domain = sender.split('@')[1] ?? 'rein.local';
  const headers: Record<string, string> = {
    From: `${encodeHeader(stripCrlf(senderName))} <${stripCrlf(sender)}>`,
    To: stripCrlf(m.to),
    Subject: encodeHeader(stripCrlf(m.subject)),
    'MIME-Version': '1.0',
    Date: new Date().toUTCString(),
    'Message-ID': `<${randomUUID()}@${domain}>`,
    'Content-Type': `multipart/alternative; boundary="${boundary}"`,
    ...Object.fromEntries(
      Object.entries(m.headers ?? {}).map(([k, v]) => [stripCrlf(k), stripCrlf(v)]),
    ),
  };
  const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  return [
    ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    b64(m.text),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    b64(m.html),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}
