import { z } from 'zod'

const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/

export const registerSchema = z.object({
  name: z.string().max(100).optional(),
  email: z.string().email().max(254),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters')
    .regex(passwordRegex, 'Password must contain at least one uppercase letter, one lowercase letter, and one number'),
})

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
})

export const singlePostSchema = z.object({
  accountId: z.string().min(1).max(100),
  caption: z.string().min(1).max(3000),
  imageUrl: z.string().url({ message: 'Must be a valid URL' }).max(2048).optional().or(z.literal('')).transform(v => (!v || v === '') ? undefined : v),
  videoUrl: z.string().url({ message: 'Must be a valid URL' }).max(2048).optional().or(z.literal('')).transform(v => (!v || v === '') ? undefined : v),
  publishTime: z.string().optional().refine(
    (v) => !v || !isNaN(Date.parse(v)),
    { message: 'Must be a valid date/time' }
  ).transform(v => (!v || v === '') ? undefined : v),
})

export const createPaymentSchema = z.object({
  method: z.enum(['usdt', 'binance']),
  // Amount must match the chosen plan's price (Pro $49 or Enterprise $149).
  // We use a permissive range here and validate the exact price in the
  // payment route against PLAN_PRICES — this avoids importing plan-limits.ts
  // into the zod schema (which is shared with the client bundle).
  amount: z.number().min(49, 'Minimum payment is $49 USD (Pro plan)').max(10000, 'Amount exceeds maximum allowed'),
  plan: z.enum(['pro', 'enterprise']),
  txHash: z.string().max(128).optional(),
  transactionId: z.string().max(128).optional(),
})

// Validate txHash format (TRC20 tx hashes are 64 hex chars)
export const txHashSchema = z.string().regex(/^[0-9a-fA-F]{64}$/, 'Invalid transaction hash format')

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
})

export const resetPasswordSchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters')
    .regex(passwordRegex, 'Password must contain at least one uppercase letter, one lowercase letter, and one number'),
})
