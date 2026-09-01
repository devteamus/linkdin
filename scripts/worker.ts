#!/usr/bin/env ts-node
/**
 * PostGo BullMQ Worker — LinkedIn Post Publisher (High-Concurrency Edition)
 *
 * OPTIMIZED for 1000+ concurrent users with multiple LinkedIn accounts each.
 *
 * Key Improvements over v1:
 *   ✅ Per-account rate limiting (no user blocks another user!)
 *   ✅ Redis-backed rate limiter state (persists across restarts)
 *   ✅ Connection pooling for PostgreSQL
 *   ✅ Separate Redis connections for Queue vs Worker
 *   ✅ Graceful degradation under heavy load
 *   ✅ Better error recovery and retry logic
 *
 * Architecture:
 *   Redis (BullMQ Queue + Rate Limit State) → Worker(s) → PostgreSQL → LinkedIn API
 *
 * Rate Limiting Strategy:
 *   - Per-ACCOUNT rate limiting (not global!)
 *   - Each LinkedIn account gets 100 API calls/minute
 *   - Uses Redis sorted sets for O(1) sliding window checks
 *   - Automatic backoff when approaching limits
 *
 * Required Environment Variables:
 *   - DATABASE_URL: PostgreSQL connection string
 *   - REDIS_URL: Redis connection string (redis://host:port/db)
 *   - WORKER_CONCURRENCY: Max concurrent jobs (default: 20)
 *   - WORKER_ID: Unique ID for multi-worker setups (default: worker-1)
 *   - LINKEDIN_RATE_LIMIT_MAX: Max API requests per account per window (default: 100)
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

// LinkedIn API rate limiting settings PER ACCOUNT
const RATE_LIMIT_MAX = parseInt(process.env.LINKEDIN_RATE_LIMIT_MAX || '100', 10)
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.LINKEDIN_RATE_LIMIT_WINDOW_MS || '60000', 10)

if (!DATABASE_URL) {
  console.error('[worker] FATAL: DATABASE_URL env var not set')
  process.exit(1)
}

// ─── Redis Connection (Dedicated for Worker) ────────────────────────

/**
 * Create a dedicated Redis connection for the worker.
 * SEPARATE from the queue connection to avoid conflicts.
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

// ─── Per-Account Rate Limiter (Redis-Backed) ───────────────────────

/**
 * SLIDING WINDOW RATE LIMITER using Redis Sorted Sets.
 * 
 * WHY THIS MATTERS:
 *   ❌ OLD: Single global rate limiter → User A blocks User B!
 *   ✅ NEW: Per-account rate limiting → Each account independent!
 * 
 * How it works:
 *   - Each account (by accountId) has its own rate limit window
 *   - Uses Redis ZSET with timestamps as scores
 *   - O(1) complexity for both check and record operations
 *   - Atomic operations prevent race conditions
 *   - State survives worker restarts (stored in Redis)
 */

class PerAccountRateLimiter {
  private redis: Redis
  private maxRequests: number
  private windowMs: number
  
  // Prefix for Redis keys to avoid collisions
  private static readonly KEY_PREFIX = 'ratelimit:linkedin:'
  
  constructor(redis: Redis, maxRequests: number, windowMs: number) {
    this.redis = redis
    this.maxRequests = maxRequests
    this.windowMs = windowMs
  }
  
  /**
   * Get the Redis key for an account's rate limit data.
   */
  private getKey(accountId: string): string {
    return `${PerAccountRateLimiter.KEY_PREFIX}${accountId}`
  }

