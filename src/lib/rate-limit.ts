import { NextRequest } from 'next/server'

const store = new Map<string, { count: number; resetTime: number }>()

function cleanup() {
  const now = Date.now()
  for (const [key, value] of store) {
    if (now > value.resetTime) {
      store.delete(key)
    }
  }
}

export function rateLimit(
  request: NextRequest,
  limit: number,
  windowMs: number
): { success: boolean; remaining: number; resetAt: number } {
  cleanup()

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  // Key by IP + route so a busy endpoint's counter never bleeds into a
  // different endpoint's (much stricter) limit for the same visitor.
  const key = `${ip}:${request.nextUrl.pathname}`
  const now = Date.now()

  const entry = store.get(key)

  if (!entry || now > entry.resetTime) {
    const resetAt = now + windowMs
    store.set(key, { count: 1, resetTime: resetAt })
    return { success: true, remaining: limit - 1, resetAt }
  }

  if (entry.count >= limit) {
    return { success: false, remaining: 0, resetAt: entry.resetTime }
  }

  entry.count++
  return { success: true, remaining: limit - entry.count, resetAt: entry.resetTime }
}
