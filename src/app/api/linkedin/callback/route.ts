import { NextRequest, NextResponse } from 'next/server'
import { consumeOAuthState } from '@/lib/linkedin-oauth-state'
import { encryptToken } from '@/lib/encryption'
import { db } from '@/lib/db'
import { getPlanLimits } from '@/lib/plan-limits'
import { getEffectivePlan } from '@/lib/plan-helpers'
import type { Plan } from '@prisma/client'

function getLinkedinRedirectUri(): string {
  const configured = process.env.LINKEDIN_REDIRECT_URI
  if (configured) return configured
  const base = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL
  if (base) return `${base.replace(/\/$/, '')}/api/linkedin/callback`
  throw new Error('FATAL: LINKEDIN_REDIRECT_URI (or APP_URL) env var is required for LinkedIn OAuth')
}

// IMPORTANT: Next.js standalone server (HOSTNAME=0.0.0.0 for Docker binding)
// builds request.url using the bind address, NOT the real browser Host header.
// Using request.url as the base for redirect() sends users to http://0.0.0.0:3001/...
// which their browser cannot reach. Always build redirect targets from APP_URL.
function getAppBaseUrl(): string {
  const base = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL
  if (base) return base.replace(/\/$/, '')
  throw new Error('FATAL: APP_URL env var is required')
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')

    if (error) {
      console.error('LinkedIn OAuth error:', error, searchParams.get('error_description'))
      return NextResponse.redirect(new URL('/?linkedin=error', getAppBaseUrl()))
    }

    if (!code || !state) {
      return NextResponse.redirect(new URL('/?linkedin=error', getAppBaseUrl()))
    }

    // Verify state and get userId
    const userId = consumeOAuthState(state)
    if (!userId) {
      console.error('LinkedIn OAuth: invalid or expired state')
      return NextResponse.redirect(new URL('/?linkedin=error', getAppBaseUrl()))
    }

    const clientId = process.env.LINKEDIN_CLIENT_ID
    const clientSecret = process.env.LINKEDIN_CLIENT_SECRET
    if (!clientId || !clientSecret) {
      console.error('LinkedIn OAuth: missing client credentials')
      return NextResponse.redirect(new URL('/?linkedin=error', getAppBaseUrl()))
    }

    // redirect_uri MUST match the value used in the authorization request exactly.
    const redirectUri = getLinkedinRedirectUri()

    // Exchange authorization code for access token
    const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    })

    if (!tokenResponse.ok) {
      const errorBody = await tokenResponse.text()
      console.error('LinkedIn token exchange failed:', tokenResponse.status, errorBody)
      return NextResponse.redirect(new URL('/?linkedin=error', getAppBaseUrl()))
    }

    const tokenData = await tokenResponse.json()
    const accessToken = tokenData.access_token
    const expiresIn = tokenData.expires_in
    const refreshToken = tokenData.refresh_token || null

    if (!accessToken) {
      console.error('LinkedIn OAuth: no access token in response')
      return NextResponse.redirect(new URL('/?linkedin=error', getAppBaseUrl()))
    }

    // Fetch user profile from LinkedIn
    const profileResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    let memberName = 'LinkedIn User'
    let memberId = ''

    if (profileResponse.ok) {
      const profile = await profileResponse.json()
      memberId = profile.sub || ''
      memberName = profile.name || profile.given_name
        ? [profile.given_name, profile.family_name].filter(Boolean).join(' ')
        : 'LinkedIn User'
      if (!memberName.trim()) memberName = 'LinkedIn User'
    } else {
      console.error('LinkedIn profile fetch failed:', profileResponse.status)
      // Use a fallback ID from the token response if available
      memberId = 'unknown'
    }

    // ─── Plan-aware account connect limit (anti-cycling, respects expiry) ──
    // Uses the EFFECTIVE plan — expired subscriptions revert to free limits.
    const currentUser = await db.user.findUnique({
      where: { id: userId },
      select: { plan: true, planExpiresAt: true },
    })
    const rawPlan = (currentUser?.plan as Plan) || 'free'
    const userPlan = getEffectivePlan(rawPlan, currentUser?.planExpiresAt ?? null)
    const planLimits = getPlanLimits(userPlan)

    // Check 1: active account count
    const activeCount = await db.linkedinAccount.count({ where: { userId } })
    if (activeCount >= planLimits.maxAccounts) {
      console.warn(
        `[linkedin-callback] User ${userId} (${userPlan}) at active limit ${activeCount}/${planLimits.maxAccounts} — rejecting`
      )
      return NextResponse.redirect(new URL('/?linkedin=limit', getAppBaseUrl()))
    }

    // Check 2: unique lifetime accounts (anti-cycling)
    // Only block if the new memberId is NOT already in the connection log.
    // If it IS in the log, this is a reconnection — always allow.
    if (memberId && memberId !== 'unknown') {
      const existingLog = await db.accountConnectionLog.findFirst({
        where: { userId, linkedinMemberId: memberId },
        select: { id: true },
      })
      if (!existingLog) {
        // New account — check unique count
        const uniqueResult = await db.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(DISTINCT "linkedinMemberId")::bigint as count
          FROM "AccountConnectionLog"
          WHERE "userId" = ${userId}
        `
        const uniqueCount = Number(uniqueResult[0]?.count ?? 0)
        if (uniqueCount >= planLimits.maxAccounts) {
          console.warn(
            `[linkedin-callback] User ${userId} (${userPlan}) at UNIQUE limit ${uniqueCount}/${planLimits.maxAccounts} — rejecting NEW account ${memberId}`
          )
          return NextResponse.redirect(new URL('/?linkedin=limit', getAppBaseUrl()))
        }
      }
    }

    // Encrypt and store the access token
    const encryptedToken = encryptToken(accessToken)
    const encryptedRefresh = refreshToken ? encryptToken(refreshToken) : null
    const tokenExpiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null

    await db.linkedinAccount.create({
      data: {
        userId,
        linkedinMemberId: memberId,
        accountName: memberName,
        accessToken: encryptedToken,
        refreshToken: encryptedRefresh,
        tokenExpiresAt,
      },
    })

    // ─── Append to connection log (anti-cycling audit trail) ───────
    // This is NEVER deleted — even if the user disconnects the account
    // later, this log entry persists so the unique-account count stays
    // accurate. The @@unique constraint on (userId, linkedinMemberId,
    // connectedAt) allows multiple reconnection events with different
    // timestamps.
    if (memberId && memberId !== 'unknown') {
      try {
        await db.accountConnectionLog.create({
          data: {
            userId,
            linkedinMemberId: memberId,
            accountName: memberName,
          },
        })
      } catch (logErr) {
        // Non-fatal — the account is already created. Log and continue.
        console.warn('[linkedin-callback] Failed to write connection log:', logErr)
      }
    }

    return NextResponse.redirect(new URL('/?linkedin=connected', getAppBaseUrl()))
  } catch (error) {
    console.error('LinkedIn callback error:', error)
    return NextResponse.redirect(new URL('/?linkedin=error', getAppBaseUrl()))
  }
}