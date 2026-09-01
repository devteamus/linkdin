import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'

export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const rl = rateLimit(request, 30, 60 * 1000)
    if (!rl.success) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const admin = await db.user.findUnique({ where: { email: session.email } })
    if (!admin || admin.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') || 'pending_manual'
    const page = Math.max(1, Number(searchParams.get('page')) || 1)
    const limit = Math.min(50, Math.max(1, Number(searchParams.get('limit')) || 20))

    const where: Record<string, unknown> = { status }

    const [payments, total] = await Promise.all([
      db.payment.findMany({
        where,
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.payment.count({ where }),
    ])

    return NextResponse.json({
      payments: payments.map((p) => ({
        id: p.id,
        method: p.method,
        amount: p.amount,
        txHash: p.txHash,
        transactionId: p.transactionId,
        status: p.status,
        plan: p.plan,
        verifiedAt: p.verifiedAt?.toISOString() || null,
        createdAt: p.createdAt.toISOString(),
        user: p.user,
      })),
      total,
      page,
      limit,
    })
  } catch (error) {
    console.error('Admin payments list error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
