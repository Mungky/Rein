import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import pino from 'pino';
import { createApp } from '../src/app';
import type { GoogleOidc } from '../src/auth/google';
import { hashSecret } from '../src/auth/password';
import type { Deps } from '../src/context';
import { createDb, type Db } from '../src/db/client';
import { roles, userContacts, users } from '../src/db/schema';
import { loadEnv, type Env } from '../src/env';
import { FixedWindowLimiter } from '../src/lib/rate-limit';
import { NullProvider } from '../src/mail/provider';
import { LocalDriver } from '../src/storage/local';
import { NullWhatsApp } from '../src/wa/provider';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const hasDb = Boolean(process.env.DATABASE_URL_TEST);
export const PEPPER = 'test-pepper-test-pepper-test-pepper-0123456789';

export function testEnv(overrides: Record<string, string> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.DATABASE_URL_TEST ?? 'postgres://unused',
    AUTH_PEPPER: PEPPER,
    APP_URL: 'http://localhost:5173',
    TRUST_PROXY: 'true',
    LOG_LEVEL: 'silent',
    ...overrides,
  });
}

let shared: { db: Db; end: () => Promise<void> } | null = null;
export function testDb(): Db {
  if (!shared) {
    const { db, pool } = createDb(process.env.DATABASE_URL_TEST!);
    shared = { db, end: () => pool.end() };
  }
  return shared.db;
}
export async function closeTestDb() {
  await shared?.end();
  shared = null;
}

export const storageRoot = path.join(tmpdir(), `rein-test-storage-${process.pid}`);

export function makeApp(
  opts: { google?: GoogleOidc | null; env?: Record<string, string>; uploadMaxBytes?: number } = {},
) {
  const mail = new NullProvider();
  const wa = new NullWhatsApp();
  const deps: Deps = {
    db: testDb(),
    env: testEnv(opts.env),
    logger: pino({ level: 'silent' }),
    mail,
    storage: new LocalDriver(storageRoot),
    wa,
    uploadMaxBytes: opts.uploadMaxBytes ?? 50 * 1024 * 1024,
    google: opts.google ?? null,
    limits: {
      loginIp: new FixedWindowLimiter(30, 15 * 60_000),
      emailSend: new FixedWindowLimiter(5, 60 * 60_000),
      waStart: new FixedWindowLimiter(5, 24 * 60 * 60_000),
      pinUnlock: new FixedWindowLimiter(20, 15 * 60_000),
    },
    webDist: null,
  };
  return { app: createApp(deps), mail, wa, deps };
}

export const uniq = () => randomUUID().slice(0, 8);

export async function roleId(systemKey: string): Promise<string> {
  const r = await testDb().query.roles.findFirst({ where: eq(roles.systemKey, systemKey) });
  if (!r) throw new Error(`role ${systemKey} tidak ada — global setup gagal?`);
  return r.id;
}

/** Buat user langsung di DB. Default: aktif, email terverifikasi. */
export async function createUser(
  opts: {
    role?: string;
    password?: string | null;
    verified?: boolean;
    status?: 'invited' | 'active' | 'disabled';
  } = {},
) {
  const db = testDb();
  const id = uniq();
  const username = `u${id}`;
  const email = `${username}@remula.test`;
  const password = opts.password === undefined ? `Rahasia-${id}-panjang` : opts.password;
  const [u] = await db
    .insert(users)
    .values({
      username,
      fullName: `User ${id}`,
      roleId: await roleId(opts.role ?? 'engineering'),
      status: opts.status ?? 'active',
      passwordHash: password ? await hashSecret(password, PEPPER) : null,
    })
    .returning({ id: users.id });
  await db.insert(userContacts).values({
    userId: u!.id,
    kind: 'email',
    value: email,
    isPrimary: true,
    verifiedAt: opts.verified === false ? null : new Date(),
  });
  return { id: u!.id, username, email, password };
}

type App = ReturnType<typeof makeApp>['app'];

/** Klien HTTP sederhana dengan cookie jar untuk app.request(). */
export function agent(
  app: App,
  ip = `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
) {
  const jar = new Map<string, string>();
  async function req(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<Response> {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await app.request(path, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-requested-with': 'rein',
        'x-forwarded-for': ip,
        'user-agent': 'vitest',
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const sc of res.headers.getSetCookie()) {
      const [pair, ...attrs] = sc.split(';');
      const [name, ...rest] = pair!.split('=');
      const value = rest.join('=');
      const expired = attrs.some((a) => /max-age=0/i.test(a.trim())) || value === '';
      if (expired) jar.delete(name!.trim());
      else jar.set(name!.trim(), value);
    }
    return res;
  }
  return {
    jar,
    get: (p: string, h?: Record<string, string>) => req('GET', p, undefined, h),
    post: (p: string, b?: unknown, h?: Record<string, string>) => req('POST', p, b ?? {}, h),
  };
}

export async function login(app: App, identifier: string, password: string, extra = {}) {
  const a = agent(app);
  const res = await a.post('/api/auth/login', { identifier, password, ...extra });
  return { a, res };
}
