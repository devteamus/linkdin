import crypto from 'crypto'

/**
 * Stateless OAuth state — a signed JWT-like token instead of an in-memory map.
 *
 * Why: in-memory state is lost on every server restart (incl. Coolify redeploy),
 * which would break any LinkedIn OAuth flow that was in-flight at deploy time.
 * Using a signed token, the state survives restarts and works across replicas.
 *
 * Format: base64url(payload).base64url(hmac)
 * Payload: { userId, exp }  where exp is in milliseconds since epoch.
 */

const STATE_TTL_MS = 10 * 60 * 1000 // 10 minutes

function getSecret(): string {
  const secret = process.env.JWT_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('FATAL: JWT_SECRET must be set (>= 32 chars) for OAuth state signing')
  }
  return secret
}

function b64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64url(input: string): Buffer {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4))
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

interface StatePayload {
  userId: string
  exp: number
}

export function generateOAuthState(userId: string): string {
  const payload: StatePayload = {
    userId,
    exp: Date.now() + STATE_TTL_MS,
  }
  const payloadB64 = b64url(JSON.stringify(payload))
  const hmac = crypto.createHmac('sha256', getSecret()).update(payloadB64).digest()
  const sigB64 = b64url(hmac)
  return `${payloadB64}.${sigB64}`
}

export function consumeOAuthState(state: string): string | null {
  const parts = state.split('.')
  if (parts.length !== 2) return null

  const [payloadB64, sigB64] = parts

  // Verify signature (constant-time compare)
  const expectedSig = crypto.createHmac('sha256', getSecret()).update(payloadB64).digest()
  const providedSig = fromB64url(sigB64)
  if (expectedSig.length !== providedSig.length) return null
  if (!crypto.timingSafeEqual(expectedSig, providedSig)) return null

  try {
    const payload = JSON.parse(fromB64url(payloadB64).toString('utf8')) as StatePayload
    if (typeof payload.userId !== 'string' || typeof payload.exp !== 'number') return null
    if (payload.exp < Date.now()) return null
    return payload.userId
  } catch {
    return null
  }
}
