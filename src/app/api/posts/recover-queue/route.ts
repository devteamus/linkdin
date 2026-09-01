import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db, runInTenantContext } from '@/lib/db'
import { bulkAddPostsToQueue } from '@/lib/queue'

/**
 * POST /api/posts/recover-queue
 * 
 * RECOVERY ENDPOINT for posts stuck in SCHEDULED status.
 * 
 * This can happen if:
 *   - The queue was down when posts were created
 *   - A network error occurred during queue addition
 *   - The worker crashed mid-processing
 *   - Redis had a temporary failure
 * 
 * Usage:
 *   POST /api/posts/recover-queue
 *   Body: { "csvUploadId": "optional - recover specific upload" }
 * 
 * Response:
 *   {
 *     "recovered": 15,
 *     "alreadyQueued": 100,
 *     "skipped": 5
 *   }
 * 
 * Security: Requires authentication + tenant isolation
 */

export async function POST(request: NextRequest) {
  let session: Awaited<ReturnType<typeof getSession>> | null = null
  
  try {
    session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // FIX: capture userId — TS narrowing is lost inside async closures
    const userId = session.userId

    return await runInTenantContext(userId, async () => {
      const body = await request.json().catch(() => ({}))
      const csvUploadId = body.csvUploadId as string | undefined

      // Find all posts in SCHEDULED status that might need recovery
      // These are posts that are in the DB but may not be in the queue
      const whereClause: Record<string, unknown> = {
        userId,
        status: 'scheduled',
      }
      
      // Optionally filter by specific CSV upload
      if (csvUploadId) {
        whereClause.csvUploadId = csvUploadId
      }
      
      // Only recover posts scheduled within the last 7 days
      // (older posts are likely abandoned)
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      whereClause.scheduledAt = { gte: sevenDaysAgo }

      const scheduledPosts = await db.post.findMany({
        where: whereClause,
        select: {
          id: true,
          publishTime: true,
          scheduledAt: true,
          accountId: true,
          createdAt: true,
          csvUploadId: true,
        },
        orderBy: { publishTime: 'asc' },
        take: 1000, // Safety limit per recovery operation
      })

      if (scheduledPosts.length === 0) {
        return NextResponse.json({
          recovered: 0,
          alreadyQueued: 0,
          skipped: 0,
          message: 'No posts found that need recovery.',
        })
      }

      // Attempt to re-queue all scheduled posts
      const queueEntries = scheduledPosts.map(post => ({
        postId: post.id,
        userId,
        scheduledAt: post.publishTime || post.scheduledAt || new Date(),
      }))

      let queuedCount = 0
      let failedCount = 0

      try {
        const results = await bulkAddPostsToQueue(queueEntries)
        queuedCount = results.length
        
        console.log(
          `[recover] ✅ Re-queued ${results.length} posts for user ${userId}` +
          (csvUploadId ? ` (upload: ${csvUploadId})` : '')
        )
      } catch (error) {
        failedCount = queueEntries.length
        console.error(`[recover] ❌ Failed to re-queue posts:`, error)
        
        return NextResponse.json({
          recovered: 0,
          alreadyQueued: 0,
          skipped: scheduledPosts.length,
          error: error instanceof Error ? error.message : 'Failed to add to queue',
        }, { status: 500 })
      }

      return NextResponse.json({
        recovered: queuedCount,
        alreadyQueued: 0, // We don't track this precisely without checking Redis
        skipped: failedCount,
        message: `Successfully recovered ${queuedCount} posts. They will be processed at their scheduled times.`,
        details: {
          totalFound: scheduledPosts.length,
          timeRange: {
            from: scheduledPosts[0]?.publishTime?.toISOString() || 'N/A',
            to: scheduledPosts[scheduledPosts.length - 1]?.publishTime?.toISOString() || 'N/A',
          },
        },
      })
    })
    
  } catch (error) {
    console.error('Queue recovery error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * GET /api/posts/recover-queue/status
 * 
 * Check how many posts might need recovery (in SCHEDULED status).
 */
export async function GET(request: NextRequest) {
  let session: Awaited<ReturnType<typeof getSession>> | null = null
  
  try {
    session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.userId

    return await runInTenantContext(userId, async () => {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

      const [scheduledCount, byStatus] = await Promise.all([
        db.post.count({
          where: {
            userId,
            status: 'scheduled',
            scheduledAt: { gte: sevenDaysAgo },
          },
        }),
        db.post.groupBy({
          by: ['status'],
          where: {
            userId,
            scheduledAt: { gte: sevenDaysAgo },
          },
          _count: true,
        }),
      ])

      return NextResponse.json({
        potentiallyNeedsRecovery: scheduledCount,
        breakdown: byStatus.reduce((acc, item) => ({
          ...acc,
          [item.status.toLowerCase()]: item._count,
        }), {} as Record<string, number>),
        recommendation: scheduledCount > 10 
          ? 'Consider running POST /api/posts/recover-queue to ensure all posts are properly queued.'
          : 'All posts appear to be processed or queued correctly.',
      })
    })
    
  } catch (error) {
    console.error('Queue status check error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
