# ── Stage 1: install dependencies ───────────────────────────────────────────
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── Stage 2: build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* vars are baked into the client JS bundle at build time.
# They MUST be supplied here — runtime injection does not affect the client.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_TELEGRAM_BOT_ID
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_TELEGRAM_BOT_ID=$NEXT_PUBLIC_TELEGRAM_BOT_ID
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL

# /api/leaderboard uses `revalidate`, so it is statically generated at build
# time and needs the service-role key available during `next build`, not
# just at runtime.
ARG SUPABASE_SERVICE_ROLE_KEY
ENV SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY

RUN npm run build

# ── Stage 3: migrator ────────────────────────────────────────────────────────
# Runs Drizzle Kit (generate/migrate/push/studio) against Postgres. Extends
# `builder` directly — same node_modules (devDependencies included, so
# drizzle-kit is present) and full source (drizzle.config.ts, lib/db/), no
# separate install step. Placed BEFORE `runner` so `runner` stays the last
# stage — docker-compose.yml's `app` service has no explicit `target:` and
# must keep resolving to `runner` by default. Never built as part of the
# default `docker build` (last stage) and never referenced by it — only
# reachable via `docker compose -f docker-compose.postgres.yml run --rm
# migrator ...`, so it has zero effect on the production app image.
FROM builder AS migrator
CMD ["npm", "run", "db:migrate"]

# ── Stage 4: production runner ───────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Public assets
COPY --from=builder /app/public ./public

# Next.js standalone output: when WORKDIR is /app the basename is "app", so
# the standalone server lands at .next/standalone/app/ — copy that directory
# directly into /app so server.js sits at the container root.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./

# Client-side static assets must be at .next/static/ relative to server.js
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
