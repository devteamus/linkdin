import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { getEffectivePlan } from '@/lib/plan-helpers'

export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await db.user.findUnique({
      where: { id: session.userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        plan: true,
        planExpiresAt: true,
        planRenewedAt: true,
        createdAt: true,
      },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Compute the EFFECTIVE plan (respects expiry) so the client UI
    // can immediately show "expired" state without a separate API call.
    const effectivePlan = getEffectivePlan(user.plan, user.planExpiresAt)
    const isExpired = user.plan !== 'free' && effectivePlan === 'free'

    return NextResponse.json({
      user: {
        ...user,
        planExpiresAt: user.planExpiresAt?.toISOString() ?? null,
        planRenewedAt: user.planRenewedAt?.toISOString() ?? null,
        effectivePlan,
        isExpired,
      },
    })
  } catch (error) {
    console.error('Get me error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
