import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'
import { PLAN_PRICES } from '@/lib/plan-limits'

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

    const user = await db.user.findUnique({ where: { email: session.email } })
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Count users grouped by plan (free / pro / enterprise)
    const [totalUsers, totalPosts, totalAccounts, proCount, enterpriseCount, recentUsers] =
      await Promise.all([
        db.user.count({ where: { role: 'user' } }),
        db.post.count(),
        db.linkedinAccount.count(),
        db.user.count({ where: { plan: 'pro' } }),
        db.user.count({ where: { plan: 'enterprise' } }),
        db.user.findMany({
          where: { role: 'user' },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            name: true,
            email: true,
            plan: true,
            role: true,
            createdAt: true,
          },
        }),
      ])

    // Revenue = proCount * $49 + enterpriseCount * $149
    const totalRevenue =
      proCount * PLAN_PRICES.pro + enterpriseCount * PLAN_PRICES.enterprise

    return NextResponse.json({
      totalUsers,
      totalPosts,
      totalAccounts,
      totalRevenue,
      proUsers: proCount,
      enterpriseUsers: enterpriseCount,
      recentUsers: recentUsers.map((u) => ({
        ...u,
        createdAt: u.createdAt.toISOString(),
      })),
    })
  } catch (error) {
    console.error('Admin stats error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
