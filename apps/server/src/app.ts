import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { sessionMiddleware } from './auth/middleware';
import type { AppEnv, Deps } from './context';
import { isSecureCookie } from './env';
import { HttpError } from './lib/http';
import { clientIp } from './lib/ip';
import { adminSettingsRoutes } from './routes/admin-settings';
import { activityRoutes } from './routes/activity';
import { adminUserRoutes } from './routes/admin-users';
import { userAccessRoutes } from './routes/user-access';
import { preferenceRoutes } from './routes/preferences';
import { attachmentRoutes } from './routes/attachments';
import { devRoutes } from './routes/dev';
import { fileRoutes } from './routes/files';
import { meRoutes } from './routes/me';
import { materialRoutes } from './routes/materials';
import { pinRoutes } from './routes/pin';
import { notificationRoutes, streamRoutes } from './routes/notifications';
import { directoryRoutes, projectRoutes } from './routes/projects';
import { homeRoutes, projectWoRoutes, woRoutes } from './routes/work-orders';
import { authRoutes } from './routes/auth';
import { googleRoutes } from './routes/google';
import { healthRoutes } from './routes/health';
import { csrfGuard, securityHeaders } from './security';
import { mountSpa } from './static';
import { webhookRoutes } from './routes/webhooks';

const JSON_LIMIT = 64 * 1024;

export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    c.set('deps', deps);
    c.set('ip', clientIp(c, deps.env.TRUST_PROXY));
    await next();
  });
  app.use('*', securityHeaders({ https: isSecureCookie(deps.env) }));

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json(
        {
          error: {
            code: err.code,
            message: err.message,
            ...(err.fields ? { fields: err.fields } : {}),
          },
        },
        err.status,
        err.headers,
      );
    }
    deps.logger.error({ err, path: c.req.path }, 'unhandled error');
    return c.json({ error: { code: 'INTERNAL', message: 'Terjadi kesalahan di server' } }, 500);
  });

  app.route('/', healthRoutes);
  // Webhook dari OpenWA (HMAC, tanpa sesi/CSRF) — sebelum middleware /api/*.
  app.route('/webhooks', webhookRoutes);

  app.use('/api/*', csrfGuard);
  const jsonLimit = bodyLimit({
    maxSize: JSON_LIMIT,
    onError: () => {
      throw new HttpError(413, 'TOO_LARGE', 'Permintaan terlalu besar');
    },
  });
  // Upload lampiran di-stream (batas sendiri per file); endpoint lain JSON ≤ 64 KB.
  app.use('/api/*', (c, next) =>
    c.req.path.startsWith('/api/attachments')
      ? next()
      : /^\/api\/projects\/[^/]+\/materials$/.test(c.req.path) && c.req.method === 'POST'
        ? bodyLimit({
            maxSize: 2 * 1024 * 1024,
            onError: () => {
              throw new HttpError(413, 'TOO_LARGE', 'Daftar material terlalu besar');
            },
          })(c, next)
        : jsonLimit(c, next),
  );
  app.use('/api/*', sessionMiddleware);
  app.use('/files/*', sessionMiddleware);

  app.route('/api/auth/pin', pinRoutes);
  app.route('/api/auth', authRoutes);
  app.route('/api/admin', adminUserRoutes);
  app.route('/api/admin', adminSettingsRoutes);
  app.route('/api/admin', userAccessRoutes);
  app.route('/api', preferenceRoutes);
  app.route('/api/attachments', attachmentRoutes);
  app.route('/api/me', meRoutes);
  app.route('/api/projects', projectRoutes);
  app.route('/api/projects', materialRoutes);
  app.route('/api/directory', directoryRoutes);
  app.route('/api/projects', projectWoRoutes);
  app.route('/api/work-orders', woRoutes);
  app.route('/api/home', homeRoutes);
  app.route('/api/activity', activityRoutes);
  app.route('/api/notifications', notificationRoutes);
  app.route('/api/stream', streamRoutes);
  app.route('/files', fileRoutes);
  // Alat bantu dev/test — tidak pernah dipasang di produksi.
  if (deps.env.NODE_ENV !== 'production') app.route('/api/dev', devRoutes);
  app.route('/auth/google', googleRoutes);

  app.notFound((c) =>
    c.json({ error: { code: 'NOT_FOUND', message: 'Endpoint tidak ditemukan' } }, 404),
  );

  if (deps.webDist) mountSpa(app, deps.webDist);
  return app;
}
