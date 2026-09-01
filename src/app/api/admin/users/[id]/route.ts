import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { Plan, UserRole } from '@prisma/client'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'

type RouteContext = { params: Promise<{ id: string }> }

// API/UI contract uses lowercase values — matches Prisma enum values directly.
// Admins can assign any of the three plans (free, pro, enterprise) to users.
const VALID_PLANS = ['free', 'pro', 'enterprise'] as const
const VALID_ROLES = ['user', 'admin'] as const

const adminUpdateSchema = z.object({
  plan: z.enum(VALID_PLANS).optional(),
  role: z.enum(VALID_ROLES).optional(),
})

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const rl = rateLimit(request, 30, 60 * 1000)
    if (!rl.success) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const admin = await db.user.findUnique({ where: { email: session.email } })
    if (!admin || admin.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await context.params
    const body = await request.json()
    const parsed = adminUpdateSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid plan or role value' }, { status: 400 })
    }

    const updateData: { plan?: Plan; role?: UserRole } = {}
    if (parsed.data.plan) updateData.plan = parsed.data.plan
    if (parsed.data.role) updateData.role = parsed.data.role

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    const targetUser = await db.user.findUnique({ where: { id } })
    if (!targetUser || targetUser.role === 'admin') {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    await db.user.update({
      where: { id },
      data: updateData,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Admin update user error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const rl = rateLimit(request, 10, 60 * 1000)
    if (!rl.success) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const admin = await db.user.findUnique({ where: { email: session.email } })
    if (!admin || admin.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await context.params

    const targetUser = await db.user.findUnique({ where: { id } })
    if (!targetUser || targetUser.role === 'admin') {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Cascade delete will handle posts, accounts, csv uploads, reset tokens
    await db.user.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Admin delete user error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
