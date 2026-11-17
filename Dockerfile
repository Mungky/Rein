# syntax=docker/dockerfile:1.7
# Image produksi REIN: satu proses Node 22 (Hono) menyajikan API + SPA statis. Non-root.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
COPY packages/ui-tokens/package.json packages/ui-tokens/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @rein/web build && pnpm --filter @rein/server build
# Paket server mandiri dengan dependensi produksi saja (paket workspace sudah di-bundle tsup).
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @rein/server deploy --prod --legacy /out

FROM node:22-alpine AS runtime
RUN apk add --no-cache tini tzdata
ENV NODE_ENV=production \
    PORT=3000 \
    TZ=Asia/Jakarta \
    WEB_DIST_DIR=/app/web
WORKDIR /app
COPY --from=build --chown=node:node /out/package.json ./package.json
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/dist ./dist
COPY --from=build --chown=node:node /out/drizzle ./drizzle
COPY --from=build --chown=node:node /repo/apps/web/build ./web
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
# Migrasi database berjalan otomatis saat start (PRD §11.2).
CMD ["node", "dist/index.js"]
