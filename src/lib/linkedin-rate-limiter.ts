/**
 * LinkedIn API Per-MEMBER Rate Limiter (Redis, atomic)
 *
 * BUG FIXES implemented here:
 *
 * 1) KEYED BY linkedinMemberId, NOT the local DB accountId (Bug #1).
 *    LinkedIn throttles per MEMBER identity + OAuth app — not per row in
 *    our `LinkedinAccount` table. Two connected rows that point at the
 *    same LinkedIn member (reconnect, or the same member connected by two
 *    of our users) share ONE real quota at LinkedIn. Keying our limiter by
 *    the local cuid `accountId` made each row think it had its own bucket
 *    (100/min each) while LinkedIn saw 2-3x the allowed traffic → real 429s.
 *    Keying by member id makes our limiter mirror LinkedIn's actual view.
 *
 * 2) ATOMIC ACQUIRE via a single Lua script (Bug #2).
 *    The old implementation did zremrangebyscore + zcard in one pipeline,
 *    then a SEPARATE zadd round-trip. With 75 concurrent worker slots
 *    (3 workers × 25) hammering the same account, dozens of jobs read the
 *    same "under limit" count between the check and the record, all got
 *    allowed, and the window blew past the limit (check-then-act race).
 *    The Lua script below removes/count/adds in ONE atomic Redis operation.
 *
 * This module is shared by the web app AND scripts/worker.ts (the worker
 * imports it transitively through linkedin-publish.ts). It uses the
 * singleton Redis connection from src/lib/redis.ts (REDIS_URL env).
 *
 * Env vars (already in .env.example):
 *   LINKEDIN_RATE_LIMIT_MAX        default 100  (calls per member per window)
 *   LINKEDIN_RATE_LIMIT_WINDOW_MS  default 60000 (window in ms)
 */

import redis from './redis'

export const LINKEDIN_RATE_LIMIT_MAX = parseInt(
  process.env.LINKEDIN_RATE_LIMIT_MAX || '100',
  10
)
export const LINKEDIN_RATE_LIMIT_WINDOW_MS = parseInt(
  process.env.LINKEDIN_RATE_LIMIT_WINDOW_MS || '60000',
  10
)

/**
 * One atomic round-trip:
 *   1. ZREMRANGEBYSCORE — drop entries older than the window
 *   2. ZCARD           — count entries inside the window
 *   3. if under limit  — ZADD this call + PEXPIRE the key (auto-cleanup)
 *   4. else            — read the oldest entry to compute how long to wait
 *
 * Returns [allowed(0|1), usedAfter, waitMs]
 */
const ACQUIRE_LUA = `
local key    = KEYS[1]
local max    = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local now    = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local current = redis.call('ZCARD', key)

if current < max then
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, window + 60000)
  return {1, current + 1, 0}
end

local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local wait = window
if oldest[2] then
  wait = math.max(0, tonumber(oldest[2]) + window - now)
end
return {0, current, wait}
`

export interface MemberRateLimitDecision {
  /** Whether the API call may be made right now */
  allowed: boolean
  /** How many calls this member has made in the current window (after this decision) */
  used: number
  /** If not allowed: ms until the next slot frees up */
  waitMs: number
}

/**
 * Accounts whose LinkedIn member identity is unknown (failed profile
 * fetch during OAuth) are never rate-limited here — publishing fails
 * immediately with "member ID missing" anyway, and limiting a shared
 * 'unknown' key would wrongly couple unrelated broken rows.
 */
export function isRateLimitableMember(memberId: string | null | undefined): boolean {
  return typeof memberId === 'string' && memberId.length > 0 && memberId !== 'unknown'
}

function keyFor(memberId: string): string {
  return `ratelimit:linkedin:member:${memberId}`
}

/**
 * Acquire ONE API-call slot for a LinkedIn member. Atomic (Lua).
 *
 * FAIL-OPEN on Redis errors: if the limiter itself is broken we still let
 * the publish attempt go through — a missed pre-throttle is recoverable via
 * LinkedIn's 429 + Retry-After handling, whereas fail-closed would stop ALL
 * publishing just because a metric store hiccuped.
 */
export async function acquireMemberSlot(memberId: string): Promise<MemberRateLimitDecision> {
  if (!isRateLimitableMember(memberId)) {
    return { allowed: true, used: 0, waitMs: 0 }
  }

  try {
    const now = Date.now()
    // Unique member string — ZADD would otherwise deduplicate identical
    // members and silently under-count the window.
    const member = `${now}-${Math.random().toString(36).slice(2, 11)}`

    const result = (await redis.eval(
      ACQUIRE_LUA,
      1,
      keyFor(memberId),
      LINKEDIN_RATE_LIMIT_MAX,
      LINKEDIN_RATE_LIMIT_WINDOW_MS,
      now,
      member
    )) as Array<number | string>

    return {
      allowed: Number(result?.[0]) === 1,
      used: Number(result?.[1] ?? 0),
      waitMs: Math.max(0, Number(result?.[2] ?? 0)),
    }
  } catch (err) {
    console.error(
      '[rate-limiter] Redis eval failed — failing OPEN (publishing continues):',
      err instanceof Error ? err.message : err
    )
    return { allowed: true, used: 0, waitMs: 0 }
  }
}

/**
 * Acquire a slot, and if the member's window is saturated, WAIT in a
 * re-check loop instead of sleeping once and firing blindly (Bug #2's
 * second half — the old code slept for waitTime and then published
 * WITHOUT re-checking, so all waiting jobs woke at the same instant and
 * stampeded LinkedIn together).
 *
 * The loop wakes at most every 5s, re-evaluates the REAL remaining wait
 * from Redis each time, and gives up after maxWaitMs (returning the last
 * not-allowed decision so the caller can back off / retry later).
 */
export async function acquireMemberSlotWithWait(
  memberId: string,
  opts: { maxWaitMs?: number } = {}
): Promise<MemberRateLimitDecision> {
  const maxWaitMs = opts.maxWaitMs ?? 60_000
  const deadline = Date.now() + maxWaitMs

  let decision = await acquireMemberSlot(memberId)
  while (!decision.allowed) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) return decision

    // Sleep the shorter of: how long Redis says until a slot frees,
    // our 5s re-check cap, or whatever is left of the deadline.
    const sleepMs = Math.max(250, Math.min(decision.waitMs, 5_000, remaining))
    await new Promise((resolve) => setTimeout(resolve, sleepMs))

    decision = await acquireMemberSlot(memberId)
  }
  return decision
}

/**
 * Inspect a member's window without consuming a slot (monitoring/admin).
 */
export async function getMemberRateLimitStatus(
  memberId: string
): Promise<{ used: number; max: number; remaining: number }> {
  if (!isRateLimitableMember(memberId)) {
    return { used: 0, max: LINKEDIN_RATE_LIMIT_MAX, remaining: LINKEDIN_RATE_LIMIT_MAX }
  }
  try {
    const key = keyFor(memberId)
    const windowStart = Date.now() - LINKEDIN_RATE_LIMIT_WINDOW_MS
    const pipeline = redis.pipeline()
    pipeline.zremrangebyscore(key, 0, windowStart)
    pipeline.zcard(key)
    const results = await pipeline.exec()
    const used = Number(results?.[1]?.[1] ?? 0)
    return {
      used,
      max: LINKEDIN_RATE_LIMIT_MAX,
      remaining: Math.max(0, LINKEDIN_RATE_LIMIT_MAX - used),
    }
  } catch {
    return { used: 0, max: LINKEDIN_RATE_LIMIT_MAX, remaining: LINKEDIN_RATE_LIMIT_MAX }
  }
}
