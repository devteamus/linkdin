import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { forgotPasswordSchema } from '@/lib/validations'
import { rateLimit } from '@/lib/rate-limit'
import { generateOtp, hashOtp } from '@/lib/otp'
import { sendEmail, forgotPasswordOtpEmail } from '@/lib/email'

const MAX_SENDS_PER_WINDOW = 3
const SEND_WINDOW_MS = 24 * 60 * 60 * 1000 // 24 hours
const CODE_TTL_MS = 15 * 60 * 1000 // 15 minutes

export async function POST(request: NextRequest) {
  try {
    // Coarse per-IP guard against scripted abuse. The real per-user limit
    // (3 codes / 24h) is enforced below against the database, since this
    // in-memory limiter alone can't be trusted for that (resets on deploy,
    // doesn't survive multiple server instances).
    const rl = rateLimit(request, 8, 15 * 60 * 1000)
    if (!rl.success) {
      return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
    }

    const body = await request.json()
    const parsed = forgotPasswordSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { email } = parsed.data
    const user = await db.user.findUnique({ where: { email } })

    // Unknown email: return the same generic response as a real send so an
    // attacker can't use this endpoint to discover which emails have
    // accounts. No row is created, no email is sent.
    if (!user) {
      return NextResponse.json({
        success: true,
        message: 'If an account exists for this email, a verification code has been sent.',
      })
    }

    const existing = await db.passwordResetToken.findUnique({ where: { userId: user.id } })
    const now = new Date()

    // Figure out whether we're still inside this user's current 24h
    // send-window, or whether it has rolled over and should reset.
    const withinWindow = !!existing && now.getTime() - existing.windowStart.getTime() < SEND_WINDOW_MS
    const windowStart = withinWindow ? existing!.windowStart : now
    const sendCountInWindow = withinWindow ? existing!.sendCount : 0

    if (sendCountInWindow >= MAX_SENDS_PER_WINDOW) {
      const retryAt = new Date(windowStart.getTime() + SEND_WINDOW_MS)
      return NextResponse.json({
        error: `You've requested the maximum of ${MAX_SENDS_PER_WINDOW} reset codes for today. Please try again after ${retryAt.toLocaleString()}.`,
      }, { status: 429 })
    }

    const code = generateOtp()
    const expiresAt = new Date(now.getTime() + CODE_TTL_MS)

    // Send the email BEFORE writing to the DB. If delivery fails, the user
    // hasn't actually received a code — they shouldn't lose one of their
    // 3 daily attempts over a transient Resend/network error.
    try {
      await sendEmail({
        to: email,
        subject: 'Your PostGo password reset code',
        html: forgotPasswordOtpEmail(code),
      })
    } catch (sendErr) {
      console.error('Forgot password: email send failed:', sendErr)
      return NextResponse.json({
        error: 'We could not send the verification email right now. Please try again in a few minutes.',
      }, { status: 502 })
    }

    const codeHash = await hashOtp(code)

    await db.passwordResetToken.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        codeHash,
        expiresAt,
        used: false,
        attempts: 0,
        sendCount: 1,
        windowStart: now,
      },
      update: {
        codeHash,
        expiresAt,
        used: false,
        attempts: 0,
        sendCount: sendCountInWindow + 1,
        windowStart,
      },
    })

    return NextResponse.json({
      success: true,
      message: 'A 6-digit verification code has been sent to your email. It expires in 15 minutes — please check your inbox and spam/promotions folder.',
    })
  } catch (error) {
    console.error('Forgot password error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
