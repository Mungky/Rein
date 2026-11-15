import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import pino from 'pino';
import { createApp } from './app';
import { createGoogleOidc } from './auth/google';
import type { Deps } from './context';
import { closeDb, getDb } from './db/client';
import { runMigrations } from './db/migrate';
import { env, googleLoginEnabled } from './env';
import { FixedWindowLimiter } from './lib/rate-limit';
import { createMailProvider } from './mail/provider';

const MINUTE = 60_000;
const e = env();
const logger = pino({ level: e.LOG_LEVEL, base: { app: 'rein' } });

// PRD §11.2: migrasi otomatis saat start di produksi.
if (e.NODE_ENV === 'production' || process.env.MIGRATE_ON_START === 'true') {
  await runMigrations(e.DATABASE_URL);
  logger.info('migrasi database selesai');
}

function resolveWebDist(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    e.WEB_DIST_DIR,
    path.resolve(here, '../../web/build'),
    path.resolve(here, '../web'),
  ].filter((p): p is string => Boolean(p));
  return candidates.find((p) => existsSync(path.join(p, 'index.html'))) ?? null;
}

const deps: Deps = {
  db: getDb(),
  env: e,
  logger,
  mail: createMailProvider(e, logger),
  google: googleLoginEnabled(e)
    ? createGoogleOidc({
        clientId: e.GOOGLE_OAUTH_CLIENT_ID!,
        clientSecret: e.GOOGLE_OAUTH_CLIENT_SECRET!,
        redirectUri: e.GOOGLE_OAUTH_REDIRECT_URI,
      })
    : null,
  limits: {
    loginIp: new FixedWindowLimiter(30, 15 * MINUTE, 15 * MINUTE),
    emailSend: new FixedWindowLimiter(5, 60 * MINUTE),
  },
  webDist: e.NODE_ENV === 'development' && !e.WEB_DIST_DIR ? null : resolveWebDist(),
};

const app = createApp(deps);
const server = serve({ fetch: app.fetch, port: e.PORT }, (info) => {
  logger.info(
    { port: info.port, mail: deps.mail.name, google: Boolean(deps.google), spa: deps.webDist },
    'REIN server berjalan',
  );
});

async function shutdown(signal: string) {
  logger.info({ signal }, 'mematikan server');
  server.close();
  await closeDb();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
