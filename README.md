# PostGo

LinkedIn post scheduler — connect up to 75 LinkedIn accounts (Enterprise plan) or 25 (Pro plan), schedule single or bulk posts via CSV, USDT TRC20 / Binance Pay payments.

**Stack:** Next.js 16 (standalone output) · React 19 · Prisma + PostgreSQL · BullMQ + Redis · TypeScript · Tailwind 4 · shadcn/ui.

---

## 1. Project structure

```
.
├── prisma/
│   ├── schema.prisma     # DB models (User, LinkedinAccount, Post, CsvUpload, Payment, PasswordResetToken)
│   └── seed.ts           # Creates super admin (env-gated: ADMIN_EMAIL / ADMIN_PASSWORD)
├── src/
│   ├── app/
│   │   ├── api/          # 22 REST endpoints (auth, posts, accounts, payment, admin, linkedin, health)
│   │   ├── layout.tsx    # Metadata, JSON-LD, Google Analytics
│   │   ├── page.tsx      # Landing page / Dashboard / Admin switcher (with Suspense)
│   │   └── globals.css
│   ├── components/
│   │   ├── ui/           # shadcn/ui primitives (60+ components)
│   │   ├── dashboard/    # User dashboard
│   │   ├── admin/        # Admin panel
│   │   ├── landing/      # Landing page + Telegram chat widget
│   │   └── modals/       # Auth + legal modals
│   ├── lib/
│   │   ├── db.ts             # Prisma client with AsyncLocalStorage tenant isolation
│   │   ├── jwt.ts             # JWT sign/verify (jose, HS256, 7d expiry)
│   │   ├── encryption.ts      # AES-256-CBC for LinkedIn tokens at rest
│   │   ├── auth.ts            # Bearer header → cookie fallback session resolver
│   │   ├── rate-limit.ts      # In-memory IP rate limiter
│   │   ├── validations.ts     # Zod schemas for all inputs
│   │   ├── linkedin-oauth-state.ts  # Stateless signed OAuth state (no in-memory map)
│   │   ├── redis.ts           # Singleton Redis client (BullMQ backend)
│   │   ├── queue.ts           # Singleton BullMQ Queue (linkedin-post-queue)
│   │   ├── redis-monitor.ts   # Redis connection metrics & leak detection
│   │   ├── graceful-shutdown.ts  # SIGTERM/SIGINT handlers (zero connection leaks)
│   │   ├── plan-limits.ts     # Per-plan feature limits (free / pro / enterprise)
│   │   ├── api.ts             # Frontend API client
│   │   └── store.ts           # Zustand app store
│   └── middleware.ts     # Security headers + body size limits (1MB JSON / 10MB multipart)
├── scripts/
│   ├── worker.ts          # BullMQ worker (3 Docker replicas: worker-1/2/3)
│   └── start.sh           # Container entrypoint: prisma db push + seed + node server.js
├── Dockerfile            # Multi-stage build for Coolify / Docker (port 3001)
├── docker-compose.yml    # 6 services: web + worker-1 + worker-2 + worker-3 + postgres + redis
├── .dockerignore
├── .env.example
└── next.config.ts        # Standalone output + security headers
```

---

## 2. Environment variables

Copy `.env.example` → `.env` and fill in real values.

