import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { generateOAuthState } from '@/lib/linkedin-oauth-state'

function getLinkedinRedirectUri(): string {
  const configured = process.env.LINKEDIN_REDIRECT_URI
  if (configured) return configured
  // Fallback: derive from APP_URL or VERCEL_URL (Coolify sets APP_URL)
  const base = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL
  if (base) return `${base.replace(/\/$/, '')}/api/linkedin/callback`
  throw new Error('FATAL: LINKEDIN_REDIRECT_URI (or APP_URL) env var is required for LinkedIn OAuth')
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const clientId = process.env.LINKEDIN_CLIENT_ID
    if (!clientId) {
      return NextResponse.json({ error: 'LinkedIn OAuth not configured' }, { status: 500 })
    }

    const state = generateOAuthState(session.userId)

    // Build LinkedIn OAuth URL — redirect_uri MUST be absolute and must match
    // exactly the value registered in the LinkedIn Developer Console.
    const redirectUri = getLinkedinRedirectUri()
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      scope: 'w_member_social openid profile email',
    })

    const authUrl = `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`
    return NextResponse.redirect(authUrl)
  } catch (error) {
    console.error('LinkedIn auth error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
