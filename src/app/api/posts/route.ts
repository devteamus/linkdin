import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { singlePostSchema } from '@/lib/validations'
import { rateLimit } from '@/lib/rate-limit'
import { addPostToQueue } from '@/lib/queue'
import { PostStatus } from '@prisma/client'
import { getPlanLimits } from '@/lib/plan-limits'
import { getEffectivePlan } from '@/lib/plan-helpers'
import type { Plan } from '@prisma/client'

export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const rl = rateLimit(request, 30, 60 * 1000)
    if (!rl.success) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const body = await request.json()
    const parsed = singlePostSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { accountId, caption, imageUrl, videoUrl, publishTime } = parsed.data

    // Verify account belongs to user
    const account = await db.linkedinAccount.findUnique({
      where: { id: accountId },
    })

    if (!account || account.userId !== session.userId) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    // ─── Plan-aware daily post limit enforcement (respects expiry) ──
    // If the user's subscription has expired, they're treated as 'free'.
    const user = await db.user.findUnique({
      where: { id: session.userId },
      select: { plan: true, planExpiresAt: true },
    })
    const rawPlan: Plan = (user?.plan as Plan) || 'free'
    const userPlan = getEffectivePlan(rawPlan, user?.planExpiresAt ?? null)
    const isExpired = rawPlan !== 'free' && userPlan === 'free'
    const planLimits = getPlanLimits(userPlan)
    const perDayLimit = planLimits.maxPostsPerDay

    // ─── Block posting for expired subscriptions ───────────────────
    // Paid users whose subscription has expired cannot create new posts
    // until they renew. (Free users can still post — they never expire.)
    if (isExpired) {
      return NextResponse.json(
        {
          error:
            `Your ${rawPlan} subscription has expired. Please renew your subscription ` +
            'to continue posting. Go to the Upgrade tab to renew.',
        },
        { status: 403 }
      )
    }

    const targetDate = publishTime ? new Date(publishTime) : new Date()
    const dayStart = new Date(targetDate)
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(targetDate)
    dayEnd.setHours(23, 59, 59, 999)

    const postsOnSameDay = await db.post.count({
      where: {
        accountId,
        status: { in: ['scheduled', 'published'] },
        publishTime: { gte: dayStart, lte: dayEnd },
      },
    })

    if (postsOnSameDay >= perDayLimit) {
      return NextResponse.json(
        {
          error:
            `Daily post limit reached for this account: ${perDayLimit} posts/day ` +
            `(your ${userPlan} plan). Try a different day or upgrade your plan.`,
        },
        { status: 403 }
      )
    }

    // ─── Plan-aware MONTHLY post limit enforcement ─────────────────
    // Prevents users from exceeding their plan's total monthly capacity
    // (Free: 600, Pro: 37,500, Enterprise: 562,500 posts/month).
    // Counts posts scheduled or published THIS MONTH across ALL accounts.
    const monthStart = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1)
    const monthEnd = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0, 23, 59, 59, 999)

    const postsThisMonth = await db.post.count({
      where: {
        userId: session.userId,
        status: { in: ['scheduled', 'published', 'processing'] },
        publishTime: { gte: monthStart, lte: monthEnd },
      },
    })

    if (postsThisMonth >= planLimits.maxMonthlyPosts) {
      return NextResponse.json(
        {
          error:
            `Monthly post limit reached: ${planLimits.maxMonthlyPosts.toLocaleString()} posts/month ` +
            `(your ${userPlan} plan). You have used ${postsThisMonth.toLocaleString()} posts this month. ` +
            'Upgrade your plan or wait until next month.',
        },
        { status: 403 }
      )
    }

    // Determine status and publish time
    let status: PostStatus = PostStatus.pending
    let publishTimeDate: Date | null = null

    if (publishTime) {
      publishTimeDate = new Date(publishTime)
      if (publishTimeDate > new Date()) {
        status = PostStatus.scheduled
      }
    }

    const post = await db.post.create({
      data: {
        userId: session.userId,
        accountId,
        caption,
        imageUrl: imageUrl || null,
        videoUrl: videoUrl || null,
        status,
        scheduledAt: publishTimeDate,
        publishTime: publishTimeDate,
      },
      include: {
        account: {
          select: { accountName: true },
        },
      },
    })

    // FIX: queue scheduled single posts so the BullMQ worker actually
    // publishes them. Previously they were saved with SCHEDULED status but
    // never added to the queue, so they silently never published.
    let queueWarning: string | undefined
    if (post.status === PostStatus.scheduled && publishTimeDate) {
      try {
        await addPostToQueue(post.id, session.userId, publishTimeDate)
      } catch (queueErr) {
        console.error('Failed to queue scheduled post:', queueErr)
        queueWarning = 'Post saved but could not be queued. Use the recover-queue endpoint to retry.'
      }
    }

    return NextResponse.json({
      post: {
        ...post,
        accountName: post.account.accountName,
        account: undefined,
      },
      ...(queueWarning ? { warning: queueWarning } : {}),
    }, { status: 201 })
  } catch (error) {
    console.error('Create post error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const rl = rateLimit(request, 60, 60 * 1000)
    if (!rl.success) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)))
    const skip = (page - 1) * limit

    const where: Record<string, unknown> = { userId: session.userId }
    if (status) {
      where.status = status
    }

    const [posts, total] = await Promise.all([
      db.post.findMany({
        where,
        include: {
          account: {
            select: { accountName: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      db.post.count({ where }),
    ])

    const postsWithAccountName = posts.map((post) => ({
      ...post,
      accountName: post.account.accountName,
      account: undefined,
    }))

    return NextResponse.json({ posts: postsWithAccountName, total, page, limit })
  } catch (error) {
    console.error('Get posts error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
