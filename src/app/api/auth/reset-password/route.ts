import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { resetPasswordSchema } from '@/lib/validations'
import { rateLimit } from '@/lib/rate-limit'
import { verifyOtp } from '@/lib/otp'

const MAX_VERIFY_ATTEMPTS = 5
const GENERIC_ERROR = 'Invalid or expired code. Please check the code or request a new one.'

export async function POST(request: NextRequest) {
  try {
    // Stricter limit here than forgot-password: this endpoint is the one
    // an attacker would hammer to brute-force a 6-digit code.
    const rl = rateLimit(request, 10, 60 * 1000)
    if (!rl.success) {
      return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
    }

    const body = await request.json()
    const parsed = resetPasswordSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { email, code, password } = parsed.data

    const user = await db.user.findUnique({ where: { email } })
    if (!user) {
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 400 })
    }

    const resetToken = await db.passwordResetToken.findUnique({ where: { userId: user.id } })

    if (!resetToken || !resetToken.codeHash || !resetToken.expiresAt || resetToken.used) {
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 400 })
    }

    if (resetToken.expiresAt < new Date()) {
      return NextResponse.json({ error: 'This code has expired. Please request a new one.' }, { status: 400 })
    }

    if (resetToken.attempts >= MAX_VERIFY_ATTEMPTS) {
      // Lock this code out entirely — force the user to request a fresh
      // one rather than letting them keep guessing against it.
      await db.passwordResetToken.update({
        where: { userId: user.id },
        data: { used: true },
      })
      return NextResponse.json({
        error: 'Too many incorrect attempts. Please request a new code.',
      }, { status: 429 })
    }

    const isValid = await verifyOtp(code, resetToken.codeHash)

    if (!isValid) {
      await db.passwordResetToken.update({
        where: { userId: user.id },
        data: { attempts: { increment: 1 } },
      })
      const remaining = MAX_VERIFY_ATTEMPTS - (resetToken.attempts + 1)
      return NextResponse.json({
        error: remaining > 0 ? `Incorrect code. ${remaining} attempt(s) remaining.` : GENERIC_ERROR,
      }, { status: 400 })
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    await db.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    })

    // Code is single-use: burn it immediately on success so it can never
    // be replayed, even before its 15-minute expiry.
    await db.passwordResetToken.delete({ where: { id: resetToken.id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Reset password error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
