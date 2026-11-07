FROM oven/bun:1 AS builder
WORKDIR /app

# Install dependencies with frozen lockfile
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source and build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV BACKEND_URL=http://backend:8000
RUN bun run build

FROM oven/bun:1-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV BACKEND_URL=http://backend:8000

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public

EXPOSE 3000
CMD ["bun", "run", "start"]
