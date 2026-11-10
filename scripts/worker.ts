#!/usr/bin/env ts-node
/**
 * PostGo BullMQ Worker — LinkedIn Post Publisher (High-Concurrency Edition)
 *
 * OPTIMIZED for 1000+ concurrent users with multiple LinkedIn accounts each.
 *
 * Architecture:
 *   Redis (BullMQ Queue + Rate Limit State) → Worker(s) → PostgreSQL → LinkedIn API
 *
 * Rate Limiting Strategy (Bugs #1–#6 fixed):
 *   - Rate limiting now happens INSIDE publishToLinkedIn (src/lib/linkedin-publish.ts)
 *     on EVERY LinkedIn REST call, keyed by LinkedIn MEMBER ID — because that is
 *     the identity LinkedIn actually throttles. The old per-DB-accountId key let
 *     two rows pointing at the same LinkedIn member each think they had their
 *     own 100/min bucket, while LinkedIn saw double the traffic → real 429s.
 *   - The limiter itself is an ATOMIC Lua script (src/lib/linkedin-rate-limiter.ts)
 *     — no more check-then-act race when 75 concurrent slots hit one account.
 *   - The plan's per-account 24h API budget (150/500) is enforced before every
 *     call, and LinkedIn 429s are honored with their Retry-After header.
 *   - Rate-limit-class failures (429 / limiter backpressure) reschedule the
 *     post on a 2/5/15-minute backoff LADDER — a fresh delayed job plus a
 *     publishTime shift — instead of BullMQ's 5s exponential backoff. A
 *     throttled post is never re-fired seconds later into an already-
 *     saturated member window (that retry storm was the second half of
 *     Bug #6: 3 attempts burned in ~35s and the post permanently failed).
 *
 * Job claiming (Bug #3 fix):
 *   - A post is claimed for processing with ONE atomic
 *     `updateMany({ where: { id, status: [scheduled, pending, failed] } })`
 *     → status = processing. If another worker (or a duplicate cron-recovered
 *     job) already claimed it, count === 0 and this worker skips. This makes
 *     duplicate jobs harmless and prevents double-publishing. The manual
 *     "Publish Now" API route uses the same claim, so worker + manual
 *     publish can never double-post the same row either.
 *
 * Required Environment Variables:
 *   - DATABASE_URL: PostgreSQL connection string
 *   - REDIS_URL: Redis connection string (redis://host:port/db)
 *   - WORKER_CONCURRENCY: Max concurrent jobs (default: 25)
 *   - WORKER_ID: Unique ID for multi-worker setups (default: worker-<pid>)
 *   - LINKEDIN_RATE_LIMIT_MAX: Max API requests per member per window (default: 100)
 *   - LINKEDIN_RATE_LIMIT_WINDOW_MS: Rate limit window in ms (default: 60000)
 *
 * Usage:
 *   npm run worker                              # Start single worker
 *   WORKER_CONCURRENCY=30 npm run worker        # Custom concurrency
 *   WORKER_ID=worker-2 npm run worker           # Second worker instance
 */

import { Worker, Job, Queue } from 'bullmq'
import Redis from 'ioredis'
import { PrismaClient, PostStatus } from '@prisma/client'
import { publishToLinkedIn } from '../src/lib/linkedin-publish'
import {
  LINKEDIN_RATE_LIMIT_MAX,
  LINKEDIN_RATE_LIMIT_WINDOW_MS,
} from '../src/lib/linkedin-rate-limiter'

// ─── Configuration ──────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

// Worker identity (for multi-worker deployments)
const WORKER_ID = process.env.WORKER_ID || `worker-${process.pid}`

// Worker concurrency — how many jobs can be processed simultaneously
const WORKER_CONCURRENCY = Math.min(
  parseInt(process.env.WORKER_CONCURRENCY || '25', 10),
  50 // Safety cap to prevent overwhelming LinkedIn API
)

