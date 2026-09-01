import crypto from 'crypto'
import bcrypt from 'bcryptjs'

/**
 * Generates a cryptographically secure 6-digit numeric OTP.
 * Uses crypto.randomInt (CSPRNG) — NEVER Math.random() for anything
 * security-sensitive.
 */
export function generateOtp(): string {
  return crypto.randomInt(100000, 1000000).toString()
}

/** Hash an OTP before persisting it — codes are never stored in plaintext. */
export async function hashOtp(code: string): Promise<string> {
  return bcrypt.hash(code, 10)
}

/** Compare a user-submitted code against the stored hash. */
export async function verifyOtp(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(code, hash)
}
