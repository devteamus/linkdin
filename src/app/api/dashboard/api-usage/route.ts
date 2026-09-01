import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { getPlanLimits } from '@/lib/plan-limits'
import { getEffectivePlan } from '@/lib/plan-helpers'
import type { Plan } from '@prisma/client'

/**
 * Returns the user's LinkedIn API usage for the last 24 hours.
 *
 * Per-plan API call budget (displayed + enforced by us):
 *   - Free:        150 calls / 24h per account  (LinkedIn's hard limit)
 *   - Pro:         150 calls / 24h per account  (LinkedIn's hard limit)
 *   - Enterprise:  500 calls / 24h per account  (elevated budget for power users)
 *
 * Per-plan posts/day limits:
 *   - Free:        10 posts/day/account
 *   - Pro:         50 posts/day/account
 *   - Enterprise: 250 posts/day/account
 *
 * Scoping:
 *   - `?accountId=<id>` given  → usage + limit for that ONE account
 *   - no accountId ("All accounts") → usage summed across every connected
 *     account, and the LIMIT is multiplied by how many accounts are connected
 *
 * The dashboard shows:
 *   - apiCallsUsed:     count of calls in the last 24h (scoped as above)
 *   - apiCallsLimit:    plan-based per-account value × connectedAccounts (or 1 for single account)
 *   - apiCallsRemaining: apiCallsLimit - used
 *   - postsPublishedToday: how many posts were actually published today
 *   - postsDailyLimit: per-plan per-account value × connectedAccounts (or 1)
 *   - resetTime: ISO timestamp when the 24h window resets
 *   - plan: the user's current plan
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = request.nextUrl.searchParams.get('accountId') || undefined

    // If an accountId was requested, verify it actually belongs to this user
    if (accountId) {
      const owned = await db.linkedinAccount.findFirst({
        where: { id: accountId, userId: session.userId },
        select: { id: true },
      })
      if (!owned) {
        return NextResponse.json({ error: 'LinkedIn account not found' }, { status: 404 })
      }
    }

    // ─── Plan-aware per-account limits (respects subscription expiry) ──
    const user = await db.user.findUnique({
      where: { id: session.userId },
      select: { plan: true, planExpiresAt: true },
    })
    const rawPlan = (user?.plan as Plan) || 'free'
    const planExpiresAt = user?.planExpiresAt ?? null
    const userPlan = getEffectivePlan(rawPlan, planExpiresAt)
    const isExpired = rawPlan !== 'free' && userPlan === 'free'
    const planLimits = getPlanLimits(userPlan)
    const PER_ACCOUNT_API_CALLS_LIMIT = planLimits.maxApiCallsPerDay
    const PER_ACCOUNT_POSTS_DAILY_LIMIT = planLimits.maxPostsPerDay

    const now = new Date()
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)

    // "All accounts" view → each connected account has its own independent
    // LinkedIn quota, so the combined limit scales with account count.
    let apiCallsLimit = PER_ACCOUNT_API_CALLS_LIMIT
    let postsDailyLimit = PER_ACCOUNT_POSTS_DAILY_LIMIT
    if (!accountId) {
      const connectedAccounts = await db.linkedinAccount.count({ where: { userId: session.userId } })
      apiCallsLimit = PER_ACCOUNT_API_CALLS_LIMIT * connectedAccounts
      postsDailyLimit = PER_ACCOUNT_POSTS_DAILY_LIMIT * connectedAccounts
    }

    // Count LinkedIn API calls in the last 24h
    const apiCallsUsed = await db.apiUsageLog.count({
      where: {
        userId: session.userId,
        ...(accountId ? { accountId } : {}),
        createdAt: { gte: twentyFourHoursAgo },
      },
    })

    // Count posts published today
    const postsPublishedToday = await db.post.count({
      where: {
        userId: session.userId,
        ...(accountId ? { accountId } : {}),
        status: 'published',
        updatedAt: { gte: todayStart },
      },
    })

    // ─── Monthly post count (for Overview monthly capacity card) ────
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const postsThisMonth = await db.post.count({
      where: {
        userId: session.userId,
        status: { in: ['scheduled', 'published', 'processing'] },
        publishTime: { gte: monthStart },
      },
    })

    // Find the oldest API call within the 24h window for reset time
    const oldestCall = await db.apiUsageLog.findFirst({
      where: {
        userId: session.userId,
        ...(accountId ? { accountId } : {}),
        createdAt: { gte: twentyFourHoursAgo },
      },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    })

    const resetTime = oldestCall
      ? new Date(oldestCall.createdAt.getTime() + 24 * 60 * 60 * 1000)
      : new Date(now.getTime() + 24 * 60 * 60 * 1000)

    return NextResponse.json({
      accountId: accountId || null,
      plan: userPlan,
      rawPlan,
      isExpired,
      planExpiresAt: planExpiresAt?.toISOString() ?? null,
      apiCallsUsed,
      apiCallsLimit,
      apiCallsRemaining: Math.max(0, apiCallsLimit - apiCallsUsed),
      postsPublishedToday,
      postsDailyLimit,
      postsRemainingToday: Math.max(0, postsDailyLimit - postsPublishedToday),
      // ─── Monthly capacity ───
      postsThisMonth,
      monthlyPostsLimit: planLimits.maxMonthlyPosts,
      postsRemainingThisMonth: Math.max(0, planLimits.maxMonthlyPosts - postsThisMonth),
      resetTime: resetTime.toISOString(),
      windowStart: (oldestCall?.createdAt || twentyFourHoursAgo).toISOString(),
    })
  } catch (error) {
    console.error('API usage error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
