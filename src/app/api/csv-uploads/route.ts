import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'

/**
 * Lists all CSV uploads for the current user, with per-upload post
 * status counts (published / scheduled / pending / failed).
 *
 * Used by the new "CSV History" dashboard tab.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const uploads = await db.csvUpload.findMany({
      where: { userId: session.userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        filename: true,
        totalPosts: true,
        intervalValue: true,
        intervalUnit: true,
        status: true,
        scheduleState: true,
        createdAt: true,
        accountId: true,
      },
    })

    // For each upload, count posts by status in a single grouped query
    // (Prisma's groupBy is more efficient than N+1 queries)
    const uploadIds = uploads.map((u) => u.id)
    const statusCounts = await db.post.groupBy({
      by: ['csvUploadId', 'status'],
      where: { csvUploadId: { in: uploadIds } },
      _count: { status: true },
    })

    // Build a lookup: uploadId -> { published, scheduled, pending, failed }
    const countsByUpload = new Map<string, { published: number; scheduled: number; pending: number; failed: number }>()
    for (const row of statusCounts) {
      if (!row.csvUploadId) continue
      const entry = countsByUpload.get(row.csvUploadId) || { published: 0, scheduled: 0, pending: 0, failed: 0 }
      const count = row._count.status
      // FIX: Prisma enum values are UPPERCASE ('PUBLISHED') — old lowercase
      // comparisons never matched, so counts always showed 0.
      const statusKey = String(row.status).toLowerCase()
      if (statusKey === 'published') entry.published = count
      else if (statusKey === 'scheduled') entry.scheduled = count
      else if (statusKey === 'pending') entry.pending = count
      else if (statusKey === 'failed') entry.failed = count
      countsByUpload.set(row.csvUploadId, entry)
    }

    // Hydrate uploads with their status counts
    const result = uploads.map((upload) => ({
      ...upload,
      createdAt: upload.createdAt.toISOString(),
      statusCounts: countsByUpload.get(upload.id) || { published: 0, scheduled: 0, pending: 0, failed: 0 },
    }))

    return NextResponse.json({ uploads: result })
  } catch (error) {
    console.error('List CSV uploads error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