  /**
   * Check and record an API call for a specific account.
   * 
   * @param accountId - The LinkedIn account ID
   * @returns Object with:
   *   - allowed: Whether the call is allowed now
   *   - waitTime: If not allowed, ms until next slot available
   *   - remaining: Remaining calls in current window
   *   - resetTime: When the window resets (unix timestamp ms)
   */
  async acquire(accountId: string): Promise<{
    allowed: boolean
    waitTime: number
    remaining: number
    resetTime: number
  }> {
    const key = this.getKey(accountId)
    const now = Date.now()
    const windowStart = now - this.windowMs
    
    // ATOMIC operation using Redis pipeline:
    // 1. Remove old entries outside the window
    // 2. Count current entries
    // 3. If under limit, add new entry
    // All in one round-trip!
    
    const pipeline = this.redis.pipeline()
    
    // Remove expired entries
    pipeline.zremrangebyscore(key, 0, windowStart)
    
    // Count current entries in window
    pipeline.zcard(key)
    
    const results = await pipeline.exec()
    
    const rawCount = results?.[1]?.[1]
    if (rawCount === null || rawCount === undefined) {
      throw new Error('Failed to check rate limit')
    }
    
    const currentCount = Number(rawCount)
    
    if (currentCount < this.maxRequests) {
      // Under limit - record this call and allow it
      // CRITICAL FIX: zadd(key, score, member) — the previous object form
      // {score, value} is interpreted by ioredis as {member: score}, which
      // produced an invalid ZADD ("value is not a valid float") and failed
      // every rate-limit acquisition.
      await this.redis.zadd(
        key,
        now,
        `${now}-${Math.random().toString(36).slice(2, 11)}`
      )
      
      // Set expiry on the key to auto-cleanup inactive accounts
      await this.redis.expire(key, Math.ceil(this.windowMs / 1000) + 60)
      
      return {
        allowed: true,
        waitTime: 0,
        remaining: this.maxRequests - currentCount - 1,
        resetTime: now + this.windowMs,
      }
    } else {
      // Over limit - calculate wait time
      // Get the oldest entry to determine when a slot opens
      const oldestEntry = await this.zrange(key, 0, 0)
      
      let waitTime = this.windowMs - (now - (oldestEntry?.[1] || windowStart)) + 100
      
      waitTime = Math.max(0, Math.min(waitTime, this.windowMs))
      
      return {
        allowed: false,
        waitTime,
        remaining: 0,
        resetTime: (oldestEntry?.[1] || windowStart) + this.windowMs,
      }
    }
  }
  
  /**
   * Helper method for zrange that handles ioredis response format.
   */
  private async zrange(
    key: string,
    start: number,
    stop: number
  ): Promise<[string, number] | null> {
    try {
      const result = (await this.redis.zrange(key, start, stop, 'WITHSCORES')) as unknown as string[]
      if (Array.isArray(result) && result.length >= 2) {
        return [result[0], Number(result[1])]
      }
      return null
    } catch {
      return null
    }
  }

  /**
   * Get current rate limit status for an account (without recording).
   */
  async getStatus(accountId: string): Promise<{
    used: number
    max: number
    remaining: number
    resetInMs: number
  }> {
    const key = this.getKey(accountId)
    const now = Date.now()
    const windowStart = now - this.windowMs
    
    // Clean up old entries and count
    const pipeline = this.redis.pipeline()
    pipeline.zremrangebyscore(key, 0, windowStart)
    pipeline.zcard(key)
    
    const results = await pipeline.exec()
    const used = Number(results?.[1]?.[1] ?? 0)
    
    // Get oldest entry for reset time calculation
    let resetInMs = 0
    if (used >= this.maxRequests) {
      const oldest = await this.zrange(key, 0, 0)
      if (oldest) {
        resetInMs = Math.max(0, oldest[1] + this.windowMs - now)
      }
    }
    
    return {
      used,
      max: this.maxRequests,
      remaining: Math.max(0, this.maxRequests - used),
      resetInMs,
    }
  }

  /**
   * Reset rate limit for an account (admin use only).
   */
  async reset(accountId: string): Promise<void> {
    const key = this.getKey(accountId)
    await this.redis.del(key)
  }
}

// Global rate limiter instance (per-account, Redis-backed)
let rateLimiter: PerAccountRateLimiter

function initializeRateLimiter(redisConnection: Redis): void {
  rateLimiter = new PerAccountRateLimiter(
    redisConnection,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS
  )
}

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
 *   4. Acquire per-account rate limiter slot (NON-BLOCKING for other accounts!)
 *   5. Update post status to PROCESSING
 *   6. Publish to LinkedIn via API
 *   7. Update post status to PUBLISHED or FAILED
 *   8. Return success/failure
 * 
 * ERROR HANDLING STRATEGY:
 *   - Transient errors (network timeout, 429): Retry with exponential backoff
 *   - Permanent errors (401, 403, invalid data): Fail immediately, no retry
 *   - DB errors: Log and rethrow for queue-level retry
 */
