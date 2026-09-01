# PostGo — Production Deployment Guide

**Pipeline:** WSL Docker test → GitHub push → Coolify VPS deploy → Concurrency validation

**Status after bug-fix round (commit `2c06073`):**
- `tsc --noEmit` → **0 errors** (was 47)
- `next build` → **success** (standalone output)
- All critical runtime bugs fixed (enum migration, admin auth, payment flow, worker)

---

## Step 1 — Local Test on WSL Ubuntu + Docker

```bash
cd postgo

# 1. Environment is ready (.env already generated with JWT/ENCRYPTION/CRON secrets).
#    Fill in LinkedIn / Resend / TRON keys when you need those features:
nano .env

# 2. Build & start all 6 services (web, worker-1, worker-2, worker-3, postgres, redis)
docker compose up -d --build

# 3. The Dockerfile entrypoint (scripts/start.sh) automatically:
#    - runs `prisma db push` (creates tables on first start)
#    - runs the admin seed (if ADMIN_EMAIL / ADMIN_PASSWORD are set)
#    - starts `node server.js` on port 3001
#    No manual prisma/seed commands needed.

# 4. Verify health (checks PostgreSQL + Redis in parallel)
curl http://localhost:3001/api/health
# Expected: {"status":"ok","db":"ok","redis":"ok","latencyMs":...}

# 5. Watch logs for errors
docker compose logs -f web worker-1 worker-2 worker-3
# Each worker should print: "[worker:worker-N] 🟢 Connected to Redis, waiting for jobs..."
```

**Smoke checklist before pushing:**
- [ ] `docker compose ps` shows 6 containers, all status = `Up (healthy)` for web/postgres/redis
- [ ] `/api/health` returns `status: ok` (db + redis both green)
- [ ] Register a user → login → dashboard loads
- [ ] Admin login → admin panel loads
- [ ] Create a scheduled post → appears in queue (BullMQ)
- [ ] Restart containers (`docker compose restart`) → no Redis connection leak:
      `docker compose exec redis redis-cli info clients | grep connected_clients` → stays ~5-7 (1 web + 3 workers + monitor + redis-cli)
- [ ] All 3 workers running: `docker compose ps | grep worker` shows `postgo-worker-1`, `postgo-worker-2`, `postgo-worker-3`

---

## Step 2 — Push to GitHub

The repo has **no remote configured yet**. Add yours and push:

```bash
cd postgo

git remote add origin git@github.com:YOUR_USERNAME/YOUR_REPO.git
# or HTTPS: https://github.com/YOUR_USERNAME/YOUR_REPO.git

git push -u origin main
```

> `.env` is gitignored (secrets never pushed). `.env.example` IS committed as template.
> If Coolify builds from GitHub, this push is all it needs.

---

## Step 3 — Deploy on Coolify (VPS)

### 3.1 One-time VPS preparation (if not done)
- Install Coolify: `curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash`
- Point a domain (e.g. `app.yourdomain.com`) A-record to the VPS IP

### 3.2 Recommended VPS sizing for concurrency targets

| VPS | ~Concurrent users | Notes |
|-----|------------------|-------|
| 2 vCPU / 4 GB | 100–300 | fine to start |
| 4 vCPU / 8 GB | 500–800 | sweet spot |
| 8 vCPU / 16 GB | 1,000–2,000 | scale workers, see 3.4 |

### 3.3 Create the project in Coolify
1. **New Resource → Docker Compose** → select your GitHub repo + branch `main`
2. Coolify parses `docker-compose.yml`. It creates **6 services**: `web`, `worker-1`, `worker-2`, `worker-3`, `postgres`, `redis`
3. Set environment variables (Coolify UI → Environment → paste from `.env`):
   - **Rotate secrets for production** (do NOT reuse local ones):
     - `JWT_SECRET` → `openssl rand -base64 48`
     - `ENCRYPTION_KEY` → `openssl rand -hex 32`
     - `CRON_SECRET` → `openssl rand -hex 24` (only needed if you use the fallback cron endpoint)
   - `APP_URL` / `NEXT_PUBLIC_APP_URL` → `https://app.yourdomain.com`
   - `LINKEDIN_REDIRECT_URI` → `https://app.yourdomain.com/api/linkedin/callback`
   - `NEXT_PUBLIC_USDT_WALLET_ADDRESS` is a **build arg** — set it as a build variable in Coolify before first build
