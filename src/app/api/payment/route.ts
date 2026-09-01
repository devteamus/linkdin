import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { createPaymentSchema, txHashSchema } from '@/lib/validations'
import { rateLimit } from '@/lib/rate-limit'
import { PLAN_PRICES } from '@/lib/plan-limits'

export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const rl = rateLimit(request, 5, 60 * 1000)
    if (!rl.success) {
      return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
    }

    const body = await request.json()
    const parsed = createPaymentSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { method, amount, plan, txHash, transactionId } = parsed.data

    // Check if user already has a paid plan
    const user = await db.user.findUnique({ where: { id: session.userId } })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // ─── Validate amount matches the chosen plan's price ─────────────
    // Pro = $49, Enterprise = $149. Users cannot pay a custom amount.
    const expectedPrice = PLAN_PRICES[plan]
    if (amount !== expectedPrice) {
      return NextResponse.json(
        {
          error: `The ${plan} plan costs $${expectedPrice} USD. Please submit exactly $${expectedPrice}.`,
        },
        { status: 400 }
      )
    }

    // For USDT, require txHash; for Binance, require transactionId
    if (method === 'usdt') {
      if (!txHash) {
        return NextResponse.json({ error: 'Transaction hash is required for USDT payment' }, { status: 400 })
      }
      // Validate txHash format
      const hashCheck = txHashSchema.safeParse(txHash)
      if (!hashCheck.success) {
        return NextResponse.json({ error: 'Invalid transaction hash format' }, { status: 400 })
      }
    }
    if (method === 'binance' && !transactionId) {
      return NextResponse.json({ error: 'Transaction ID is required for Binance payment' }, { status: 400 })
    }

    // Create payment record
    const payment = await db.payment.create({
      data: {
        userId: session.userId,
        method,
        amount,
        txHash: txHash || null,
        transactionId: transactionId || null,
        status: method === 'usdt' ? 'pending' : 'pending_manual',
        plan,
      },
    })

    return NextResponse.json({
      payment: {
        id: payment.id,
        method: payment.method,
        amount: payment.amount,
        status: payment.status,
        plan: payment.plan,
        createdAt: payment.createdAt.toISOString(),
      },
    }, { status: 201 })
  } catch (error) {
    console.error('Create payment error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
