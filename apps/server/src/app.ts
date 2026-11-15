import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { sessionMiddleware } from './auth/middleware';
import type { AppEnv, Deps } from './context';
import { isSecureCookie } from './env';
import { HttpError } from './lib/http';
import { clientIp } from './lib/ip';
import { adminUserRoutes } from './routes/admin-users';
import { authRoutes } from './routes/auth';
import { googleRoutes } from './routes/google';
import { healthRoutes } from './routes/health';
import { csrfGuard, securityHeaders } from './security';
import { mountSpa } from './static';

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

  app.use('/api/*', csrfGuard);
  app.use(
    '/api/*',
    bodyLimit({
      maxSize: JSON_LIMIT,
      onError: () => {
        throw new HttpError(413, 'TOO_LARGE', 'Permintaan terlalu besar');
      },
    }),
  );
  app.use('/api/*', sessionMiddleware);

  app.route('/api/auth', authRoutes);
  app.route('/api/admin', adminUserRoutes);
  app.route('/auth/google', googleRoutes);

  app.notFound((c) =>
    c.json({ error: { code: 'NOT_FOUND', message: 'Endpoint tidak ditemukan' } }, 404),
  );

  if (deps.webDist) mountSpa(app, deps.webDist);
  return app;
}
