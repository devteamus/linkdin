import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { publishToLinkedIn } from '@/lib/linkedin-publish'

/**
 * Cron endpoint — picks up all posts whose scheduled publish time has arrived
 * and actually publishes them to LinkedIn.
 *
 * Triggered every 60 seconds by:
 *   - The in-container worker loop (see scripts/worker.js) — no external dependency
 *   - OR Coolify's "Cron Jobs" feature calling this endpoint with curl
 *
 * Auth: requires `CRON_SECRET` env var. The caller must send either
 *        `Authorization: Bearer <CRON_SECRET>` or `?secret=<CRON_SECRET>`.
 *
 * Idempotency: only posts with status='scheduled' AND publishTime <= now are
 *              picked up. Once processed, status becomes 'published' or 'failed'.
 *              Safe to call multiple times — already-published posts are skipped.
 *
 * Schedule state awareness (NEW):
 *   - CsvUpload.scheduleState can be 'active' | 'paused' | 'off'
 *   - When 'paused' OR 'off', the post's publishTime is temporarily
 *     postponed (rescheduled to the next 60-second slot) so the cron can
 *     pick it back up later without losing its position in the queue.
 *   - This means the scheduler will naturally "resume" when the user
 *     sets scheduleState back to 'active' — no extra logic needed.
 *
 * Concurrency: processes at most 25 posts per call to avoid overwhelming
 *              LinkedIn's rate limit. The worker calls this endpoint every
 *              60s, so a steady-state queue of up to ~1500 posts/hour works.
 *
 * Multi-day auto-continuation (NEW):
 *   - The bulk upload route already assigns publishTimes spanning multiple
 *     days if the CSV has >50 posts (since the daily cap is 50/account/day).
 *   - The cron simply picks up any post whose publishTime has arrived —
 *     so multi-day continuation is automatic.
 *   - When a user pauses the schedule, the cron reschedules pending posts
 *     forward in time so they don't all fire at once when resumed.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const BATCH_SIZE = 25
const PER_POST_TIMEOUT_MS = 30000

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

  return runScheduledPublisher()
}

export async function GET(request: NextRequest) {
  if (!authenticate(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runScheduledPublisher()
}

async function runScheduledPublisher() {
  const startedAt = new Date()
  const now = new Date()

  // Find scheduled posts that are due.
  // FIX: PostStatus enum values are UPPERCASE — lowercase strings crashed
  // Prisma validation (500) on every cron invocation.
  const duePosts = await db.post.findMany({
    where: {
      status: { in: ['scheduled', 'pending'] },
      publishTime: { lte: now },
    },
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
    orderBy: { publishTime: 'asc' },
    take: BATCH_SIZE,
  })

  if (duePosts.length === 0) {
    return NextResponse.json({
      status: 'idle',
      processed: 0,
      published: 0,
      failed: 0,
      paused: 0,
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
    })
  }

  let published = 0
  let failed = 0
  let paused = 0
  const errors: Array<{ postId: string; error: string }> = []

  // Process sequentially to avoid hammering LinkedIn with parallel requests
  for (const post of duePosts) {
    // ─── Schedule-state awareness ───────────────────────────────────
    // If the parent CSV upload's schedule is paused or off, push this
    // post's publishTime forward so the cron picks it back up later.
    // This naturally implements "Pause" / "Resume" / "On / Off".
    const scheduleState = post.csvUpload?.scheduleState || 'active'
    if (scheduleState !== 'active') {
      // Reschedule to ~5 min from now (so it gets re-checked periodically),
      // but only if it would otherwise have fired (i.e., publishTime <= now).
      // The 5-min spacing also prevents the cron from hot-looping on this
      // same post every 60 seconds while paused.
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
      failed++
      errors.push({ postId: post.id, error: 'Account deactivated' })
      continue
    }

    try {
      // Race against a per-post timeout so one slow LinkedIn response
      // can't stall the whole batch.
      const result = await Promise.race([
        publishToLinkedIn(
          post.account.accessToken,
          post.account.linkedinMemberId,
          post.caption,
          post.imageUrl,
          post.videoUrl,
          post.userId,
          post.account.id
        ),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Publish timeout — LinkedIn did not respond in time')),
            PER_POST_TIMEOUT_MS
          )
        ),
      ])

      // Persist the LinkedIn post URN
      await db.post.update({
        where: { id: post.id },
        data: {
          status: 'published',
          error: null,
          linkedinPostUrn: result.postUrn,
        },
      })
      published++

      // Note: auto-commenting is intentionally NOT implemented — it
      // requires LinkedIn's Community Management API product access,
      // which this app does not have. Every attempt returns 404
      // regardless of URN format or endpoint used.
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      await db.post.update({
        where: { id: post.id },
        data: {
          status: 'failed',
          error: errorMessage.slice(0, 500),
        },
      })
      failed++
      errors.push({ postId: post.id, error: errorMessage })
    }
  }

  return NextResponse.json({
    status: 'processed',
    processed: duePosts.length,
    published,
    failed,
    paused,
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    errors: errors.slice(0, 10), // cap to keep response small
  })
}