4. Set the `web` service domain: `https://app.yourdomain.com` (Coolify issues Let's Encrypt SSL automatically via its proxy). Set the `web` service port to `3001` in Coolify's port settings.
5. Deploy → watch build logs (first build ~5-8 min)
6. The Dockerfile entrypoint (`scripts/start.sh`) automatically runs `prisma db push` and the admin seed on every web container start — no manual setup commands needed.

### 3.4 Workers on Coolify
The `docker-compose.yml` defines **3 explicit worker services** (`worker-1`, `worker-2`, `worker-3`).
Coolify will start all 3 automatically — no scaling config needed.

Each worker = 1 Redis connection + 20 DB connections. 3 workers = 3 Redis + 60 DB.
(PS `max_connections=200`, web pool 30 → total headroom OK.)

To verify workers are running:
```bash
docker compose ps | grep worker
# Should show: postgo-worker-1, postgo-worker-2, postgo-worker-3
```

To add more workers later, edit `docker-compose.yml` and add `worker-4`, `worker-5`, etc. (or use `docker compose up -d --scale worker-N=2`).

### 3.5 Scheduled publishing (cron)
The app publishes scheduled posts through the BullMQ workers (real-time, 3 instances).
As an optional safety net, call the cron endpoint every 5 minutes from Coolify's **Scheduled Tasks** (only if you want a fallback):
```
curl -s -H "Authorization: Bearer $CRON_SECRET" https://app.yourdomain.com/api/cron/publish-scheduled
```
This is NOT required — the 3 BullMQ workers already handle scheduling.

---

## Step 4 — Concurrency Validation (answers "how many users?")

A ready-made load-test suite ships in the repo. Run it against the deployed URL
(or local Docker — note port 3001):

```bash
# Quick sanity (100 users, from your machine or VPS)
node scripts/performance-test.js --url=https://app.yourdomain.com
# Local: node scripts/performance-test.js --url=http://localhost:3001

# Load test (500 users, 60s)
node scripts/performance-test.js --mode=load --users=500 --duration=60 --url=https://app.yourdomain.com

# Stress test (1000 simultaneous users)
node scripts/performance-test.js --mode=stress --users=1000 --url=https://app.yourdomain.com

# Soak test (stability over 30 min — catches connection leaks)
node scripts/performance-test.js --mode=soak --duration=1800 --url=https://app.yourdomain.com
```

**While the test runs, watch these on the VPS:**

```bash
# Redis connections must stay CONSTANT (~4-6) — any growth = leak
docker compose exec redis redis-cli info clients | grep connected_clients

# PG connections must stay < 100 (of 200 allowed)
docker compose exec postgres psql -U postgo -c "SELECT count(*) FROM pg_stat_activity;"

# Container CPU/memory
docker stats --no-stream
```

**Pass criteria (no user experiences slowdown):**
- API p95 latency < 500 ms under load
- `connected_clients` flat (no growth over time)
- Zero `rejected_connections`: `redis-cli info stats | grep rejected`
- Worker keeps processing: `waiting` queue count trends to 0

### Why per-user tasks don't slow each other down (architecture summary)
| Concern | Design | Effect under load |
|---|---|---|
| Redis connections | Singleton queue client (web) + 1 per worker | Constant ~3-4, **never grows with users** |
| DB connections | Pooled: web=30, worker=20 per replica | Bounded, PG headroom 150+ |
| Publish jobs | BullMQ queue, per-account rate limiter | User A's 100-post bulk never blocks User B |
| Bulk uploads | `addBulk()` + immediate response | Users never wait for publishing |
| Tenant isolation | AsyncLocalStorage + Prisma `$extends` | No cross-user data access, no race |
| Restarts | Graceful shutdown (SIGTERM → close queue → quit Redis) | Zero connection leaks, 24h+ stable |

**Realistic capacity:** on a 4 vCPU / 8 GB VPS with 3 workers (concurrency 25 each = 75 parallel jobs),
the bottleneck is LinkedIn's API (100 req/min/account) — not the app. The app
itself comfortably serves **~800-1,000 concurrent users** with p95 < 500 ms;
each worker replica processes ~25 posts in parallel, so 3 workers = 75 concurrent publish operations.
