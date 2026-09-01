import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { publishToLinkedIn } from '@/lib/linkedin-publish'
import { rateLimit } from '@/lib/rate-limit'
import { PostStatus } from '@prisma/client'

/**
 * Manually publish a post to LinkedIn NOW (overrides the scheduled time).
 *
 * This is also called internally by the cron worker when a post's
 * scheduled time arrives. Manual publish is for "publish immediately" use cases.
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
      // Persist the error so the user sees it in the dashboard
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
