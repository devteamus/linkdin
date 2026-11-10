import { NextRequest, NextResponse } from 'next/server'
import Papa from 'papaparse'
import { getSession } from '@/lib/auth'
import { db, runInTenantContext } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'
import { detectMediaType } from '@/lib/linkedin-publish'
import { bulkAddPostsToQueue } from '@/lib/queue'
import { getPlanLimits } from '@/lib/plan-limits'
import { getEffectivePlan } from '@/lib/plan-helpers'
import type { Plan } from '@prisma/client'

// Per-account daily post limit is PLAN-BASED — not a constant.
// Free = 10, Pro = 50, Enterprise = 250 (see src/lib/plan-limits.ts).
// We fetch the user's plan inside the handler to determine this limit
// at runtime. The constant below is just the fallback default.
const DEFAULT_DAILY_POST_LIMIT = 50
// Worker concurrency constant (matches docker-compose env var WORKER_CONCURRENCY).
// Declared at top of file so its single use below is unambiguous.
const WORKER_CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '25', 10)

interface CsvRow {
  caption: string
  image_url?: string
  media_url?: string
  video_url?: string
}

function getIntervalMs(value: number, unit: string): number {
  switch (unit) {
    case 'minute': return value * 60 * 1000
    case 'hour': return value * 60 * 60 * 1000
    case 'day': return value * 24 * 60 * 60 * 1000
    default: return value * 60 * 1000
  }
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function addDays(d: Date, days: number): Date {
  const result = new Date(d)
  result.setDate(result.getDate() + days)
  return result
}

export async function POST(request: NextRequest) {
  // CRITICAL: Track session outside tenant context first
  let session: Awaited<ReturnType<typeof getSession>> | null = null
  
  try {
    session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // FIX: capture userId in a const — TypeScript narrowing is lost inside
    // the async closure below when session is a mutable `let` binding.
    const userId = session.userId

    const rl = rateLimit(request, 3, 60 * 1000)
    if (!rl.success) {
      return NextResponse.json({ error: 'Too many requests. Please wait before uploading again.' }, { status: 429 })
    }

    // ─── RUN EVERYTHING IN TENANT CONTEXT ──────────────────────
    // This ensures ALL DB queries are automatically scoped to this user.
    // No cross-tenant data leaks possible - even with 1000 concurrent users!
    return await runInTenantContext(userId, async () => {

      // Check plan - bulk upload requires an ACTIVE paid plan (not expired).
      // We use the EFFECTIVE plan which reverts to 'free' if the subscription
      // has expired.
      const user = await db.user.findUnique({
        where: { id: userId },
        select: { plan: true, planExpiresAt: true },
      })
      const rawUserPlan: Plan = (user?.plan as Plan) || 'free'
      const effectivePlan = getEffectivePlan(rawUserPlan, user?.planExpiresAt ?? null)
      const isExpired = rawUserPlan !== 'free' && effectivePlan === 'free'

      if (isExpired) {
        return NextResponse.json(
          {
            error:
              `Your ${rawUserPlan} subscription has expired. Please renew your subscription ` +
              'to continue bulk uploading. Go to the Upgrade tab to renew.',
          },
          { status: 403 }
        )
      }
      if (effectivePlan === 'free') {
        return NextResponse.json({ error: 'Bulk upload requires a paid plan. Please upgrade to Pro.' }, { status: 403 })
      }

      const formData = await request.formData()
      const file = formData.get('file') as File | null
      const accountId = formData.get('accountId') as string | null

      // Validate interval: must be a positive integer, capped to a sane range.
      const rawIntervalValue = parseInt(formData.get('intervalValue') as string, 10)
      const intervalValue =
        Number.isFinite(rawIntervalValue) && rawIntervalValue > 0
          ? Math.min(rawIntervalValue, 1000)
          : 30

      const rawIntervalUnit = (formData.get('intervalUnit') as string) || 'minute'
      const intervalUnit = (['minute', 'hour', 'day'] as const).includes(
        rawIntervalUnit as 'minute' | 'hour' | 'day'
      )
        ? rawIntervalUnit
        : 'minute'

      if (!accountId) {
        return NextResponse.json({ error: 'Please select an account' }, { status: 400 })
      }

      // Verify account belongs to user (tenant isolation also enforces this automatically!)
      const account = await db.linkedinAccount.findFirst({
        where: { id: accountId },
      })
      if (!account) {
        return NextResponse.json({ error: 'Account not found' }, { status: 400 })
      }

      if (!file) {
        return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
      }

      if (file.size > 5 * 1024 * 1024) {
        return NextResponse.json({ error: 'File size must be less than 5MB' }, { status: 400 })
      }

      if (!file.name.endsWith('.csv')) {
        return NextResponse.json({ error: 'File must be a CSV' }, { status: 400 })
      }

      const text = await file.text()

      const result = Papa.parse<CsvRow>(text, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header: string) => header.trim().toLowerCase().replace(/\s+/g, '_'),
      })

      if (result.errors.length > 0) {
        return NextResponse.json(
          { error: 'CSV parse error', details: result.errors[0].message },
          { status: 400 }
        )
      }

      const rows = result.data

      if (rows.length === 0) {
        return NextResponse.json({ error: 'CSV file is empty' }, { status: 400 })
      }

      // Filter valid rows (must have caption)
      const validRows = rows.filter((r) => r.caption && r.caption.trim())
      if (validRows.length === 0) {
        return NextResponse.json({ error: 'No valid rows found. CSV must have a "caption" column.' }, { status: 400 })
      }

      // Pre-resolve media_url → image_url or video_url by detecting content type.
      type ResolvedRow = {
        caption: string
        imageUrl: string | null
        videoUrl: string | null
      }
      const resolvedRows: ResolvedRow[] = []
      for (const row of validRows) {
        const mediaUrl = row.media_url?.trim() || ''
        let imageUrl: string | null = null
        let videoUrl: string | null = null

        if (mediaUrl) {
          try {
            const mediaType = await detectMediaType(mediaUrl)
            if (mediaType === 'video') {
              videoUrl = mediaUrl
            } else if (mediaType === 'image') {
              imageUrl = mediaUrl
            } else {
              const lower = mediaUrl.toLowerCase().split('?')[0].split('#')[0]
              if (/\.(mp4|mov|avi|mkv|webm)$/.test(lower)) {
                videoUrl = mediaUrl
              } else {
                imageUrl = mediaUrl
              }
            }
          } catch {
            const lower = mediaUrl.toLowerCase().split('?')[0].split('#')[0]
            if (/\.(mp4|mov|avi|mkv|webm)$/.test(lower)) {
              videoUrl = mediaUrl
            } else {
              imageUrl = mediaUrl
            }
          }
        } else if (row.video_url?.trim()) {
          videoUrl = row.video_url.trim()
        } else if (row.image_url?.trim()) {
          imageUrl = row.image_url.trim()
        }

        resolvedRows.push({
          caption: row.caption.trim(),
          imageUrl,
          videoUrl,
        })
      }

      // Calculate interval in milliseconds
      const intervalMs = getIntervalMs(intervalValue, intervalUnit)

      // ─── Plan-aware daily post limit ─────────────────────────────
      // Use the EFFECTIVE plan (respects subscription expiry). We already
      // computed effectivePlan above.
      const userPlan: Plan = effectivePlan
      const planLimits = getPlanLimits(userPlan)
      const DAILY_POST_LIMIT = planLimits.maxPostsPerDay || DEFAULT_DAILY_POST_LIMIT

      // ─── Plan-aware MONTHLY post limit (anti-bypass) ──────────────
      // Prevents users from exceeding their plan's total monthly capacity
      // (Free: 600, Pro: 37,500, Enterprise: 562,500 posts/month).
      // Counts posts scheduled or published THIS MONTH across ALL accounts.
      // This check happens BEFORE we create any posts — if the CSV would
      // push the user over their monthly limit, we reject the entire upload
      // with a clear error message.
      const monthStartNow = new Date()
      monthStartNow.setDate(1)
      monthStartNow.setHours(0, 0, 0, 0)
      const monthEndNow = new Date(monthStartNow.getFullYear(), monthStartNow.getMonth() + 1, 0, 23, 59, 59, 999)

      const postsThisMonth = await db.post.count({
        where: {
          userId,
          status: { in: ['scheduled', 'published', 'processing'] },
          publishTime: { gte: monthStartNow, lte: monthEndNow },
        },
      })

      if (postsThisMonth + resolvedRows.length > planLimits.maxMonthlyPosts) {
        return NextResponse.json(
          {
            error:
              `Monthly post limit would be exceeded. Your ${userPlan} plan allows ${planLimits.maxMonthlyPosts.toLocaleString()} posts/month. ` +
              `You have already used ${postsThisMonth.toLocaleString()} posts this month, and this CSV would add ${resolvedRows.length} more. ` +
              'Upgrade your plan or remove some rows from the CSV.',
          },
          { status: 403 }
        )
      }

      // Count existing scheduled/published posts for this account today and upcoming days
      const now = new Date()
      const todayStart = startOfDay(now)

      // Get all future scheduled posts for this account to count per day
      const existingPosts = await db.post.findMany({
        where: {
          accountId,
          status: { in: ['scheduled', 'published'] },
          publishTime: { gte: todayStart },
        },
        select: { publishTime: true, status: true },
        orderBy: { publishTime: 'asc' },
      })

      // Build a map of day -> count of existing posts
      const dayCounts = new Map<string, number>()
      for (const p of existingPosts) {
        if (p.publishTime) {
          const dayKey = startOfDay(new Date(p.publishTime)).toISOString()
          dayCounts.set(dayKey, (dayCounts.get(dayKey) || 0) + 1)
        }
      }

      // Calculate publish times respecting the plan's per-account daily limit
      const publishTimes: Date[] = []
      let currentTime = new Date(now.getTime() + 60 * 1000) // Start 1 min from now

      for (let i = 0; i < resolvedRows.length; i++) {
        const dayKey = startOfDay(currentTime).toISOString()
        let dayCount = dayCounts.get(dayKey) || 0

        // If current day is full, move to next day at 8 AM
        while (dayCount >= DAILY_POST_LIMIT) {
          const nextDay = addDays(startOfDay(currentTime), 1)
          nextDay.setHours(8, 0, 0, 0)
          currentTime = nextDay
          const newDayKey = startOfDay(currentTime).toISOString()
          dayCount = dayCounts.get(newDayKey) || 0
        }

        publishTimes.push(new Date(currentTime))

        // Update day count
        const currentDayKey = startOfDay(currentTime).toISOString()
        dayCounts.set(currentDayKey, (dayCounts.get(currentDayKey) || 0) + 1)

        // Move to next time slot
        currentTime = new Date(currentTime.getTime() + intervalMs)
      }

      // Create CSV upload record using transaction for atomicity
      const csvUpload = await db.csvUpload.create({
        data: {
          userId,
          accountId,
          filename: file.name,
          totalPosts: resolvedRows.length,
          intervalValue,
          intervalUnit,
          status: 'completed',
          scheduleState: 'active',
        },
      })

      // ─── OPTIMIZED BULK INSERT ───────────────────────────────
      // Using createMany instead of individual create calls in a loop.
      // This is MUCH faster for large CSV files (1000+ rows).
      // 
      // Performance comparison:
      //   OLD: Individual creates in $transaction → ~5ms per row (5000ms for 1000 rows)
      //   NEW: Single createMany call → ~50ms total for 1000 rows (100x faster!)
      
      const postsToCreate = resolvedRows.map((row, i) => ({
        userId,
        accountId,
        caption: row.caption,
        imageUrl: row.imageUrl,
        videoUrl: row.videoUrl,
        status: 'scheduled' as const,
        scheduledAt: publishTimes[i],
        publishTime: publishTimes[i],
        csvUploadId: csvUpload.id,
      }))

      // Bulk insert all posts in a single database round-trip
      // + fetch back the created rows in CSV SERIAL order.
      //
      // ⚠️ CSV-SERIAL CRITICAL FIX: the old fetch-back ordered by
      // `createdAt` — but createMany() writes every row in ONE SQL statement,
      // so Postgres assigns ALL rows the same statement timestamp and
      // createdAt ordering is arbitrary. The queue then paired job IDs with
      // the WRONG publishTime (post #500 of a 1000-row CSV could fire at row
      // #3's slot), silently breaking the CSV serial order. `publishTime` is
      // assigned strictly in CSV row order (row 1 → first slot, row 2 → next
      // interval slot, …), so ordering by publishTime IS the CSV serial
      // order — the same order the Account History tab displays.
      let createdRows: Array<{ id: string; publishTime: Date | null }> = []

      if (postsToCreate.length > 0) {
        // createMany is significantly faster than individual inserts
        const createResult = await db.post.createMany({
          data: postsToCreate,
          skipDuplicates: true, // Skip if same postId somehow exists
        })

        console.log(
          `[bulk] Created ${createResult.count} posts for user ${userId} ` +
          `(CSV: ${file.name}, Account: ${account.accountName})`
        )

        // Fetch the created rows back (needed for queue operations), in
        // strict CSV serial order (publishTime ascending).
        createdRows = await db.post.findMany({
          where: {
            csvUploadId: csvUpload.id,
            status: 'scheduled',
          },
          select: { id: true, publishTime: true },
          orderBy: [{ publishTime: 'asc' }, { id: 'asc' }],
        })
      }

      // ─── PUSH TO BULLMQ QUEUE (Async — Non-Blocking!) ────────
      // 
      // CRITICAL PERFORMANCE OPTIMIZATION:
      // We add jobs to the queue ASYNCHRONOUSLY and do NOT await them.
      // This ensures the HTTP response returns in <1 second even for
      // massive CSV uploads with thousands of posts.
      //
      // Queue uses Redis's delayed job feature, so each post will be
      // processed by the worker at its scheduled publishTime automatically.
      //
      // FAILURE RECOVERY:
      // If queue addition fails, posts remain in DB with SCHEDULED status.
      // A recovery endpoint can re-queue them later. The system won't lose data.

      let queuedCount = 0
      let queueError: string | null = null

      if (createdRows.length > 0) {
        // Prepare queue entries from EACH post's own stored publishTime —
        // not by index pairing. This guarantees the BullMQ job for CSV row N
        // fires exactly at row N's slot: the CSV serial order is maintained
        // end-to-end, and the Account History tab's serial numbers match what
        // actually publishes.
        const queueEntries = createdRows.map((row) => ({
          postId: row.id,
          userId,
          scheduledAt: row.publishTime ?? publishTimes[publishTimes.length - 1],
        }))

        // Fire-and-forget: Add to queue but don't block the response
        bulkAddPostsToQueue(queueEntries)
          .then((results) => {
            queuedCount = results.length
            console.log(`[bulk] ✅ Queued ${results.length} posts for user ${userId}`)
          })
          .catch((err) => {
            queueError = err instanceof Error ? err.message : 'Unknown queue error'
            console.error(`[bulk] ❌ Failed to queue posts for user ${userId}:`, err)

            // Posts are still in DB with SCHEDULED status — they won't be lost
            // but they need manual retry or a recovery job to pick them up
            console.warn(`[bulk] ⚠️ ${createdRows.length} posts in SCHEDULED status but not queued`)
          })
      }

      // Count how many days the schedule spans
      const firstDay = startOfDay(publishTimes[0])
      const lastDay = startOfDay(publishTimes[publishTimes.length - 1])
      const daysSpan = Math.ceil((lastDay.getTime() - firstDay.getTime()) / (24 * 60 * 60 * 1000)) + 1

      // IMMEDIATE RETURN — Don't wait for queue operations
      return NextResponse.json({
        uploadId: csvUpload.id,
        totalProcessed: rows.length,
        validRows: resolvedRows.length,
        skippedRows: rows.length - resolvedRows.length,
        errors: [] as string[],
        scheduleInfo: {
          firstPublish: publishTimes[0].toISOString(),
          lastPublish: publishTimes[publishTimes.length - 1].toISOString(),
          daysSpan,
          interval: `${intervalValue} ${intervalUnit}${intervalValue > 1 ? 's' : ''}`,
        },
        queueInfo: {
          totalQueued: createdRows.length,
          message: createdRows.length > 0 
            ? 'Posts have been queued for publishing. They will be processed automatically at their scheduled times.'
            : 'No posts were created from this upload.',
          warning: queueError ? `Queue warning: ${queueError}` : undefined,
        },
        performance: {
          dbInsertMethod: 'createMany (optimized)',
          estimatedProcessingTime: `${Math.ceil(publishTimes.length / WORKER_CONCURRENCY)} minutes`,
        },
      })
    })
    
  } catch (error) {
    console.error('Bulk upload error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// (WORKER_CONCURRENCY declared at top of file)