// Per-post hard timeout. Must comfortably exceed the longest legitimate
// publish: a video post can make 3 rate-limited REST calls, each of which
// may legitimately wait out a Retry-After (up to 120s capped) — so a tight
// 120s timeout killed jobs mid-flight and left posts stuck in 'processing'
// (then a retry could duplicate the post). 240s matches queue.ts.
const PER_POST_TIMEOUT_MS = 240_000

if (!DATABASE_URL) {
  console.error('[worker] FATAL: DATABASE_URL env var not set')
  process.exit(1)
}

// ─── Redis Connection (Dedicated for Worker) ────────────────────────

/**
 * Create a dedicated Redis connection for the worker.
 * SEPARATE from the queue connection to avoid conflicts.
 *
 * NOTE: the per-member rate limiter (imported via linkedin-publish.ts)
 * uses its own singleton connection from src/lib/redis.ts — so a worker
 * process holds 2 Redis connections total (BullMQ + limiter). That is
 * bounded and constant per worker instance.
 */
function createWorkerRedisConnection(): Redis {
  const client = new Redis(REDIS_URL, {
    // CRITICAL: Must be null for BullMQ compatibility
    maxRetriesPerRequest: null,

    // Connection settings optimized for high-frequency operations
    enableReadyCheck: true,
    keepAlive: 10000,
    connectTimeout: 10000,

    // Reconnection strategy with exponential backoff
    retryStrategy: (times: number) => {
      const delay = Math.min(times * 200, 5000)
      return delay
    },

    // Lazy connect - don't block startup if Redis is temporarily down
    lazyConnect: false,
  })

  // Connection name for monitoring (set after 'ready' — clientName is not a
  // typed RedisOptions field across all ioredis versions)
  client.on('ready', () => {
    void client.client('SETNAME', `${WORKER_ID}-worker`).catch(() => {})
  })

  return client
}

// ─── Prisma Client (with Connection Pooling) ────────────────────────

/**
 * PrismaClient with connection pool optimization.
 *
 * For 1000+ concurrent users, we need:
 *   - Sufficient connection pool size
 *   - Proper timeout settings
 *   - Idle connection cleanup
 */
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development'
    ? ['error', 'warn']
    : ['error'],

  // Connection pool is configured via DATABASE_URL parameters:
  // Example: postgresql://user:pass@host:5432/db?connection_limit=20&pool_timeout=30
})

// (The Redis-backed per-member rate limiter used to live here as a
// PerAccountRateLimiter class. It has been REMOVED — rate limiting now
// happens inside publishToLinkedIn on every LinkedIn REST call, keyed by
// the LinkedIn member id and acquired atomically. See
// src/lib/linkedin-rate-limiter.ts and src/lib/linkedin-publish.ts.)

// ─── Job Data Type ──────────────────────────────────────────────────

interface LinkedInPostJobData {
  postId: string
  userId: string
  scheduledAt: Date | string
}

// ─── Job Processing ─────────────────────────────────────────────────

/**
 * Process a single LinkedIn post publishing job.
 *
 * Optimized Flow:
 *   1. Fetch post from DB with account details
 *   2. Check schedule state (paused/off → skip)
 *   3. Check account active status
 *   4. ATOMICALLY claim the post (scheduled/pending/failed → processing).
 *      Only ONE worker can flip the status — duplicate jobs (e.g. cron
 *      recovery + original delayed job) become harmless no-ops.
 *   5. Publish to LinkedIn via API (rate-limited per member inside)
 *   6. Update post status to PUBLISHED or FAILED
 *
 * ERROR HANDLING STRATEGY:
 *   - Rate-limit errors (429, limiter backpressure): reschedule on a
 *     2/5/15-minute ladder — never BullMQ's fast retry (Bug #6)
 *   - Transient errors (network timeout, 5xx): BullMQ retry with exponential
 *     backoff (5s → 10s → 20s) — safe, LinkedIn is not throttling us
 *   - Permanent errors (401, 403, daily budget exhausted, invalid data):
 *     Fail immediately, no retry
 *   - DB errors: Log and rethrow for queue-level retry
 */
