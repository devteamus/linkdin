#!/usr/bin/env sh
# PostGo container entrypoint (Web Service).
#
# Processes:
#   1. Apply Prisma schema (db push)
#   2. Seed admin user (idempotent — only runs if ADMIN_EMAIL / ADMIN_PASSWORD set)
#   3. Start Next.js standalone server (PID 1, port $PORT)
#
# The worker is NOT started here — it runs as a separate docker-compose
# service (replicas: 3) using `npm run worker`. To start a worker inside
# the web container (single-container mode), set RUN_WORKER_IN_WEB=true.
#
# Runs as the non-root `nextjs` user inside the container (see Dockerfile).

set -e

echo "[entrypoint] PostGo starting up"
echo "[entrypoint] Architecture: PostgreSQL + Redis + BullMQ"
echo "[entrypoint] Node version: $(node -v)"
echo "[entrypoint] Working dir:  $(pwd)"
echo "[entrypoint] PORT:         ${PORT:-3001}"

# ─── Database Schema Migration ──────────────────────────────────────
echo "[entrypoint] applying prisma schema (db push)..."
node ./node_modules/prisma/build/index.js db push --skip-generate --accept-data-loss 2>&1 | sed 's/^/[prisma] /' || {
  echo "[entrypoint] WARNING: prisma db push failed — database may need manual migration."
}

# ─── Admin Seed ─────────────────────────────────────────────────────
# Idempotent — only creates admin if ADMIN_EMAIL/ADMIN_PASSWORD env vars
# are set AND no admin exists yet. Safe to run on every container start.
echo "[entrypoint] seeding admin (if env vars set)..."
(node ./node_modules/tsx/dist/cli.mjs prisma/seed.ts 2>&1 | sed 's/^/[seed] /') || echo "[seed] skipped (error non-fatal)"

# ─── Optional: Start Worker in Same Container ───────────────────────
# In Docker Compose, the worker runs as a separate service.
# This section is only for single-container deployments.
if [ "${RUN_WORKER_IN_WEB}" = "true" ]; then
  echo "[entrypoint] starting BullMQ worker in same container..."

  # Check if Redis URL is set
  if [ -z "$REDIS_URL" ]; then
    echo "[entrypoint] ERROR: REDIS_URL required when RUN_WORKER_IN_WEB=true"
    exit 1
  fi

  npm run worker &
  WORKER_PID=$!
  echo "[entrypoint] worker started with PID: $WORKER_PID"

  # Make sure worker dies when the web process exits
  trap "kill $WORKER_PID 2>/dev/null || true" EXIT INT TERM
fi

# ─── Start Next.js Server ───────────────────────────────────────────
# This is the main process — its PID will be PID 1.
# Next.js standalone server.js lives at /app/server.js (copied from
# .next/standalone/ by the Dockerfile).
echo "[entrypoint] starting Next.js server on port ${PORT:-3001}..."
exec node server.js
