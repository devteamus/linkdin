import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payments = await db.payment.findMany({
      where: { userId: session.userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        method: true,
        amount: true,
        txHash: true,
        transactionId: true,
        status: true,
        plan: true,
        verifiedAt: true,
        createdAt: true,
      },
    })

    return NextResponse.json({
      payments: payments.map((p) => ({
        ...p,
        createdAt: p.createdAt.toISOString(),
        verifiedAt: p.verifiedAt?.toISOString() || null,
      })),
    })
  } catch (error) {
    console.error('Payment history error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
