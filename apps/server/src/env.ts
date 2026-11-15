import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    APP_URL: z.url().default('http://localhost:5173'),
    LOG_LEVEL: z.string().default('info'),
    TRUST_PROXY: bool.default(false),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL wajib diisi'),

    AUTH_PEPPER: z.string().min(32, 'AUTH_PEPPER minimal 32 karakter'),

    GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
    GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
    GOOGLE_OAUTH_REDIRECT_URI: z.url().default('http://localhost:3000/auth/google/callback'),

    MAIL_PROVIDER: z.enum(['gmail', 'null']).default('null'),
    GMAIL_SENDER: z.string().default('notifikasi@remula.co.id'),
    GMAIL_SENDER_NAME: z.string().default('REIN'),
    GMAIL_REFRESH_TOKEN: z.string().optional(),

    STORAGE_DRIVER: z.enum(['local', 'gcs']).default('local'),
    LOCAL_STORAGE_DIR: z.string().default('.data/storage'),
    GCS_BUCKET: z.string().optional(),
    GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),

    OPENWA_URL: z.string().optional(),
    OPENWA_API_KEY: z.string().optional(),
    OPENWA_SESSION_ID: z.string().default('rein'),
    OPENWA_WEBHOOK_SECRET: z.string().optional(),
    REIN_WA_NUMBER: z.string().optional(),

    /** Lokasi hasil build SPA yang disajikan server. */
    WEB_DIST_DIR: z.string().optional(),
  })
  .superRefine((e, ctx) => {
    if (e.MAIL_PROVIDER === 'gmail') {
      const keys = ['GMAIL_REFRESH_TOKEN', 'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'];
      for (const k of keys as Array<keyof typeof e>) {
        if (!e[k]) {
          ctx.addIssue({ code: 'custom', path: [k], message: `wajib untuk MAIL_PROVIDER=gmail` });
        }
      }
    }
    if (e.STORAGE_DRIVER === 'gcs' && !e.GCS_BUCKET) {
      ctx.addIssue({
        code: 'custom',
        path: ['GCS_BUCKET'],
        message: 'wajib untuk STORAGE_DRIVER=gcs',
      });
    }
    if (e.NODE_ENV === 'production' && !e.APP_URL.startsWith('https://')) {
      ctx.addIssue({ code: 'custom', path: ['APP_URL'], message: 'APP_URL produksi wajib https' });
    }
  });

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Nilai kosong (`KEY=`) dianggap tidak diisi. */
function cleaned(source: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) if (v !== undefined && v !== '') out[k] = v;
  return out;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(cleaned(source));
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Konfigurasi env tidak valid:\n${lines.join('\n')}`);
  }
  return parsed.data;
}

export function env(): Env {
  cached ??= loadEnv();
  return cached;
}

/** Hanya untuk test. */
export function setEnvForTest(value: Env | undefined): void {
  cached = value;
}

export const googleLoginEnabled = (e: Env): boolean =>
  Boolean(e.GOOGLE_OAUTH_CLIENT_ID && e.GOOGLE_OAUTH_CLIENT_SECRET);

export const isSecureCookie = (e: Env): boolean => e.APP_URL.startsWith('https://');