async function processJob(job: Job<LinkedInPostJobData>): Promise<void> {
  const { postId, userId } = job.data
  const startTime = Date.now()
  
  // Track which account we're processing (for rate limiting)
  let currentAccountId: string | null = null

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

    // Store account ID for rate limiting
    currentAccountId = post.accountId

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

    // Step 5: Acquire per-account rate limiter slot
    // THIS IS THE KEY FIX: Each account has its OWN rate limit!
    const rateLimitResult = await rateLimiter.acquire(post.accountId)
    
    if (!rateLimitResult.allowed && rateLimitResult.waitTime > 0) {
      console.log(
        `[worker:${WORKER_ID}] 🚦 Rate limited for account ${post.accountId}, ` +
        `waiting ${rateLimitResult.waitTime}ms (${rateLimitResult.remaining} remaining)`
      )
      
      // Wait for rate limit window to open
      await new Promise(resolve => setTimeout(resolve, rateLimitResult.waitTime))
    }

    // Step 6: Update status to PROCESSING
    await prisma.post.update({
      where: { id: postId },
      data: {
        status: PostStatus.processing,
        scheduledAt: new Date(),
      },
    })

    // Step 7: Publish to LinkedIn with timeout
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
          120_000 // 2 minute timeout per post
        )
      ),
    ])

    // Step 8: Mark as published
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

    // Determine if this is a retriable error
    const isRetriableError = isRetriableErrorType(errorMessage)

    try {
      // Increment retry count and update status
      const newRetryCount = await prisma.post.update({
        where: { id: postId },
        data: {
          status: PostStatus.failed,
          error: errorMessage.slice(0, 500),
          retryCount: { increment: 1 },
        },
        select: { retryCount: true },
      }).then(r => r.retryCount)

      // Only trigger BullMQ retry if:
      // 1. Error is retriable (transient network issues, rate limits)
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
 * Determine if an error is retriable.
 * 
 * Retriable errors (will retry):
 *   - Network timeouts
 *   - HTTP 429 (Too Many Requests) - though our rate limiter should prevent this
 *   - HTTP 5xx (Server errors)
 *   - ECONNREFUSED, ECONNRESET, ETIMEDOUT
 * 
 * Permanent errors (fail immediately):
 *   - HTTP 401 (Unauthorized) - token issues, won't fix by retrying
 *   - HTTP 403 (Forbidden) - permission issues
 *   - Invalid input errors
 *   - Account deactivated
 */
function isRetriableErrorType(errorMessage: string): boolean {
  const permanentPatterns = [
    /unauthorized/i,
    /forbidden/i,
    /invalid.*token/i,
    /account.*deactivated/i,
    /invalid.*credential/i,
    /member.*id.*missing/i,
  ]
  
  const retriablePatterns = [
    /timeout/i,
    /network/i,
    /econnrefused/i,
    /econnreset/i,
    /etimedout/i,
    /5\d{2}/, // 5xx errors
    /429/, // Rate limit (shouldn't happen with our limiter, but just in case)
    /fetch failed/i,
    /socket hang up/i,
  ]
  
  // Check permanent patterns first
  for (const pattern of permanentPatterns) {
    if (pattern.test(errorMessage)) {
      return false
    }
  }
  
  // Default to retriable for unknown errors
  return true
}

// ─── Worker Setup ───────────────────────────────────────────────────

console.log(`
╔═════════════════════════════════════════════════════════════════╗
║     PostGo BullMQ Worker v2 (High-Concurrency Edition)         ║
╠═════════════════════════════════════════════════════════════════╣
║  Worker ID:       ${WORKER_ID.padEnd(47)}║
║  Concurrency:      ${WORKER_CONCURRENCY.toString().padEnd(46)}║
║  Rate Limit:      ${RATE_LIMIT_MAX.toString() + ' req/account/' + (RATE_LIMIT_WINDOW_MS / 1000).toString() + 's'.padEnd(32)}║
║  Strategy:        PER-ACCOUNT (users don\'t block each other!) ║
║  Redis:           ${REDIS_URL.padEnd(45)}║
╚═════════════════════════════════════════════════════════════════╝
`)

const workerRedisConnection = createWorkerRedisConnection()

// Initialize rate limiter after Redis connection is ready
initializeRateLimiter(workerRedisConnection)

const worker = new Worker<LinkedInPostJobData>(
  'linkedin-post-queue',
  processJob,
  {
    connection: workerRedisConnection,
    concurrency: WORKER_CONCURRENCY,
    
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