async function processJob(job: Job<LinkedInPostJobData>): Promise<void> {
  const { postId, userId } = job.data
  const startTime = Date.now()

  console.log(`[worker:${WORKER_ID}] 📋 Processing job ${job.id} for post ${postId}`)

  try {
    // Step 1: Fetch the post with related data
    const post = await prisma.post.findUnique({
      where: { id: postId },
      include: {
        account: {
          select: {
            id: true,
            accessToken: true,
            refreshToken: true,
            linkedinMemberId: true,
            accountName: true,
            isActive: true,
          },
        },
        csvUpload: {
          select: {
            id: true,
            scheduleState: true,
          },
        },
      },
    })

    if (!post) {
      console.warn(`[worker:${WORKER_ID}] ⚠️ Post ${postId} not found (may have been deleted)`)
      return // Don't retry — post doesn't exist
    }

    // Step 2: Check if already processed (idempotency guard)
    if (post.status === PostStatus.published) {
      console.log(`[worker:${WORKER_ID}] ✅ Post ${postId} already published, skipping`)
      return
    }

    if (post.status === PostStatus.failed && post.retryCount >= 3) {
      console.log(`[worker:${WORKER_ID}] ⛔ Post ${postId} exceeded max retries (${post.retryCount}), giving up`)
      return
    }

    // Step 3: Check schedule state (pause/resume support)
    const scheduleState = post.csvUpload?.scheduleState || 'active'
    if (scheduleState !== 'active') {
      console.log(`[worker:${WORKER_ID}] ⏸️ Post ${postId} paused (state: ${scheduleState}), rescheduling`)

      // Update publish time to ~5 minutes from now
      await prisma.post.update({
        where: { id: postId },
        data: { publishTime: new Date(Date.now() + 5 * 60 * 1000) },
      })

      return // Don't fail - just skip for now
    }

    // Step 4: Check account status
    if (!post.account.isActive) {
      await prisma.post.update({
        where: { id: postId },
        data: {
          status: PostStatus.failed,
          error: 'LinkedIn account is deactivated',
          retryCount: { increment: 1 },
        },
      })
      // Don't throw - this is a permanent failure, no point retrying
      console.warn(`[worker:${WORKER_ID}] ⚠️ Account ${post.accountId} is deactivated`)
      return
    }

    // Step 5: ATOMICALLY claim the post for THIS worker (Bug #3 fix).
    // Only a post still in scheduled/pending/failed can be claimed; the
    // single conditional UPDATE guarantees exactly one claimant even when
    // several duplicate jobs (or several workers) race for the same post.
    const claim = await prisma.post.updateMany({
      where: {
        id: postId,
        status: { in: [PostStatus.scheduled, PostStatus.pending, PostStatus.failed] },
      },
      data: {
        status: PostStatus.processing,
        scheduledAt: new Date(),
      },
    })

    if (claim.count === 0) {
      // Someone else is processing it (status = processing), or it was
      // already published by another job. Either way — do nothing.
      console.log(
        `[worker:${WORKER_ID}] 🔁 Post ${postId} already claimed by another worker ` +
        `(status: ${post.status}) — skipping to prevent double-publish`
      )
      return
    }

    // Step 6: Publish to LinkedIn with timeout.
    // All rate limiting (per-member throttle, 24h budget, 429 Retry-After)
    // happens INSIDE publishToLinkedIn now — every caller gets it.
    const result = await Promise.race([
      publishToLinkedIn(
        post.account.accessToken,
        post.account.linkedinMemberId,
        post.caption,
        post.imageUrl,
        post.videoUrl,
        userId,
        post.account.id
      ),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('Publish timeout — LinkedIn did not respond in time')),
          PER_POST_TIMEOUT_MS
        )
      ),
    ])

    // Step 7: Mark as published
    await prisma.post.update({
      where: { id: postId },
      data: {
        status: PostStatus.published,
        error: null,
        linkedinPostUrn: result.postUrn,
      },
    })

    const duration = Date.now() - startTime
    console.log(
      `[worker:${WORKER_ID}] ✅ Post ${postId} published successfully in ${duration}ms ` +
      `(URN: ${result.postUrn}, Account: ${post.account.accountName})`
    )

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    const duration = Date.now() - startTime

    console.error(
      `[worker:${WORKER_ID}] ❌ Failed to publish post ${postId} after ${duration}ms: ${errorMessage}`
    )

    // Classify the failure
    const isRetriableError = isRetriableErrorType(errorMessage)
    // Rate-limit-class failures must NOT go through BullMQ's short 5s
    // exponential backoff — that re-fires the post seconds later and
    // deepens LinkedIn's throttle until the post permanently fails.
    const isRateLimitClass = RATE_LIMIT_ERROR_RE.test(errorMessage)

    try {
      // Increment retry count (recorded even for rate-limit reschedules so
      // the Account History tab's "Retries" column reflects every attempt)
      const newRetryCount = await prisma.post.update({
        where: { id: postId },
        data: {
          status: PostStatus.failed,
          error: errorMessage.slice(0, 500),
          retryCount: { increment: 1 },
        },
        select: { retryCount: true },
      }).then(r => r.retryCount)

      // ─── RATE-LIMIT path: 2 / 5 / 15 minute ladder (Bug #6) ─────────
      // Reschedule the post to a laddered future time, re-queue a fresh
      // DELAYED job for exactly that time, and let the current job
      // complete normally (no throw → no fast BullMQ retry). The publish
      // delay is visible immediately in Account History as the post's new
      // "next publish time".
      if (isRateLimitClass && newRetryCount <= 3) {
        const ladderMs =
          newRetryCount === 1 ? 2 * 60_000 :
          newRetryCount === 2 ? 5 * 60_000 :
          15 * 60_000
        const newPublishTime = new Date(Date.now() + ladderMs)

        // Flip the post back to 'scheduled' with the laddered publish time.
        // The atomic claim (Step 5) still protects it from double-publish.
        await prisma.post.update({
          where: { id: postId },
          data: {
            status: PostStatus.scheduled,
            publishTime: newPublishTime,
            scheduledAt: newPublishTime,
          },
        })

        // Fresh delayed job for the laddered time. If the queue add fails,
        // the post remains 'scheduled' with a future publishTime and the 60s
        // cron recovery endpoint re-queues it when it becomes due.
        try {
          await statsQueue.add(
            'publish-linkedin-post',
            { postId, userId, scheduledAt: newPublishTime },
            {
              jobId: `post-${postId}-rl-${Date.now()}`,
              delay: ladderMs,
              priority: 1,
            }
          )
        } catch (queueErr) {
          console.warn(
            `[worker:${WORKER_ID}] ⚠️ Could not re-queue rate-limited post ${postId} ` +
            '(cron recovery will pick it up when due):',
            queueErr instanceof Error ? queueErr.message : queueErr
          )
        }

        console.log(
          `[worker:${WORKER_ID}] 🕐 Rate-limited post ${postId} rescheduled to ` +
          `${newPublishTime.toISOString()} (attempt ${newRetryCount}/3, ` +
          `+${Math.round(ladderMs / 60000)} min backoff)`
        )
        return // job completes — the NEW delayed job retries later
      }

      // ─── Transient (non-rate-limit) path: BullMQ retry ─────────────
      // Only trigger BullMQ retry if:
      // 1. Error is retriable (transient network issues, 5xx)
      // 2. Under max retry attempts
      if (isRetriableError && newRetryCount < 3) {
        console.log(
          `[worker:${WORKER_ID}] 🔄 Retrying post ${postId} (attempt ${newRetryCount}/3) - transient error`
        )
        throw error // BullMQ will handle retry with exponential backoff
      }

      // Non-retriable errors or max retries reached - job completes as "failed"
      console.log(
        `[worker:${WORKER_ID}] ⛔ Giving up on post ${postId} - ${isRetriableError ? 'max retries' : 'permanent error'}`
      )

    } catch (dbError) {
      // If DB update fails, still throw original error for queue-level retry
      console.error(`[worker:${WORKER_ID}] 💥 Failed to update post ${postId} status:`, dbError)
      throw error
    }
  }
}

