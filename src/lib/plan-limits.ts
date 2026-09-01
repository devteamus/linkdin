import type { Plan } from '@prisma/client'

/**
 * Per-plan feature limits.
 *
 * NOTE: Keys MUST be lowercase — they must match the Prisma `Plan` enum
 * values exactly (schema.prisma: enum Plan { free pro enterprise }).
 * Using 'FREE'/'PRO' here causes TS2561 (Record<Plan, ...> mismatch).
 *
 * Pricing & limits (effective 2026-08-29):
 *   ┌──────────────┬────────┬──────────────┬─────────────────┬───────────────────┐
 *   │ Plan         │ Price  │ Accounts     │ Posts/day/acct  │ Monthly capacity  │
 *   ├──────────────┼────────┼──────────────┼─────────────────┼───────────────────┤
 *   │ Free         │   $0   │      2       │       10        │        600        │
 *   │ Pro          │  $49   │     25       │       50        │     37,500        │
 *   │ Enterprise   │ $149   │     75       │      250        │    562,500        │
 *   └──────────────┴────────┴──────────────┴─────────────────┴───────────────────┘
 *
 *   Monthly capacity = accounts × posts/day × 30 days.
 *     Pro        : 25 × 50 × 30  =  37,500 posts/month
 *     Enterprise : 75 × 250 × 30 = 562,500 posts/month
 *
 *   maxBulkUpload caps how many posts ONE CSV file can contain in a single
 *   upload. It is intentionally generous (well above the daily per-account
 *   cap) so users can queue many days of content in one go — the scheduler
 *   auto-spreads posts across days to respect the per-account daily limit.
 *
 *   maxApiCallsPerDay is the per-account LinkedIn API call budget we DISPLAY
 *   and ENFORCE on our side. LinkedIn's own hard limit is 150/24h per OAuth
 *   grant — we show 150 for Free/Pro (matches LinkedIn exactly) and 500 for
 *   Enterprise (higher planned budget for power users who may have LinkedIn
 *   enterprise partnerships with elevated quotas).
 */
export interface PlanLimits {
  /** Max UNIQUE LinkedIn accounts a user can EVER connect (lifetime, not just active). */
  maxAccounts: number
  /** Max posts a user can schedule per day PER ACCOUNT */
  maxPostsPerDay: number
  /** Max posts per CSV bulk upload */
  maxBulkUpload: number
  /** Max CSV upload size in MB */
  maxFileSizeMb: number
  /** Per-account LinkedIn API call budget per 24h (displayed + enforced) */
  maxApiCallsPerDay: number
  /** Max posts a user can publish per calendar month (across ALL accounts) */
  maxMonthlyPosts: number
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    maxAccounts: 2,
    maxPostsPerDay: 10,
    maxBulkUpload: 50,
    maxFileSizeMb: 2,
    maxApiCallsPerDay: 150,
    maxMonthlyPosts: 2 * 10 * 30, // 600
  },
  pro: {
    maxAccounts: 25,
    maxPostsPerDay: 50,
    maxBulkUpload: 1000,
    maxFileSizeMb: 5,
    maxApiCallsPerDay: 150,
    maxMonthlyPosts: 25 * 50 * 30, // 37,500
  },
  enterprise: {
    maxAccounts: 75,
    maxPostsPerDay: 250,
    maxBulkUpload: 10000,
    maxFileSizeMb: 5,
    maxApiCallsPerDay: 500,
    maxMonthlyPosts: 75 * 250 * 30, // 562,500
  },
}

/**
 * Plan pricing (USD, monthly). Used by the payment API to validate the
 * user-submitted amount matches the chosen plan.
 */
export const PLAN_PRICES: Record<Exclude<Plan, 'free'>, number> = {
  pro: 49,
  enterprise: 149,
}

/**
 * Human-readable display names for each plan.
 */
export const PLAN_DISPLAY_NAMES: Record<Plan, string> = {
  free: 'Free',
  pro: 'Pro',
  enterprise: 'Enterprise',
}

/**
 * Calculate the monthly post capacity for a plan.
 * Formula: accounts × postsPerDay × 30 days.
 */
export function getMonthlyPostCapacity(plan: Plan): number {
  const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free
  return limits.maxMonthlyPosts
}

export function getPlanLimits(plan: Plan): PlanLimits {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.free
}
