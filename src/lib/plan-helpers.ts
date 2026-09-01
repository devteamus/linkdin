import type { Plan } from '@prisma/client'
import { PLAN_LIMITS, getPlanLimits } from './plan-limits'

/**
 * Subscription expiry & effective-plan helpers.
 *
 * PAID PLAN EXPIRY MODEL:
 *   - When a payment is verified, `planExpiresAt` is set to:
 *       max(current planExpiresAt, now) + 30 days
 *     This means: a fresh purchase starts 30 days from now, but a renewal
 *     (while still active) EXTENDS the existing expiry by 30 days so the
 *     user doesn't lose remaining days by renewing early.
 *   - When `planExpiresAt` is in the past, the user's EFFECTIVE plan
 *     reverts to 'free' for ALL limit checks. They keep their `plan` field
 *     value (so the UI can show "Pro (expired)" and prompt renewal), but
 *     every feature gate treats them as free until they renew.
 *   - Free users have `planExpiresAt = null` and never expire.
 */

const SUBSCRIPTION_DURATION_DAYS = 30

/**
 * Determine the EFFECTIVE plan a user should be treated as for feature
 * gating & limit enforcement.
 *
 *   - Free users → 'free' (always)
 *   - Paid users with valid (non-expired) subscription → their paid plan
 *   - Paid users with EXPIRED subscription → 'free' (revert to free limits)
 *
 * @param userPlan     The user's `plan` field value (raw, from DB)
 * @param planExpiresAt The user's `planExpiresAt` field (null for free users)
 * @returns The plan to enforce limits against
 */
export function getEffectivePlan(
  userPlan: Plan,
  planExpiresAt: Date | string | null
): Plan {
  // Free users never expire
  if (userPlan === 'free') return 'free'

  // Paid user with no expiry set — treat as expired (shouldn't happen,
  // but defensive: a paid plan with no expiry means the payment flow
  // didn't complete properly, so we revert to free for safety).
  if (!planExpiresAt) return 'free'

  const expiry = new Date(planExpiresAt)
  const now = new Date()

  if (expiry <= now) {
    // Subscription expired — revert to free limits
    return 'free'
  }

  // Active paid subscription
  return userPlan
}

/**
 * Calculate the new planExpiresAt value to set when a payment is verified.
 *
 * Renewal behavior:
 *   - If the user has NO current expiry (fresh purchase or expired): 30 days from now.
 *   - If the user has a FUTURE expiry (renewing early): 30 days ADDED to
 *     the current expiry, so they don't lose remaining days.
 *
 * @param currentExpiresAt The user's current planExpiresAt (null if none)
 * @returns The new planExpiresAt Date to persist
 */
export function calculateRenewalExpiry(
  currentExpiresAt: Date | string | null
): Date {
  const now = new Date()
  const SUBSCRIPTION_MS = SUBSCRIPTION_DURATION_DAYS * 24 * 60 * 60 * 1000

  if (!currentExpiresAt) {
    // Fresh purchase or previously expired → start 30 days from now
    return new Date(now.getTime() + SUBSCRIPTION_MS)
  }

  const current = new Date(currentExpiresAt)
  if (current <= now) {
    // Previously expired → start fresh 30 days from now
    return new Date(now.getTime() + SUBSCRIPTION_MS)
  }

  // Active subscription being renewed early → extend by 30 days from
  // the current expiry (so remaining days aren't lost).
  return new Date(current.getTime() + SUBSCRIPTION_MS)
}

/**
 * Get plan limits for the EFFECTIVE plan (respects expiry).
 * Convenience wrapper combining getEffectivePlan + getPlanLimits.
 */
export function getEffectivePlanLimits(
  userPlan: Plan,
  planExpiresAt: Date | string | null
) {
  const effectivePlan = getEffectivePlan(userPlan, planExpiresAt)
  return {
    effectivePlan,
    limits: getPlanLimits(effectivePlan),
    isExpired: effectivePlan === 'free' && userPlan !== 'free',
    isActive: effectivePlan !== 'free',
  }
}

/**
 * Format the remaining days until expiry for display.
 * Returns "30 days", "1 day", "Expired", or "No expiry" (for free users).
 */
export function formatDaysRemaining(
  userPlan: Plan,
  planExpiresAt: Date | string | null
): string {
  if (userPlan === 'free') return 'No expiry'
  if (!planExpiresAt) return 'Expired'

  const expiry = new Date(planExpiresAt)
  const now = new Date()
  const msRemaining = expiry.getTime() - now.getTime()

  if (msRemaining <= 0) return 'Expired'

  const daysRemaining = Math.ceil(msRemaining / (24 * 60 * 60 * 1000))
  if (daysRemaining === 1) return '1 day'
  return `${daysRemaining} days`
}

export { SUBSCRIPTION_DURATION_DAYS }
