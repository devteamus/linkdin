import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { linkedinPostQueue } from '@/lib/queue'

/**
 * Cron endpoint — SCHEDULE RECOVERY, not a publisher (Bug #3 fix).
 *
 * ⚠️ This route used to publish posts DIRECTLY to LinkedIn. That was one of
 * THREE publish paths (BullMQ worker, this cron, manual publish) and only
 * the worker had a rate limiter — so a cron + worker deployment burned
 * LinkedIn quota TWICE as fast and even double-published the same post
 * (the worker's rate-limited wait never flipped the post to 'processing',
 * so this cron picked the same due post up again 60s later).
 *
 * Now this endpoint NEVER calls LinkedIn. It only:
 *   1. Resets posts stuck in 'processing' for > 10 minutes (a worker died
 *      mid-job) back to 'scheduled' so they can be retried.
 *   2. Finds due posts (scheduled/pending, publishTime <= now) and makes
 *      sure each one HAS a live BullMQ job — re-queueing any that don't
 *      (worker was down at the scheduled time, queue was flushed, etc.).
 *      The worker then publishes them — through the single rate-limited,
 *      budget-checked, atomic-claim path.
 *
 * Duplicate jobs are harmless: the worker claims a post with one atomic
 * conditional UPDATE, so whichever job runs first wins and the other
 * no-ops. It is therefore safe to run this cron alongside the workers.
 *
 * Triggered every 60 seconds by:
 *   - Coolify's "Cron Jobs" feature calling this endpoint with curl
 *   - OR any external scheduler you prefer
 *
 * Auth: requires `CRON_SECRET` env var. The caller must send either
 *        `Authorization: Bearer <CRON_SECRET>` or `?secret=<CRON_SECRET>`.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const BATCH_SIZE = 100
const STUCK_PROCESSING_MS = 10 * 60 * 1000 // 10 minutes

function authenticate(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    // No secret configured → reject. This is fail-closed.
    return false
  }
  const authHeader = request.headers.get('authorization')
  if (authHeader === `Bearer ${secret}`) return true
  const url = new URL(request.url)
  if (url.searchParams.get('secret') === secret) return true
  return false
}

export async function POST(request: NextRequest) {
  if (!authenticate(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return runScheduledRecovery()
}

export async function GET(request: NextRequest) {
  if (!authenticate(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runScheduledRecovery()
}

async function runScheduledRecovery() {
  const startedAt = new Date()
  const now = new Date()

  // ─── 1) Un-stick posts abandoned in 'processing' ──────────────────
  // A worker crash / hard kill mid-publish leaves the row in 'processing'
  // forever. Anything older than 10 minutes is definitely dead (a live
  // publish can't run longer than the 240s job timeout), so put it back
  // to 'scheduled' and let the due-posts pass re-queue it below.
  const resetStuck = await db.post.updateMany({
    where: {
      status: 'processing',
      updatedAt: { lt: new Date(now.getTime() - STUCK_PROCESSING_MS) },
    },
    data: { status: 'scheduled' },
  })

  // ─── 2) Find due posts that need a live queue job ─────────────────
  const duePosts = await db.post.findMany({
    where: {
      status: { in: ['scheduled', 'pending'] },
      publishTime: { lte: now },
    },
    include: {
      csvUpload: {
        select: {
          id: true,
          scheduleState: true,
        },
      },
      account: {
        select: {
          id: true,
          isActive: true,
        },
      },
    },
    orderBy: { publishTime: 'asc' },
    take: BATCH_SIZE,
  })

  let requeued = 0
  let alreadyQueued = 0
  let paused = 0
  let deactivated = 0

  for (const post of duePosts) {
    // ─── Schedule-state awareness ───────────────────────────────────
    // If the parent CSV upload's schedule is paused or off, push this
    // post's publishTime forward so it is picked back up later. This
    // naturally implements "Pause" / "Resume" / "On / Off".
    const scheduleState = post.csvUpload?.scheduleState || 'active'
    if (scheduleState !== 'active') {
      const newTime = new Date(now.getTime() + 5 * 60 * 1000)
      await db.post.update({
        where: { id: post.id },
        data: { publishTime: newTime },
      })
      paused++
      continue
    }

    if (!post.account.isActive) {
      await db.post.update({
        where: { id: post.id },
        data: {
          status: 'failed',
          error: 'LinkedIn account is deactivated',
        },
      })
      deactivated++
      continue
    }

    try {
      // Is there already a live (waiting/delayed/active) job for this post?
      // The base jobId is the one used by bulk upload / single-post create.
      const baseJobId = `post-${post.id}-${post.publishTime?.getTime() ?? 0}`
      const existingJob = await linkedinPostQueue.getJob(baseJobId)
      if (existingJob) {
        const [completed, failed] = await Promise.all([
          existingJob.isCompleted(),
          existingJob.isFailed(),
        ])
        if (!completed && !failed) {
          // Job still live in the queue — the worker will handle it.
          alreadyQueued++
          continue
        }
      }

      // No live job → (re-)queue with a fresh recover jobId so it can't
      // collide with a stale failed job holding the base id. If a live
      // duplicate slips through anyway, the worker's atomic claim makes
      // it a harmless no-op.
      await linkedinPostQueue.add(
        'publish-linkedin-post',
        {
          postId: post.id,
          userId: post.userId,
          scheduledAt: post.publishTime ?? now,
        },
        {
          jobId: `post-${post.id}-recover-${now.getTime()}`,
          delay: 0,
          priority: 1,
        }
      )
      requeued++
    } catch (err) {
      // Queue unreachable — post stays 'scheduled'; next cron tick retries.
      console.error(`[cron-recovery] Failed to re-queue post ${post.id}:`, err)
    }
  }

  return NextResponse.json({
    status: requeued > 0 || resetStuck.count > 0 ? 'processed' : 'idle',
    processed: duePosts.length,
    requeued,
    alreadyQueued,
    paused,
    deactivated,
    resetStuck: resetStuck.count,
    published: 0, // publishing is the worker's job now — kept for old clients
    failed: deactivated,
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
  })
}
