import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { encryptToken } from '@/lib/encryption'
import { rateLimit } from '@/lib/rate-limit'
import { getPlanLimits } from '@/lib/plan-limits'
import { getEffectivePlan } from '@/lib/plan-helpers'
import type { Plan } from '@prisma/client'

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

    const accounts = await db.linkedinAccount.findMany({
      where: { userId: session.userId },
      select: {
        id: true,
        linkedinMemberId: true,
        accountName: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ accounts })
  } catch (error) {
    console.error('Get accounts error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const rl = rateLimit(request, 10, 60 * 1000)
    if (!rl.success) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const body = await request.json()
    const { accountName: providedName, accessToken } = body

    if (!accessToken) {
      return NextResponse.json({ error: 'Missing required field: accessToken' }, { status: 400 })
    }

    // ─── Plan-aware account connect limit (anti-cycling, respects expiry) ──
    // Two checks:
    //   1. ACTIVE accounts: cannot exceed plan.maxAccounts currently connected.
    //   2. UNIQUE lifetime accounts: cannot have EVER connected more than
    //      plan.maxAccounts distinct LinkedIn accounts.
    // Uses the EFFECTIVE plan — expired subscriptions revert to free limits.
    const user = await db.user.findUnique({
      where: { id: session.userId },
      select: { plan: true, planExpiresAt: true },
    })
    const rawPlan = (user?.plan as Plan) || 'free'
    const userPlan = getEffectivePlan(rawPlan, user?.planExpiresAt ?? null)
    const isExpired = rawPlan !== 'free' && userPlan === 'free'
    const planLimits = getPlanLimits(userPlan)

    // Check 1: active account count
    const activeCount = await db.linkedinAccount.count({ where: { userId: session.userId } })
    if (activeCount >= planLimits.maxAccounts) {
      return NextResponse.json(
        {
          error:
            isExpired
              ? `Your ${rawPlan} subscription has expired — you're now on the free plan (2 accounts). Please renew to reconnect more accounts.`
              : `Your ${userPlan} plan allows up to ${planLimits.maxAccounts} LinkedIn accounts. ` +
                (userPlan === 'free'
                  ? 'Upgrade to Pro (25 accounts) or Enterprise (75 accounts) to connect more.'
                  : 'Disconnect an existing account first or contact support to upgrade further.'),
        },
        { status: 403 }
      )
    }

    // Verify the token actually works and belongs to a real LinkedIn member
    // before we trust it — never take a client-supplied memberId at face
    // value, since a wrong/mismatched id would silently break publishing
    // later (posts fail with an unhelpful 403 from LinkedIn).
    let profileRes: Response
    try {
      profileRes = await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10000),
      })
    } catch {
      return NextResponse.json({ error: 'Could not reach LinkedIn to verify this token. Try again.' }, { status: 502 })
    }

    if (!profileRes.ok) {
      return NextResponse.json(
        { error: 'This LinkedIn access token is invalid or expired — could not verify it with LinkedIn.' },
        { status: 400 }
      )
    }

    const profile = await profileRes.json().catch(() => null)
    const linkedinMemberId: string | undefined = profile?.sub
    if (!linkedinMemberId) {
      return NextResponse.json({ error: 'LinkedIn did not return a member ID for this token.' }, { status: 400 })
    }

    const existing = await db.linkedinAccount.findFirst({
      where: { userId: session.userId, linkedinMemberId },
    })
    if (existing) {
      return NextResponse.json({ error: 'This LinkedIn account is already connected.' }, { status: 409 })
    }

    // ─── Check 2: unique lifetime accounts (anti-cycling) ──────────
    // Only block if this memberId is NOT already in the connection log.
    // If it IS in the log, this is a reconnection — always allow.
    const existingLog = await db.accountConnectionLog.findFirst({
      where: { userId: session.userId, linkedinMemberId },
      select: { id: true },
    })
    if (!existingLog) {
      // New account — check unique count
      const uniqueResult = await db.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(DISTINCT "linkedinMemberId")::bigint as count
        FROM "AccountConnectionLog"
        WHERE "userId" = ${session.userId}
      `
      const uniqueCount = Number(uniqueResult[0]?.count ?? 0)
      if (uniqueCount >= planLimits.maxAccounts) {
        return NextResponse.json(
          {
            error:
              `You have already connected ${uniqueCount} unique LinkedIn accounts (the ${userPlan} plan limit of ${planLimits.maxAccounts}). ` +
              'Even after disconnecting, you cannot connect NEW accounts beyond this lifetime limit. ' +
              'You can still reconnect an account you previously disconnected.',
          },
          { status: 403 }
        )
      }
    }

    const derivedName = [profile.given_name, profile.family_name].filter(Boolean).join(' ')
    const accountName = (providedName && String(providedName).trim()) || derivedName || 'LinkedIn User'

    const encryptedToken = encryptToken(accessToken)

    const account = await db.linkedinAccount.create({
      data: {
        userId: session.userId,
        linkedinMemberId,
        accountName,
        accessToken: encryptedToken,
      },
      select: {
        id: true,
        linkedinMemberId: true,
        accountName: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    // ─── Append to connection log (anti-cycling audit trail) ───────
    // Never deleted — persists even after the user disconnects the account.
    try {
      await db.accountConnectionLog.create({
        data: {
          userId: session.userId,
          linkedinMemberId,
          accountName,
        },
      })
    } catch (logErr) {
      // Non-fatal — account is already created. Log and continue.
      console.warn('[accounts] Failed to write connection log:', logErr)
    }

    return NextResponse.json({ account }, { status: 201 })
  } catch (error) {
    console.error('Create account error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