| Variable | Required | Purpose |
|---|---|---|
| `APP_URL` | ✅ | Public base URL, e.g. `https://postgo.fun`. Used to derive LinkedIn OAuth redirect_uri. |
| `DATABASE_URL` | ✅ | SQLite path. In Docker use `file:/app/db/custom.db` and mount a volume at `/app/db`. |
| `JWT_SECRET` | ✅ | ≥ 32 chars. `openssl rand -base64 48` |
| `ENCRYPTION_KEY` | ✅ | 32 chars. `openssl rand -hex 32` |
| `LINKEDIN_CLIENT_ID` | OAuth | LinkedIn Developer Console |
| `LINKEDIN_CLIENT_SECRET` | OAuth | LinkedIn Developer Console |
| `LINKEDIN_REDIRECT_URI` | optional | Override; defaults to `{APP_URL}/api/linkedin/callback` |
| `TRON_API_KEY` | USDT | Tronscan API key for USDT TRC20 payment verification |
| `USDT_WALLET_ADDRESS` | USDT (server) | TRC20 wallet address — used by `/api/payment/verify-usdt` |
| `NEXT_PUBLIC_USDT_WALLET_ADDRESS` | USDT (client) | Same wallet, exposed to dashboard for display |
| `CRON_SECRET` | ✅ worker | `openssl rand -hex 32`. Authenticates the in-container worker. **Without this, scheduled posts will never be published automatically.** |
| `ADMIN_EMAIL` | seed | Set on first deploy to create super admin |
| `ADMIN_PASSWORD` | seed | Set on first deploy (min 8 chars) |

---

## 3. Local development

```bash
npm install                       # also runs `prisma generate` via postinstall
cp .env.example .env              # then edit .env
npx prisma db push                # apply PostgreSQL schema
npx tsx prisma/seed.ts            # create admin (requires ADMIN_EMAIL/ADMIN_PASSWORD)
npm run dev                       # http://localhost:3001
```

> Port is **3001** — same port used in Docker, Coolify, and `npm run dev`.
> Requires a local PostgreSQL + Redis, OR run via Docker Compose (see §4).

---

## 4. Deploy to Coolify (VPS)

### 4.1 Push to GitHub (new repo)

