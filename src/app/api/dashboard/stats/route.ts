import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { getPlanLimits } from '@/lib/plan-limits'
import { getEffectivePlan } from '@/lib/plan-helpers'
import type { Plan } from '@prisma/client'

export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = request.nextUrl.searchParams.get('accountId') || undefined

    // Verify ownership before using a client-supplied accountId in any query.
    if (accountId) {
      const owned = await db.linkedinAccount.findFirst({
        where: { id: accountId, userId: session.userId },
        select: { id: true },
      })
      if (!owned) {
        return NextResponse.json({ error: 'LinkedIn account not found' }, { status: 404 })
      }
    }

    // ─── Plan-aware limits (respects subscription expiry) ──────────
    const user = await db.user.findUnique({
      where: { id: session.userId },
      select: { plan: true, planExpiresAt: true },
    })
    const rawPlan = (user?.plan as Plan) || 'free'
    const planExpiresAt = user?.planExpiresAt ?? null
    // The EFFECTIVE plan reverts to 'free' if the subscription has expired.
    const userPlan = getEffectivePlan(rawPlan, planExpiresAt)
    const isExpired = rawPlan !== 'free' && userPlan === 'free'
    const planLimits = getPlanLimits(userPlan)

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const twentyFourHoursAgo = new Date(new Date().getTime() - 24 * 60 * 60 * 1000)
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)

    const [
      totalAccounts,
      todayPosts,
      scheduledPosts,
      failedPosts,
      apiCallsUsed,
      postsThisMonth,
      // ─── Lifetime unique accounts ever connected (anti-cycling) ───
      // Counts DISTINCT linkedinMemberId from AccountConnectionLog so
      // disconnecting+reconnecting fresh accounts can't bypass the plan's
      // max-accounts limit.
      uniqueAccountsConnected,
    ] = await Promise.all([
      db.linkedinAccount.count({ where: { userId: session.userId } }),
      db.post.count({
        where: {
          userId: session.userId,
          ...(accountId ? { accountId } : {}),
          createdAt: { gte: today },
        },
      }),
      db.post.count({
        where: {
          userId: session.userId,
          ...(accountId ? { accountId } : {}),
          status: 'scheduled',
        },
      }),
      db.post.count({
        where: {
          userId: session.userId,
          ...(accountId ? { accountId } : {}),
          status: 'failed',
        },
      }),
      db.apiUsageLog.count({
        where: {
          userId: session.userId,
          ...(accountId ? { accountId } : {}),
          createdAt: { gte: twentyFourHoursAgo },
        },
      }),
      // Posts scheduled or published THIS MONTH (for monthly capacity card)
      db.post.count({
        where: {
          userId: session.userId,
          status: { in: ['scheduled', 'published', 'processing'] },
          publishTime: { gte: monthStart },
        },
      }),
      // Distinct lifetime accounts — raw SQL for DISTINCT COUNT
      db.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(DISTINCT "linkedinMemberId")::bigint as count
        FROM "AccountConnectionLog"
        WHERE "userId" = ${session.userId}
      `,
    ])

    const PER_ACCOUNT_API_CALLS_LIMIT = planLimits.maxApiCallsPerDay
    const PER_ACCOUNT_POSTS_DAILY_LIMIT = planLimits.maxPostsPerDay
    const multiplier = accountId ? 1 : totalAccounts
    const apiCallsLimit = PER_ACCOUNT_API_CALLS_LIMIT * multiplier
    const postsDailyLimit = PER_ACCOUNT_POSTS_DAILY_LIMIT * multiplier

    return NextResponse.json({
      accountId: accountId || null,
      // The EFFECTIVE plan (respects expiry). For display + limit enforcement.
      plan: userPlan,
      // The RAW plan the user purchased (Pro/Enterprise) — used by the UI
      // to show "Pro (expired)" state and prompt renewal.
      rawPlan,
      isExpired,
      // ─── Subscription expiry (for countdown display) ───
      planExpiresAt: planExpiresAt?.toISOString() ?? null,
      todayPosts,
      totalAccounts,
      // ─── Lifetime unique account tracking (for anti-cycling display) ───
      uniqueAccountsConnected: Number(uniqueAccountsConnected[0]?.count ?? 0),
      maxAccounts: planLimits.maxAccounts,
      scheduledPosts,
      failedPosts,
      // ─── API usage summary ───
      apiCallsUsed,
      apiCallsLimit,
      postsDailyLimit,
      // ─── Monthly capacity summary ───
      postsThisMonth,
      monthlyPostsLimit: planLimits.maxMonthlyPosts,
      postsRemainingThisMonth: Math.max(0, planLimits.maxMonthlyPosts - postsThisMonth),
    })
  } catch (error) {
    console.error('Dashboard stats error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
