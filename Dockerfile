# ─────────────────────────────────────────────────────────────────────────
# PostGo — Dockerfile for Coolify / Docker-compatible hosts
# Multi-stage build, produces a slim Node.js runtime (~200 MB).
# Uses Next.js standalone output mode.
#
# Architecture: PostgreSQL + Redis + BullMQ
# Default port: 3001 (matches Coolify + local dev port)
# ─────────────────────────────────────────────────────────────────────────

# ---- Stage 1: deps -------------------------------------------------------
FROM node:22-slim AS deps

WORKDIR /app

# OpenSSL is required by Prisma engines on debian-slim.
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY prisma ./prisma

# Use npm ci (lockfile-driven, reproducible). Falls back to npm install
# if no lockfile is present.
#
# NOTE: do NOT add --omit=optional here. Tailwind v4's @tailwindcss/postcss
# depends on lightningcss, whose platform-specific native binary
# (lightningcss-linux-x64-gnu) ships as an npm *optionalDependency*.
# --omit=optional skips it, and `npm run build` then crashes with
# "Cannot find module .../lightningcss/node/index.js". Same applies to
# sharp's native binary. Keep optional deps installed.
RUN if [ -f package-lock.json ]; then \
      npm ci; \
    else \
      npm install; \
    fi

# Generate Prisma client (postinstall hook would do this, but be explicit).
RUN npx prisma generate

# ---- Stage 2: build ------------------------------------------------------
FROM node:22-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY . .

# Build-time env vars (public vars are inlined into the client bundle).
ARG NEXT_PUBLIC_USDT_WALLET_ADDRESS
ENV NEXT_PUBLIC_USDT_WALLET_ADDRESS=$NEXT_PUBLIC_USDT_WALLET_ADDRESS

# Next.js standalone build.
RUN npm run build

# ---- Stage 3: runtime (Web) ----------------------------------------------
FROM node:22-slim AS runner

WORKDIR /app

# Minimal runtime dependencies.
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

# Copy the standalone server bundle, static assets, and public dir.
# IMPORTANT: after `COPY --from=builder /app/.next/standalone ./`,
# the standalone server.js lives at /app/server.js — NOT at
# /app/.next/standalone/server.js. The CMD below must use `server.js`.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/src ./src
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json

# Make start.sh executable and ensure it is owned by nextjs.
COPY --chown=nextjs:nodejs scripts/start.sh ./scripts/start.sh
RUN chmod +x ./scripts/start.sh

# Switch to non-root user.
USER nextjs

ENV NODE_ENV=production
# Port 3001 — matches the free Coolify port and local dev port.
ENV PORT=3001
ENV HOSTNAME=0.0.0.0

# Database URL will be set via docker-compose or Coolify environment variables.
# Default is placeholder — MUST be overridden in deployment.
ENV DATABASE_URL=postgresql://postgo:postgo_secret@postgres:5432/postgo
ENV REDIS_URL=redis://redis:6379/0

EXPOSE 3001

# Coolify / Docker health check — must reference port 3001.
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3001/api/health || exit 1

# Container entrypoint:
#   1. prisma db push (apply schema)
#   2. seed admin user (if ADMIN_EMAIL/ADMIN_PASSWORD set)
#   3. exec node server.js (Next.js standalone)
#
# The worker is NOT started here — it runs as a separate docker-compose
# service (replicas: 3) using `npm run worker`.
ENTRYPOINT ["./scripts/start.sh"]
