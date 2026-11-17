import type { Logger } from 'pino';
import type { Env } from '../env';
import { GmailApiProvider } from './gmail';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Header tambahan, mis. List-Unsubscribe untuk notifikasi. */
  headers?: Record<string, string>;
}

export interface MailProvider {
  readonly name: string;
  send(message: MailMessage): Promise<{ id: string }>;
}

/** Dev/test: tidak mengirim apa pun, hanya mencatat ke log dan menyimpan di `outbox`. */
export class NullProvider implements MailProvider {
  readonly name = 'null';
  readonly outbox: MailMessage[] = [];

  constructor(private readonly logger?: Logger) {}

  async send(message: MailMessage): Promise<{ id: string }> {
    this.outbox.push(message);
    if (this.outbox.length > 200) this.outbox.shift();
    this.logger?.info(
      { to: message.to, subject: message.subject, text: message.text },
      'mail (NullProvider) — tidak dikirim',
    );
    return { id: `null-${this.outbox.length}` };
  }
}

export function createMailProvider(env: Env, logger: Logger): MailProvider {
  if (env.MAIL_PROVIDER === 'gmail') {
    return new GmailApiProvider({
      clientId: env.GOOGLE_OAUTH_CLIENT_ID!,
      clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET!,
      refreshToken: env.GMAIL_REFRESH_TOKEN!,
      sender: env.GMAIL_SENDER,
      senderName: env.GMAIL_SENDER_NAME,
    });
  }
  return new NullProvider(logger);
}