/**
 * Rate-limit-class failures: a real LinkedIn 429 (the messages thrown by
 * linkedin-publish.ts contain "429"), limiter backpressure (window still
 * saturated after waiting), or LinkedIn's own throttle wording. These get
 * the LONG 2/5/15-minute reschedule ladder — NOT BullMQ's short exponential
 * backoff, which would re-fire the post seconds later into the very member
 * window that just told us to slow down.
 */
const RATE_LIMIT_ERROR_RE = /429|rate\s*limit|backpressure|throttl/i

/**
 * Determine if an error is retriable.
 *
 * Retriable errors (will retry):
 *   - Network timeouts
 *   - HTTP 429 (Too Many Requests) — INCLUDING the messages thrown by
 *     linkedin-publish.ts, which now literally contain "429" (Bug #6: the
 *     old message "LinkedIn rate limit hit…" matched nothing, so 429s fell
 *     into the default-retriable bucket but with a uselessly short 5s
 *     backoff AND got retried even when they shouldn't have been; see below)
 *   - HTTP 5xx (Server errors)
 *   - ECONNREFUSED, ECONNRESET, ETIMEDOUT
 *
 * Permanent errors (fail immediately):
 *   - HTTP 401 (Unauthorized) — the message contains "Unauthorized"
 *   - HTTP 403 (Forbidden) — the message contains "Forbidden"
 *   - Daily API budget exhausted (message contains "daily API budget")
 *   - Invalid token / credentials
 *   - Account deactivated
 *   - Member ID missing
 */
