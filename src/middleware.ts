import { NextRequest, NextResponse } from 'next/server'

/**
 * Global security middleware.
 *
 * Responsibilities:
 *   1. Apply a strict Content-Security-Policy and other security headers
 *      to every response (incl. static assets).
 *   2. Reject oversized request bodies early, before the route handler runs.
 *      Default limits: 1 MB JSON, 10 MB multipart (CSV uploads).
 *
 * Why this exists as a separate file (not just in next.config.ts headers()):
 *   - next.config.ts `headers()` is applied per-route but does not allow
 *     us to *reject* requests based on body size.
 *   - Middleware runs on the Edge runtime by default; we keep it on Node.js
 *     runtime via `export const runtime = 'nodejs'` so we can read the
 *     Content-Length header reliably.
 */

export const runtime = 'nodejs'

const MAX_JSON_BYTES = 1 * 1024 * 1024 // 1 MB
const MAX_MULTIPART_BYTES = 10 * 1024 * 1024 // 10 MB

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https: http: https://media.licdn.com",
    "font-src 'self' data:",
    "connect-src 'self' https://apilist.tronscanapi.com https://www.linkedin.com https://api.linkedin.com https://www.googletagmanager.com",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; '),
}

if (process.env.NODE_ENV === 'production') {
  SECURITY_HEADERS['Strict-Transport-Security'] =
    'max-age=31536000; includeSubDomains; preload'
}

export function middleware(request: NextRequest) {
  // ── Body size limit ──────────────────────────────────────────────
  const contentType = (request.headers.get('content-type') || '').toLowerCase()
  const contentLength = parseInt(request.headers.get('content-length') || '0', 10)

  if (contentLength > 0) {
    if (contentType.includes('multipart/form-data')) {
      if (contentLength > MAX_MULTIPART_BYTES) {
        return NextResponse.json(
          { error: 'Request body too large (max 10 MB for file uploads)' },
          { status: 413 }
        )
      }
    } else if (contentType.includes('application/json')) {
      if (contentLength > MAX_JSON_BYTES) {
        return NextResponse.json(
          { error: 'Request body too large (max 1 MB for JSON)' },
          { status: 413 }
        )
      }
    }
  }

  // ── Apply security headers ───────────────────────────────────────
  const response = NextResponse.next()
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value)
  }
  return response
}

export const config = {
  // Run middleware on every route except Next.js internals.
  matcher: [
    '/((?!_next/static|_next/image|favicon.svg|og-image.png|robots.txt|sitemap.xml|logo.svg).*)',
  ],
}
