import { NextRequest } from 'next/server'
import { verifyToken } from './jwt'

/**
 * Session request: accepts NextRequest (has .cookies) or plain Request.
 * Routes throughout the app call getSession with either type.
 */
type SessionRequest = Request | NextRequest

function parseCookieHeader(header: string | null): Record<string, string> {
  if (!header) return {}
  const cookies: Record<string, string> = {}
  for (const part of header.split(';')) {
    if (!part) continue
    const idx = part.indexOf('=')
    if (idx === -1) continue
    const key = part.slice(0, idx).trim()
    const value = part.slice(idx + 1).trim()
    if (key) cookies[key] = decodeURIComponent(value)
  }
  return cookies
}

export async function getSession(request: SessionRequest): Promise<{ userId: string; email: string } | null> {
  // Check Bearer token first
  const authHeader = request.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    return verifyToken(token)
  }

  // Fallback to cookie — works for both NextRequest and plain Request
  let token: string | undefined

  if ('cookies' in request && typeof request.cookies?.get === 'function') {
    token = request.cookies.get('postgo-token')?.value
  } else {
    token = parseCookieHeader(request.headers.get('cookie'))['postgo-token']
  }

  if (!token) return null
  return verifyToken(token)
}