function isRetriableErrorType(errorMessage: string): boolean {
  // Check permanent patterns FIRST — a message containing "Unauthorized"
  // must never be retried even if it also happens to contain digits that
  // look like a status code.
  const permanentPatterns = [
    /unauthorized/i,
    /forbidden/i,
    /daily\s+linkedin\s+api\s+budget/i,
    /budget\s+exhausted/i,
    /invalid.*token/i,
    /account.*deactivated/i,
    /invalid.*credential/i,
    /member.*id.*missing/i,
  ]

  for (const pattern of permanentPatterns) {
    if (pattern.test(errorMessage)) {
      return false
    }
  }

  const retriablePatterns = [
    /timeout/i,
    /network/i,
    /econnrefused/i,
    /econnreset/i,
    /etimedout/i,
    /429/, // Rate limit — matches "LinkedIn API 429 rate limit hit…"
    /\b5\d{2}\b/, // 5xx errors as standalone numbers (500, 502, 503…)
    /fetch failed/i,
    /socket hang up/i,
    /backpressure/i, // limiter saturation — wait and retry later
  ]

  for (const pattern of retriablePatterns) {
    if (pattern.test(errorMessage)) {
      return true
    }
  }

  // Default to retriable for unknown errors
  return true
}

// ─── Worker Setup ───────────────────────────────────────────────────

console.log(`
╔═════════════════════════════════════════════════════════════════╗
║     PostGo BullMQ Worker v3 (High-Concurrency Edition)           ║
╠═════════════════════════════════════════════════════════════════╣
║  Worker ID:       ${WORKER_ID.padEnd(47)}║
║  Concurrency:      ${WORKER_CONCURRENCY.toString().padEnd(46)}║
║  Rate Limit:      ${LINKEDIN_RATE_LIMIT_MAX + ' req/member/' + (LINKEDIN_RATE_LIMIT_WINDOW_MS / 1000) + 's (atomic, inside publish)'.padEnd(6)}║
║  429 Backoff:     ${'2 / 5 / 15 min ladder (reschedules post)'.padEnd(47)}║
║  Strategy:        PER-LINKEDIN-MEMBER (matches LinkedIn!)      ║
║  Claim:           ATOMIC updateMany (no double-publish)        ║
║  Redis:           ${REDIS_URL.padEnd(45)}║
╚═════════════════════════════════════════════════════════════════╝
`)

