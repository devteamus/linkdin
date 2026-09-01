import { NextRequest, NextResponse } from 'next/server'
import type { Plan } from '@prisma/client'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'
import { calculateRenewalExpiry } from '@/lib/plan-helpers'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const rl = rateLimit(request, 20, 60 * 1000)
    if (!rl.success) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const admin = await db.user.findUnique({ where: { email: session.email } })
    if (!admin || admin.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await context.params
    const body = await request.json()
    const { action } = body // 'verify' or 'reject'

    if (!action || !['verify', 'reject'].includes(action)) {
      return NextResponse.json({ error: 'Action must be verify or reject' }, { status: 400 })
    }

    const payment = await db.payment.findUnique({ where: { id } })
    if (!payment) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    }

    if (payment.status === 'verified' || payment.status === 'rejected') {
      return NextResponse.json({ error: `Payment already ${payment.status}` }, { status: 400 })
    }

    if (action === 'verify') {
      // ─── Set subscription expiry (30 days, extended on renewal) ───
      // Fetch the target user's current expiry so we can extend it if
      // they're renewing an active subscription.
      const targetUser = await db.user.findUnique({
        where: { id: payment.userId },
        select: { planExpiresAt: true },
      })
      const newExpiry = calculateRenewalExpiry(targetUser?.planExpiresAt ?? null)

      await db.$transaction([
        db.payment.update({
          where: { id },
          data: {
            status: 'verified',
            verifiedAt: new Date(),
            verifiedBy: admin.email,
          },
        }),
        db.user.update({
          where: { id: payment.userId },
          data: {
            plan: payment.plan as Plan,
            planExpiresAt: newExpiry,
            planRenewedAt: new Date(),
          },
        }),
      ])

      return NextResponse.json({
        success: true,
        message: `Payment verified and plan activated. Active until ${newExpiry.toLocaleDateString()}.`,
      })
    } else {
      await db.payment.update({
        where: { id },
        data: {
          status: 'rejected',
          verifiedBy: admin.email,
        },
      })

      return NextResponse.json({ success: true, message: 'Payment rejected' })
    }
  } catch (error) {
    console.error('Admin payment action error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
