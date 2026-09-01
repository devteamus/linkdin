import { NextRequest, NextResponse } from 'next/server'
import type { Plan } from '@prisma/client'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'
import { PLAN_PRICES } from '@/lib/plan-limits'
import { calculateRenewalExpiry } from '@/lib/plan-helpers'

export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const rl = rateLimit(request, 10, 60 * 1000)
    if (!rl.success) {
      return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
    }

    const USDT_WALLET = process.env.USDT_WALLET_ADDRESS
    if (!USDT_WALLET) {
      console.error('FATAL: USDT_WALLET_ADDRESS env var not set')
      return NextResponse.json({ error: 'USDT payment not configured' }, { status: 500 })
    }

    const body = await request.json()
    const { paymentId } = body

    if (!paymentId) {
      return NextResponse.json({ error: 'Payment ID is required' }, { status: 400 })
    }

    // Find the payment
    const payment = await db.payment.findUnique({ where: { id: paymentId } })
    if (!payment || payment.userId !== session.userId) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    }

    if (payment.method !== 'usdt') {
      return NextResponse.json({ error: 'This is not a USDT payment' }, { status: 400 })
    }

    if (payment.status === 'verified') {
      return NextResponse.json({ error: 'Payment already verified' }, { status: 400 })
    }

    // Check for duplicate txHash (payment replay protection)
    if (payment.txHash) {
      const existingPayment = await db.payment.findFirst({
        where: { txHash: payment.txHash, status: 'verified' },
      })
      if (existingPayment && existingPayment.id !== payment.id) {
        return NextResponse.json({ error: 'This transaction has already been used for another payment' }, { status: 400 })
      }
    } else {
      return NextResponse.json({ error: 'No transaction hash found' }, { status: 400 })
    }

    // Use Tron API to verify the transaction
    const tronApiKey = process.env.TRON_API_KEY
    if (!tronApiKey) {
      return NextResponse.json({ error: 'USDT verification is not configured. Please try Binance Pay or contact support.' }, { status: 500 })
    }

    // Get transaction info from Tron API
    const txResponse = await fetch(
      `https://apilist.tronscanapi.com/api/transaction-info?txHash=${payment.txHash}`,
      {
        headers: {
          'TRON-PRO-API-KEY': tronApiKey,
        },
      }
    )

    if (!txResponse.ok) {
      console.error('Tron API error:', txResponse.status)
      return NextResponse.json({ error: 'Failed to verify transaction. Please try again later.' }, { status: 502 })
    }

    const txData = await txResponse.json()

    // Validate transaction
    if (txData.code !== 'SUCCESS' || !txData.contract) {
      return NextResponse.json({ error: 'Transaction not found or failed on blockchain' }, { status: 400 })
    }

    // Find TRC20 transfer contract
    const trc20Contract = Array.isArray(txData.contract)
      ? txData.contract.find((c: { type?: string }) => c.type === 'TriggerSmartContract')
      : txData.contract.type === 'TriggerSmartContract' ? txData.contract : null

    if (!trc20Contract) {
      return NextResponse.json({ error: 'Not a valid TRC20 transfer' }, { status: 400 })
    }

    // ── Strict recipient + amount verification ──────────────────────────
    // SECURITY: this is the ONLY check that determines whether the payment
    // actually reached our wallet. It must be unconditional — do NOT add
    // any "OR" branch that can short-circuit past a wallet mismatch.
    //
    // We require tokenTransferInfo to contain a USDT (TRC20) transfer whose
    // to_address matches our configured wallet exactly. If tokenTransferInfo
    // is missing, or no entry matches both the USDT contract AND our wallet,
    // the payment is rejected — no fallback path exists.
    const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'

    if (!txData.tokenTransferInfo) {
      return NextResponse.json({ error: 'Could not read token transfer details for this transaction' }, { status: 400 })
    }

    const transfers: Array<{ to_address?: string; contract_address?: string; amount_str?: string }> =
      Array.isArray(txData.tokenTransferInfo) ? txData.tokenTransferInfo : [txData.tokenTransferInfo]

    const matchedTransfer = transfers.find(
      (t) =>
        t.contract_address === USDT_CONTRACT &&
        typeof t.to_address === 'string' &&
        t.to_address.toLowerCase() === USDT_WALLET.toLowerCase()
    )

    if (!matchedTransfer) {
      return NextResponse.json({ error: 'Payment was not sent to the correct wallet address' }, { status: 400 })
    }

    const receivedAmount = parseFloat(matchedTransfer.amount_str || '0') / 1e6 // USDT has 6 decimals

    // Validate the received amount matches the chosen plan's exact price.
    // Pro = $49, Enterprise = $149. We allow a tiny 0.01 USDT tolerance for
    // dust/rounding on the chain — anything less than the expected price
    // is rejected.
    const expectedPrice = (payment.plan === 'pro' || payment.plan === 'enterprise')
      ? PLAN_PRICES[payment.plan]
      : 0

    if (expectedPrice === 0) {
      return NextResponse.json({ error: 'Invalid plan associated with this payment' }, { status: 400 })
    }

    if (receivedAmount < expectedPrice - 0.01) {
      return NextResponse.json(
        {
          error:
            `Received $${receivedAmount.toFixed(2)} USDT, but the ${payment.plan} plan ` +
            `costs $${expectedPrice} USD. Please submit the exact amount.`,
        },
        { status: 400 }
      )
    }

    // All checks passed - verify payment and upgrade plan
    // ─── Set subscription expiry (30 days, extended on renewal) ───
    // Fetch the user's current expiry so we can extend it if they're
    // renewing an active subscription (rather than resetting to now+30d).
    const currentUser = await db.user.findUnique({
      where: { id: session.userId },
      select: { planExpiresAt: true },
    })
    const newExpiry = calculateRenewalExpiry(currentUser?.planExpiresAt ?? null)

    await db.$transaction([
      db.payment.update({
        where: { id: paymentId },
        data: {
          status: 'verified',
          verifiedAt: new Date(),
          verifiedBy: 'auto-tron-api',
          amount: receivedAmount,
        },
      }),
      db.user.update({
        where: { id: session.userId },
        data: {
          plan: payment.plan as Plan,
          planExpiresAt: newExpiry,
          planRenewedAt: new Date(),
        },
      }),
    ])

    return NextResponse.json({
      success: true,
      message: `Payment verified! Your plan has been upgraded to ${payment.plan}. Active until ${newExpiry.toLocaleDateString()}.`,
      plan: payment.plan,
      planExpiresAt: newExpiry.toISOString(),
    })
  } catch (error) {
    console.error('USDT verification error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
