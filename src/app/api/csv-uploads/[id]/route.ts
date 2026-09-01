import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'

type RouteParams = { params: Promise<{ id: string }> }

/**
 * GET /api/csv-uploads/[id]
 *   Returns full detail of a single CSV upload (the upload record + all posts).
 *   Used by the Bulk Post tab's "View Posts" panel.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    const upload = await db.csvUpload.findFirst({
      where: { id, userId: session.userId },
    })

    if (!upload) {
      return NextResponse.json({ error: 'Upload not found' }, { status: 404 })
    }

    const posts = await db.post.findMany({
      where: { csvUploadId: id },
      select: {
        id: true,
        caption: true,
        imageUrl: true,
        videoUrl: true,
        comment: true,
        status: true,
        publishTime: true,
        error: true,
        createdAt: true,
      },
      orderBy: { publishTime: 'asc' },
    })

    // Count statuses (Prisma returns UPPERCASE enum values — compare case-insensitively)
    const statusCounts = { pending: 0, scheduled: 0, published: 0, failed: 0 }
    for (const p of posts) {
      const key = String(p.status).toLowerCase() as keyof typeof statusCounts
      if (key in statusCounts) {
        statusCounts[key]++
      }
    }

    return NextResponse.json({
      upload: {
        id: upload.id,
        filename: upload.filename,
        totalPosts: upload.totalPosts,
        intervalValue: upload.intervalValue,
        intervalUnit: upload.intervalUnit,
        status: upload.status,
        scheduleState: upload.scheduleState,
        createdAt: upload.createdAt.toISOString(),
      },
      posts,
      statusCounts,
    })
  } catch (error) {
    console.error('Get CSV upload error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/csv-uploads/[id]
 *   Updates the scheduleState of a CSV upload.
 *   Body: { scheduleState: 'active' | 'paused' | 'off' }
 *
 *   - 'active': scheduler will publish posts normally
 *   - 'paused': scheduler will skip this upload's posts and reschedule them 5min forward
 *   - 'off': same as 'paused' (alias) — used when the user toggles the master "Schedule ON/OFF"
 *
 *   When transitioning from 'paused'/'off' → 'active', we also reschedule
 *   any posts whose publishTime has already passed to a near-future time
 *   so they fire promptly rather than being immediately all-at-once.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    const upload = await db.csvUpload.findFirst({
      where: { id, userId: session.userId },
    })
    if (!upload) {
      return NextResponse.json({ error: 'Upload not found' }, { status: 404 })
    }

    const body = await request.json()
    const { scheduleState } = body as { scheduleState?: string }

    if (!scheduleState || !['active', 'paused', 'off'].includes(scheduleState)) {
      return NextResponse.json(
        { error: 'scheduleState must be one of: active, paused, off' },
        { status: 400 }
      )
    }

    // Validate the schedule state (Prisma ScheduleState enum is lowercase:
    // 'active' | 'paused' | 'off' — matches the API input directly)
    const validScheduleStates = ['active', 'paused', 'off'] as const
    if (!validScheduleStates.includes(scheduleState as (typeof validScheduleStates)[number])) {
      return NextResponse.json({ error: 'Invalid schedule state' }, { status: 400 })
    }
    const scheduleStateEnum = scheduleState as (typeof validScheduleStates)[number]

    // Update the upload's schedule state
    await db.csvUpload.update({
      where: { id },
      data: { scheduleState: scheduleStateEnum },
    })

    // If resuming (active), reschedule any overdue posts so they fire
    // promptly without flooding LinkedIn all at once.
    if (scheduleState === 'active') {
      const now = new Date()
      const overduePosts = await db.post.findMany({
        where: {
          csvUploadId: id,
          status: { in: ['scheduled', 'pending'] },
          publishTime: { lte: now },
        },
        select: { id: true, publishTime: true },
        orderBy: { publishTime: 'asc' },
      })

      // Spread them out 30 seconds apart starting 30s from now.
      // This prevents all paused-then-resumed posts from firing simultaneously.
      if (overduePosts.length > 0) {
        const baseTime = new Date(now.getTime() + 30 * 1000)
        for (let i = 0; i < overduePosts.length; i++) {
          const newTime = new Date(baseTime.getTime() + i * 30 * 1000)
          await db.post.update({
            where: { id: overduePosts[i].id },
            data: { publishTime: newTime },
          })
        }
      }
    }

    return NextResponse.json({ success: true, scheduleState })
  } catch (error) {
    console.error('Update CSV upload error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/csv-uploads/[id]
 *   Deletes a CSV upload record AND all posts that belong to it.
 *   Already-published posts are also deleted (the post itself remains on
 *   LinkedIn — we only remove our local record of it).
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    const upload = await db.csvUpload.findFirst({
      where: { id, userId: session.userId },
    })
    if (!upload) {
      return NextResponse.json({ error: 'Upload not found' }, { status: 404 })
    }

    // Delete all posts belonging to this upload first (foreign key constraint)
    await db.post.deleteMany({
      where: { csvUploadId: id },
    })

    // Then delete the upload record itself
    await db.csvUpload.delete({
      where: { id },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete CSV upload error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
