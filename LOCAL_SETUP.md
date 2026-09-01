# PostGo — LinkedIn Bulk Scheduler

Local setup instructions (WSL Ubuntu + Docker recommended).

> **Port:** All runtimes (Docker, Coolify, `npm run dev`) use **port 3001**.
> **Workers:** 3 BullMQ workers run by default in Docker Compose.

## 1. Prerequisites

- Docker Engine 24+ and Docker Compose v2 (recommended — handles PG, Redis, web, and 3 workers)
- OR Node.js 22+ with local PostgreSQL 16 + Redis 7 (for `npm run dev`)
- A LinkedIn Developer app with OAuth credentials
- A TronScan API key (only if you want USDT auto-verification)

## 2. Quick start with Docker Compose (recommended)

```bash
cd postgo
cp .env.example .env   # then edit .env with your secrets
docker compose up -d --build
```

This starts **6 services**:

| Service | Container | Port | Purpose |
|---|---|---|---|
| `web` | `postgo-web` | 3001 (host) → 3001 (container) | Next.js app |
| `worker-1` | `postgo-worker-1` | — | BullMQ worker #1 |
| `worker-2` | `postgo-worker-2` | — | BullMQ worker #2 |
| `worker-3` | `postgo-worker-3` | — | BullMQ worker #3 |
| `postgres` | `postgo-postgres` | 5432 (host) → 5432 | PostgreSQL 16 |
| `redis` | `postgo-redis` | 6379 (host) → 6379 | Redis 7 |

The Dockerfile entrypoint (`scripts/start.sh`) automatically:
1. Runs `prisma db push` (creates tables on first start)
2. Runs the admin seed if `ADMIN_EMAIL` / `ADMIN_PASSWORD` are set
3. Starts `node server.js` on port 3001

### Verify

```bash
# Health check (DB + Redis)
curl http://localhost:3001/api/health
# Expected: {"status":"ok","db":"ok","redis":"ok",...}

# List running containers
docker compose ps
# Should show 6 containers, web/postgres/redis = (healthy)

# View worker logs (all 3)
docker compose logs -f worker-1 worker-2 worker-3
# Should print: "[worker:worker-1] 🟢 Connected to Redis, waiting for jobs..."

# Stop everything
docker compose down
# Add -v to also wipe DB & Redis data volumes
```

## 3. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in at least:

| Variable | Description |
|----------|-------------|
| `APP_URL`               | Your public URL, e.g. `http://localhost:3001` |
| `DATABASE_URL`          | PostgreSQL connection string (Docker overrides this) |
| `REDIS_URL`             | Redis connection string (Docker overrides this) |
| `JWT_SECRET`            | Run: `openssl rand -base64 48` |
| `ENCRYPTION_KEY`        | Run: `openssl rand -hex 32` |
| `LINKEDIN_CLIENT_ID`    | From your LinkedIn Developer app |
| `LINKEDIN_CLIENT_SECRET`| From your LinkedIn Developer app |
| `ADMIN_EMAIL`           | Optional — creates a super-admin on first run |
| `ADMIN_PASSWORD`        | Optional — min 8 chars, must include upper/lower/number |

Optional:
- `CRON_SECRET` — only needed if you call `/api/cron/publish-scheduled` as a fallback (BullMQ workers handle scheduling without it)
- `USDT_WALLET_ADDRESS` / `NEXT_PUBLIC_USDT_WALLET_ADDRESS` — for USDT payments
- `TRON_API_KEY` — for verifying USDT transactions on TronScan
- `RESEND_API_KEY` / `RESEND_FROM_EMAIL` — for forgot-password emails

## 4. LinkedIn OAuth redirect URI

In your LinkedIn Developer app, set the redirect URI to:

```
{APP_URL}/api/linkedin/callback
```

For local testing: `http://localhost:3001/api/linkedin/callback`

Required OAuth scopes: `w_member_social`, `openid`, `profile`, `email`

## 5. Local dev (no Docker) — optional

If you prefer `npm run dev` over Docker:

```bash
# Start a local PostgreSQL 16 + Redis 7 (your preferred way — apt, brew, etc.)
# Then:
cp .env.example .env
# Edit .env:
#   DATABASE_URL=postgresql://postgo:postgo_secret@localhost:5432/postgo
#   REDIS_URL=redis://localhost:6379/0
#   APP_URL=http://localhost:3001

npm install
npx prisma db push
npx tsx prisma/seed.ts   # creates admin (if ADMIN_EMAIL/ADMIN_PASSWORD set)
npm run dev              # http://localhost:3001

# In a separate terminal — start the worker (1 instance for local dev):
npm run worker
```

Open http://localhost:3001

## 6. Scheduled-post auto-publish

The BullMQ workers (`worker-1`, `worker-2`, `worker-3` in Docker Compose, or `npm run worker` for local dev) handle this automatically. They subscribe to the `linkedin-post-queue` Redis queue and process scheduled posts at their `publishTime`.

### Optional fallback: external cron

If you want a backup safety net, you can also hit the cron endpoint manually:

```
* * * * * curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3001/api/cron/publish-scheduled
```

This is NOT required — the BullMQ workers already handle scheduling.

## 7. Production deployment

The project ships with a Dockerfile and docker-compose.yml. For Coolify:

1. Push to GitHub (`.env` is gitignored).
2. In Coolify: **New Resource → Docker Compose → select repo**.
3. Set environment variables in Coolify UI (rotate all secrets for production!).
4. Set the `web` service domain + port 3001.
5. Deploy.

See `DEPLOYMENT_GUIDE.md` for full Coolify walkthrough.

## 8. Features Implemented

This build of PostGo includes the following features:

1. **User authentication** — register / login / forgot-password (OTP via Resend) / JWT sessions
2. **LinkedIn OAuth** — connect multiple LinkedIn accounts (max 100 per user)
3. **Single-post creation** — compose + publish or schedule a single post
4. **Bulk CSV upload** — schedule many posts from a CSV file (Pro plan, max 5MB, multi-day auto-spread)
5. **Post history** — view/filter/delete all your posts
6. **Admin panel** — view users, accounts, payments, revenue, monitoring (admin role only)
7. **Payments** — USDT TRC20 (auto-verify via TronScan) and Binance Pay (manual verify by admin)
8. **BullMQ queue** — 3 worker replicas process scheduled posts asynchronously
9. **Per-account rate limiting** — Redis-backed sliding window (100 req/min/account)
10. **Tenant isolation** — AsyncLocalStorage + Prisma `$extends` (no cross-user data access)
11. **Graceful shutdown** — SIGTERM/SIGINT handlers (zero Redis connection leaks across restarts)
12. **Health check** — `/api/health` checks both PostgreSQL AND Redis in parallel

## 9. Pricing plans

The app exposes **two paid tiers** in the UI (plus a free tier):

| Plan | Price | LinkedIn accounts | Posts/day/account | Bulk CSV upload | CSV max size | Monthly capacity |
|---|---|---|---|---|---|---|
| **Free** | $0 | 2 | 10 | ❌ Not available | — | 600 posts |
| **Pro** | **$49/month** | **25** | **50** | ✅ Up to 1000 posts/upload | 5 MB | **37,500 posts** |
| **Enterprise** | **$149/month** | **75** | **250** | ✅ Up to 10000 posts/upload | 5 MB | **562,500 posts** |

> **Monthly capacity** = accounts × posts/day × 30 days.
> - Pro: 25 × 50 × 30 = **37,500 posts/month**
> - Enterprise: 75 × 250 × 30 = **562,500 posts/month**
>
> This is the headline value shown on the landing page so users instantly see the scale they're paying for.

### Payment methods

- **USDT (TRC20)** — auto-verified via TronScan API. User submits tx hash; backend verifies on-chain amount matches the chosen plan exactly ($49 or $149).
- **Binance Pay** — manual verification. User submits transaction ID; admin reviews and approves via the admin panel.

### Upgrades

- Free → Pro: choose Pro on dashboard Upgrade tab, pay $49.
- Free → Enterprise: choose Enterprise on dashboard Upgrade tab, pay $149.
- Pro → Enterprise: paid users see an inline "Upgrade to Enterprise" CTA on their Upgrade tab; pay $149 to switch.

### Where pricing is enforced in code

- `prisma/schema.prisma` — `Plan` enum (`free`, `pro`, `enterprise`)
- `src/lib/plan-limits.ts` — per-plan feature limits + `PLAN_PRICES` map ($49 / $149)
- `src/app/api/posts/bulk/route.ts` — bulk upload checks `user.plan === 'free'` and rejects with 403
- `src/app/api/payment/route.ts` — validates `amount === PLAN_PRICES[plan]` (must be exactly $49 or $149)
- `src/app/api/payment/verify-usdt/route.ts` — verifies on-chain USDT amount matches the plan's price (±0.01 USDT dust tolerance)
- `src/app/api/admin/stats/route.ts` — revenue = proCount × $49 + enterpriseCount × $149
- `src/app/api/admin/users/[id]/route.ts` — admins can assign any of `free` / `pro` / `enterprise`
- `src/components/landing/LandingPage.tsx` — landing page shows 3-tier pricing grid + monthly capacity math + per-post cost breakdown
- `src/components/dashboard/Dashboard.tsx` → `UpgradeTab` — plan selector (Pro vs Enterprise) + locked-amount payment forms
- `prisma/seed.ts` — admin user is auto-assigned `plan: pro`

## CSV format

```csv
caption,image_url,media_url,video_url,comment
Hello LinkedIn!,,https://example.com/image.jpg,,"Check out my new post!"
Video post,,https://example.com/video.mp4,,
Text only,,,,
```

- `caption` — required, max 3000 chars
- `image_url` — optional (legacy, prefer `media_url`)
- `media_url` — optional, image OR video (auto-detected by content-type)
- `video_url` — optional, alternative to `media_url`
- `comment` — optional, stored but not auto-posted (LinkedIn Community Management API not available)

Max 50 posts per account per day. CSVs larger than 50 posts auto-spread across days.