const workerRedisConnection = createWorkerRedisConnection()

const worker = new Worker<LinkedInPostJobData>(
  'linkedin-post-queue',
  processJob,
  {
    connection: workerRedisConnection,

    // Retry settings
    maxStalledCount: 3,
    stalledInterval: 30_000,
  }
)

// ─── Event Handlers ─────────────────────────────────────────────────

worker.on('completed', (job: Job<LinkedInPostJobData>) => {
  const duration = Date.now() - job.processedOn!
  console.log(`[worker:${WORKER_ID}] ✅ Job ${job.id} completed in ${duration}ms`)
})

worker.on('failed', (job: Job<LinkedInPostJobData> | undefined, error: Error) => {
  if (job) {
    console.error(
      `[worker:${WORKER_ID}] ❌ Job ${job.id} failed (attempt ${job.attemptsMade}): ${error.message}`
    )
  } else {
    console.error(`[worker:${WORKER_ID}] ❌ Job failed (no job object): ${error.message}`)
  }
})

worker.on('error', (error: Error) => {
  console.error(`[worker:${WORKER_ID}] 💥 Worker error:`, error)
})

worker.on('stalled', (jobId: string) => {
  console.warn(`[worker:${WORKER_ID}] ⚠️ Job ${jobId} stalled — it will be reprocessed`)
})

worker.on('ready', () => {
  console.log(`[worker:${WORKER_ID}] 🟢 Connected to Redis, waiting for jobs...`)
})

worker.on('closing', () => {
  console.log(`[worker:${WORKER_ID}] Closing...`)
})

worker.on('closed', () => {
  console.log(`[worker:${WORKER_ID}] Closed`)
})

worker.on('drained', () => {
  console.log(`[worker:${WORKER_ID}] 📭 Queue drained — no more jobs to process`)
})

// Queue instance for stats (getJobCounts lives on Queue, not Worker).
// Shares the same Redis connection — no extra connections created.
const statsQueue = new Queue('linkedin-post-queue', {
  connection: workerRedisConnection,
})

// Progress logging every 30 seconds (not too verbose)
setInterval(async () => {
  try {
    const counts = await statsQueue.getJobCounts()
    console.log(
      `[worker:${WORKER_ID}] 📊 Queue Status: waiting=${counts.waiting}, active=${counts.active}, ` +
      `delayed=${counts.delayed}, completed=${counts.completed}, failed=${counts.failed}`
    )
  } catch {
    // Ignore stats errors
  }
}, 30_000)

// ─── Graceful Shutdown ──────────────────────────────────────────────

async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`\n[worker:${WORKER_ID}] 🛑 ${signal} received, starting graceful shutdown...`)

  try {
    // Stop accepting new jobs
    console.log(`[worker:${WORKER_ID}] Closing worker...`)
    await worker.close()

    // Close Redis connection
    console.log(`[worker:${WORKER_ID}] Closing Redis connection...`)
    await workerRedisConnection.quit()

    // Disconnect Prisma
    console.log(`[worker:${WORKER_ID}] Disconnecting from database...`)
    await prisma.$disconnect()

    console.log(`[worker:${WORKER_ID}] ✅ Graceful shutdown complete`)
    process.exit(0)
  } catch (error) {
    console.error(`[worker:${WORKER_ID}] Error during shutdown:`, error)
    process.exit(1)
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

// Handle uncaught exceptions
process.on('uncaughtException', (error: Error) => {
  console.error(`[worker:${WORKER_ID}] Uncaught exception:`, error)
  gracefulShutdown('UNCAUGHT_EXCEPTION')
})

process.on('unhandledRejection', (reason: unknown) => {
  console.error(`[worker:${WORKER_ID}] Unhandled rejection:`, reason)
})
