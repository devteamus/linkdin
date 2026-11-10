import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { publishToLinkedIn } from '@/lib/linkedin-publish'
import { rateLimit } from '@/lib/rate-limit'
import { PostStatus } from '@prisma/client'

/**
 * Manually publish a post to LinkedIn NOW (overrides the scheduled time).
 *
 * Bug #3 completion — ATOMIC CLAIM: before publishing, the post is claimed
 * with ONE conditional updateMany (scheduled/pending/failed → processing).
 * The BullMQ worker uses the exact same claim, so if the post's scheduled
 * time arrives WHILE the user is clicking "Publish Now" (or vice versa),
 * exactly one of the two publishers wins and the other gets a 409 — the
 * same post can never be published twice.
 *
 * All rate limiting still applies (it lives inside publishToLinkedIn:
 * per-member atomic limiter, 24h budget, 429 Retry-After), so this manual
 * path is fully protected too.
 *
 * Supports the new optional fields:
 *   - videoUrl: publishes as a video post
 *
 * Auto-commenting was intentionally removed — it requires LinkedIn's
 * Community Management API product access, which this app does not have.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const rl = rateLimit(request, 30, 60 * 1000)
    if (!rl.success) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const { id } = await params

    const post = await db.post.findUnique({
      where: { id },
      include: {
        account: {
          select: {
            id: true,
            accessToken: true,
            linkedinMemberId: true,
            accountName: true,
            isActive: true,
          },
        },
      },
    })

    if (!post || post.userId !== session.userId) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }

    if (post.status === PostStatus.published) {
      return NextResponse.json({ error: 'Post already published' }, { status: 400 })
    }

    if (!post.account.isActive) {
      return NextResponse.json(
        { error: 'LinkedIn account is deactivated. Reconnect the account first.' },
        { status: 400 }
      )
    }

    // ─── ATOMIC CLAIM (Bug #3 completion) ────────────────────────────
    // Identical to the worker's Step 5: only a post still in
    // scheduled/pending/failed can be claimed. If the worker already
    // grabbed it (status = processing) or it was just published, count === 0
    // and we refuse — worker + manual publish can never double-post a row.
    const claim = await db.post.updateMany({
      where: {
        id,
        status: { in: [PostStatus.scheduled, PostStatus.pending, PostStatus.failed] },
      },
      data: {
        status: PostStatus.processing,
        scheduledAt: new Date(),
      },
    })

    if (claim.count === 0) {
      return NextResponse.json(
        {
          error:
            'This post is currently being published by the scheduler (or was just published). ' +
            'Please refresh and try again in a moment.',
        },
        { status: 409 }
      )
    }

    // Actually call LinkedIn to publish the post
    let postUrn = ''
    try {
      const result = await publishToLinkedIn(
        post.account.accessToken,
        post.account.linkedinMemberId,
        post.caption,
        post.imageUrl,
        post.videoUrl,
        post.userId,
        post.account.id
      )
      postUrn = result.postUrn
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      // Persist the error so the user sees it in the dashboard.
      // NOTE: this catch can only run AFTER a successful claim above, so the
      // post is currently 'processing' — setting it back to 'failed' here is
      // safe (the worker's atomic claim will refuse any racing duplicate job).
      await db.post.update({
        where: { id },
        data: { status: PostStatus.failed, error: errorMessage.slice(0, 500) },
      })
      return NextResponse.json({ error: errorMessage }, { status: 502 })
    }

    // Mark as published
    const updated = await db.post.update({
      where: { id },
      data: {
        status: PostStatus.published,
        error: null,
        publishTime: post.publishTime ?? new Date(),
        linkedinPostUrn: postUrn,
      },
      include: {
        account: {
          select: { accountName: true },
        },
      },
    })

    // Note: auto-commenting is intentionally NOT implemented — it requires
    // LinkedIn's Community Management API product access, which this app
    // does not have. Every attempt returns 404 regardless of URN format.

    const postResponse = {
      ...updated,
      accountName: updated.account.accountName,
      account: undefined,
    }

    return NextResponse.json({ post: postResponse })
  } catch (error) {
    console.error('Publish post error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