1. Create a new GitHub repo (e.g. `postgo`).
2. Make sure `.env` is NOT committed (it's in `.gitignore`).
3. Push:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin git@github.com:<your-user>/postgo.git
   git push -u origin main
   ```

### 4.2 Create the app in Coolify

1. In Coolify dashboard → **+ New Resource** → **App**.
2. Choose **Public repository** → connect GitHub → select `postgo`.
3. **Build Pack**: `Dockerfile` (Coolify auto-detects `./Dockerfile`).
4. **Port**: `3001`.
5. **Health check**: `GET /api/health` (Coolify will probe it automatically because it's in the Dockerfile `HEALTHCHECK`).
6. Add the following **Environment variables** in Coolify → **Environment**:

```
APP_URL=https://your-domain.com
DATABASE_URL=file:/app/db/custom.db
JWT_SECRET=<openssl rand -base64 48>
ENCRYPTION_KEY=<openssl rand -hex 32>
LINKEDIN_CLIENT_ID=<from LinkedIn dev console>
LINKEDIN_CLIENT_SECRET=<from LinkedIn dev console>
TRON_API_KEY=<from tronscan.org>
USDT_WALLET_ADDRESS=<your TRC20 wallet>
NEXT_PUBLIC_USDT_WALLET_ADDRESS=<same wallet as above>
CRON_SECRET=<openssl rand -hex 32>      # REQUIRED for scheduled-post worker
ADMIN_EMAIL=admin@your-domain.com       # set on first deploy only
ADMIN_PASSWORD=<long random string>      # set on first deploy only
```

> ⚠️ **BullMQ workers handle scheduled-post publishing automatically** — no `CRON_SECRET` needed for normal operation. **However, if you also configure Coolify's Scheduled Tasks to hit `/api/cron/publish-scheduled` as a fallback**, `CRON_SECRET` is required to authenticate that endpoint. Without it, the fallback cron returns 401.

### 4.3 Persistent storage (CRITICAL)

**For Docker Compose deployments (recommended):** the `docker-compose.yml` already defines named volumes `postgres-data` and `redis-data` — your data survives restarts automatically.

**For Coolify single-Dockerfile deployments:** Coolify → your app → **Storages** → **Add new storage**. You need TWO persistent volumes:

| Mount path | Type | Volume name | Purpose |
|---|---|---|---|
| `/var/lib/postgresql/data` | Volume | `postgo-pg` | PostgreSQL data (if running PG inside the same container) |
| `/data` | Volume | `postgo-redis` | Redis AOF file (if running Redis inside the same container) |

> **Recommended:** Use Coolify's **Docker Compose** build pack (not the plain Dockerfile pack) so Coolify reads `docker-compose.yml` and creates the postgres/redis containers with their volumes for you.
>
> **If you use an external managed PostgreSQL + Redis** (e.g. Neon, Supabase, Upstash), no app-level storage is needed — point `DATABASE_URL` and `REDIS_URL` to the managed services.

### 4.4 Domain + HTTPS

Coolify → your app → **Domains** → add `https://your-domain.com`. Coolify auto-issues Let's Encrypt certs and routes traffic to port 3001 of the container.

### 4.5 Deploy

Click **Deploy**. Coolify will:
1. `git pull` from main
2. Build the Docker image (multi-stage, ~2 min)
3. Start a container with `node server.js` (Next.js standalone) via `scripts/start.sh`
4. Probe `/api/health` until 200 OK (the Dockerfile's HEALTHCHECK does this automatically)
5. Route traffic once healthy

### 4.6 Verify

- Visit `https://your-domain.com/api/health` → should return `{"status":"ok",...}` (checks DB + Redis).
- Visit `https://your-domain.com` → landing page should load.
- Log in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` → should land on the admin panel.

---

## 5. LinkedIn OAuth setup

1. Go to <https://www.linkedin.com/developers/apps> → **Create app**.
2. Add the product **Sign In with LinkedIn using OpenID Connect**.
3. Under **Auth** → **Authorized redirect URLs**, add:
   ```
   https://your-domain.com/api/linkedin/callback
   ```
4. Copy the **Client ID** and **Client Secret** into Coolify env vars.

The redirect_uri used by the app is derived from `APP_URL` (`{APP_URL}/api/linkedin/callback`) — make sure they match exactly.

---

## 6. Security notes

- **JWT**: HS256, 7-day expiry, fail-fast if `JWT_SECRET` < 32 chars.
- **LinkedIn tokens**: encrypted at rest with AES-256-CBC (`ENCRYPTION_KEY`).
- **CSP**: strict default-src + limited connect-src (Tron, LinkedIn, GA).
- **Rate limiting**: in-memory, per-IP. Limits: auth 10/min, posts 30/min, bulk upload 3/min, payments 5/min, admin 30/min.
- **Admin seed password**: not stored in code — read from env, only used on first deploy.
- **SQL injection**: Prisma's parameterized queries throughout.

### Known limitations

- **Rate limiter & OAuth state are per-instance.** With multiple replicas they would not share state. Coolify's default single-replica setup is fine.
- **Forgot-password email delivery is not wired.** The token is generated and stored, but no SMTP client is configured. See the comment in `src/app/api/auth/forgot-password/route.ts` for how to add SMTP.
- **OAuth state now survives restarts** (stateless signed tokens) — but the rate limiter is still in-memory.

---

## 7. Health & monitoring

- `GET /api/health` — returns `{status, uptime, db, latencyMs}`. Used by Docker `HEALTHCHECK` and Coolify.
- Server logs go to stdout (Coolify captures them under **Logs**).
- Worker logs are prefixed with `[worker]` so they're easy to filter. You should see one line per minute like:
  ```
  [worker:worker-1] 🟢 Connected to Redis, waiting for jobs...
  [worker:worker-2] 🟢 Connected to Redis, waiting for jobs...
  [worker:worker-3] 🟢 Connected to Redis, waiting for jobs...
  [worker:worker-1] 📊 Queue Status: waiting=0, active=0, delayed=12, completed=37, failed=0
  ```
  The `docker-compose.yml` defines **3 worker services** (`worker-1`, `worker-2`, `worker-3`).
  Each worker has its own Redis + DB connection pool and shares the same BullMQ queue.
- Prisma logs SQL only in dev. In production only errors and warnings.

---

## 8. Scheduled-post worker (CRITICAL)

The PostGo app ships with a background worker that automatically publishes scheduled posts to LinkedIn — **even if the user's browser is closed**. This is what makes the CSV bulk-upload feature actually useful: a user can upload 100 posts, set a 1-hour interval, close the tab, and the worker will publish each post at its scheduled time.

### Architecture

```
┌─────────────────┐
│   Browser       │  User uploads CSV, closes tab.
│   (optional)    │
└─────────────────┘
         │
         ▼ (one-time HTTP call)
┌─────────────────────────────────────────────┐
│   Next.js server (PID 1)                   │
│   POST /api/posts/bulk                     │
│   → creates Post rows with                 │
│     status='scheduled'                     │
│     publishTime=now+N*interval             │
└─────────────────────────────────────────────┘
         ▲
         │ every 60s
         │
┌─────────────────────────────────────────────┐
│   Worker (background Node loop)            │
│   scripts/worker.js                         │
│   - calls POST /api/cron/publish-scheduled │
│     with Authorization: Bearer CRON_SECRET │
│   - skips if previous tick still running    │
│   - SIGTERM/SIGINT graceful shutdown        │
└─────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────┐
│   Cron endpoint                             │
│   /api/cron/publish-scheduled               │
│   - finds up to 25 due posts               │
│   - for each: decrypts token, calls        │
│     POST api.linkedin.com/rest/posts        │
│   - updates status to 'published' or       │
│     'failed' (with error message persisted)│
└─────────────────────────────────────────────┘
```

### Files

- `src/lib/linkedin-publish.ts` — LinkedIn REST Posts API client (decrypts token, builds authorUrn, sends post).
- `src/app/api/cron/publish-scheduled/route.ts` — secure cron endpoint (requires `CRON_SECRET`). Fallback for environments where BullMQ worker is not running.
- `scripts/worker.ts` — BullMQ worker (run as 3 separate Docker services: `worker-1`, `worker-2`, `worker-3`).
- `src/lib/queue.ts` — singleton BullMQ Queue used by the web app to push jobs.
- `scripts/start.sh` — container entrypoint for the web service: runs `prisma db push` + seed + `node server.js`.
- `Dockerfile` — multi-stage build, ENTRYPOINT = `scripts/start.sh`, EXPOSE 3001.
- `docker-compose.yml` — defines 6 services: web, worker-1, worker-2, worker-3, postgres, redis.

### Required env vars for workers

- `DATABASE_URL` — PostgreSQL connection string.
- `REDIS_URL` — Redis connection string (BullMQ backend).
- `WORKER_CONCURRENCY` — jobs processed in parallel per worker instance (default: 25).
- `WORKER_ID` — auto-set per container (`worker-1`, `worker-2`, `worker-3`).
- `LINKEDIN_RATE_LIMIT_MAX` / `LINKEDIN_RATE_LIMIT_WINDOW_MS` — per-account burst protection (default: 100 req / 60s).

> `CRON_SECRET` is only needed if you also call `/api/cron/publish-scheduled` as a fallback cron job (e.g. via Coolify Scheduled Tasks). The BullMQ workers do NOT require it.

### Optional fallback: Coolify Cron Jobs

If you prefer Coolify's built-in cron scheduler instead of (or in addition to) the in-container worker, add a Cron Job in Coolify → your app → **Cron Jobs**:

| Field | Value |
|---|---|
| Command | `curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3001/api/cron/publish-scheduled` |
| Schedule | `* * * * *` (every minute) |
| Container | `postgo` (the same container) |

Both mechanisms can run simultaneously — the endpoint is idempotent (only posts with `status='scheduled'` are picked up).

---

## 9. Useful commands

```bash
# Lint
npm run lint

# Type-check (no emit)
npx tsc --noEmit

# Apply DB schema changes (destructive)
npx prisma db push --accept-data-loss

# Reset DB
npx prisma migrate reset

# Create super admin after first deploy
ADMIN_EMAIL=admin@x.com ADMIN_PASSWORD=xxxxx npx tsx prisma/seed.ts
```
