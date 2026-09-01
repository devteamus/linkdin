import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'

type RouteParams = { params: Promise<{ uploadId: string }> }

/**
 * GET /api/posts/bulk/[uploadId]
 *   Returns the upload record + all posts belonging to it.
 *   Used by the Bulk Post tab's "View Posts" panel.
 *
 *   Includes the new video_url and comment fields so the dashboard
 *   can display them in the post list.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { uploadId } = await params

    // Verify the upload belongs to this user
    const upload = await db.csvUpload.findFirst({
      where: { id: uploadId, userId: session.userId },
    })

    if (!upload) {
      return NextResponse.json({ error: 'Upload not found' }, { status: 404 })
    }

    const posts = await db.post.findMany({
      where: { csvUploadId: uploadId },
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

    // Count statuses
    const statusCounts = { pending: 0, scheduled: 0, published: 0, failed: 0 }
    for (const p of posts) {
      if (p.status in statusCounts) {
        statusCounts[p.status as keyof typeof statusCounts]++
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
    console.error('Get CSV upload posts error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
