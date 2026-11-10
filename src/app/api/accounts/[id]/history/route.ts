import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'

type RouteParams = { params: Promise<{ id: string }> }

/**
 * GET /api/accounts/[id]/history            → account-wise history overview
 * GET /api/accounts/[id]/history?uploadId=x  → that upload's posts, CSV SERIAL order
 *
 * Account-wise history for the dashboard's "Account History" tab:
 *   - totals per status for THIS account (published / scheduled / pending /
 *     processing / failed)
 *   - the NEXT scheduled post (publishTime > now) with its publish time —
 *     so after uploading a 1000-post CSV the user immediately sees when the
 *     next post of that account goes out
 *   - every CSV upload made to THIS account with per-upload status counts,
 *     first / last / next publish times, interval and schedule state
 *   - with ?uploadId= : the upload's posts in CSV serial order.
 *
 * CSV serial order = publishTime ascending. The bulk uploader assigns
 * publishTimes strictly in CSV row order (row 1 → earliest slot, row 2 →
 * next interval slot, ...), so ordering by publishTime IS the CSV row order
 * — no matter how many days the schedule spans.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    // Verify the account belongs to this user (tenant isolation)
    const account = await db.linkedinAccount.findFirst({
      where: { id, userId: session.userId },
      select: {
        id: true,
        accountName: true,
        linkedinMemberId: true,
        isActive: true,
        createdAt: true,
      },
    })
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    const now = new Date()
    const uploadId = request.nextUrl.searchParams.get('uploadId')

    // ─── Mode 2: posts of ONE upload, in CSV serial order ────────────
    if (uploadId) {
      const upload = await db.csvUpload.findFirst({
        where: { id: uploadId, userId: session.userId, accountId: id },
        select: {
          id: true,
          filename: true,
          totalPosts: true,
          intervalValue: true,
          intervalUnit: true,
          scheduleState: true,
          createdAt: true,
        },
      })
      if (!upload) {
        return NextResponse.json({ error: 'Upload not found for this account' }, { status: 404 })
      }

      const posts = await db.post.findMany({
        where: { csvUploadId: uploadId, userId: session.userId },
        select: {
          id: true,
          caption: true,
          status: true,
          publishTime: true,
          error: true,
          linkedinPostUrn: true,
          retryCount: true,
          createdAt: true,
        },
        // CSV SERIAL ORDER: publishTime ascending = CSV row order
        orderBy: [{ publishTime: 'asc' }, { createdAt: 'asc' }],
        take: 2000,
      })

      return NextResponse.json({
        upload: {
          id: upload.id,
          filename: upload.filename,
          totalPosts: upload.totalPosts,
          intervalValue: upload.intervalValue,
          intervalUnit: upload.intervalUnit,
          scheduleState: upload.scheduleState,
          createdAt: upload.createdAt.toISOString(),
        },
        posts: posts.map((p, index) => {
          const { caption, ...rest } = p
          return {
            ...rest,
            serial: index + 1, // 1-based CSV row number
            captionPreview: caption.length > 120 ? `${caption.slice(0, 120)}…` : caption,
            publishTime: p.publishTime ? p.publishTime.toISOString() : null,
            createdAt: p.createdAt.toISOString(),
          }
        }),
      })
    }

    // ─── Mode 1: account-level history overview ──────────────────────

    // Status totals for this account
    const statuses = ['published', 'scheduled', 'pending', 'processing', 'failed'] as const
    const totals: Record<string, number> = {}
    for (const s of statuses) {
      totals[s] = await db.post.count({
        where: { accountId: id, userId: session.userId, status: s },
      })
    }

    // The NEXT post this account will publish (nearest future publishTime)
    const nextPostRaw = await db.post.findFirst({
      where: {
        accountId: id,
        userId: session.userId,
        status: 'scheduled',
        publishTime: { gt: now },
      },
      orderBy: { publishTime: 'asc' },
      select: { id: true, publishTime: true, caption: true, csvUploadId: true },
    })

    // All CSV uploads for this account (newest first, capped)
    const uploadsRaw = await db.csvUpload.findMany({
      where: { accountId: id, userId: session.userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })

    interface AccountUploadHistory {
      id: string
      filename: string
      totalPosts: number
      intervalValue: number
      intervalUnit: string
      scheduleState: string
      createdAt: string
      counts: Record<string, number>
      firstPublishAt: string | null
      lastPublishAt: string | null
      nextPublishAt: string | null
    }
    const uploads: AccountUploadHistory[] = []
    for (const u of uploadsRaw) {
      // Per-upload status counts in one grouped query
      const grouped = await db.post.groupBy({
        by: ['status'],
        where: { csvUploadId: u.id, userId: session.userId },
        _count: true,
      })
      const counts: Record<string, number> = {
        published: 0,
        scheduled: 0,
        pending: 0,
        processing: 0,
        failed: 0,
      }
      for (const g of grouped) {
        counts[g.status] = g._count
      }

      // First / last / next publish time of this upload (serial order)
      const [first, last, next] = await Promise.all([
        db.post.findFirst({
          where: { csvUploadId: u.id, publishTime: { not: null } },
          orderBy: { publishTime: 'asc' },
          select: { publishTime: true },
        }),
        db.post.findFirst({
          where: { csvUploadId: u.id, publishTime: { not: null } },
          orderBy: { publishTime: 'desc' },
          select: { publishTime: true },
        }),
        db.post.findFirst({
          where: { csvUploadId: u.id, status: 'scheduled', publishTime: { gt: now } },
          orderBy: { publishTime: 'asc' },
          select: { id: true, publishTime: true },
        }),
      ])

      uploads.push({
        id: u.id,
        filename: u.filename,
        totalPosts: u.totalPosts,
        intervalValue: u.intervalValue,
        intervalUnit: u.intervalUnit,
        scheduleState: u.scheduleState,
        createdAt: u.createdAt.toISOString(),
        counts,
        firstPublishAt: first?.publishTime ? first.publishTime.toISOString() : null,
        lastPublishAt: last?.publishTime ? last.publishTime.toISOString() : null,
        nextPublishAt: next?.publishTime ? next.publishTime.toISOString() : null,
      })
    }

    return NextResponse.json({
      account: {
        id: account.id,
        accountName: account.accountName,
        linkedinMemberId: account.linkedinMemberId,
        isActive: account.isActive,
        createdAt: account.createdAt.toISOString(),
      },
      totals,
      nextPost: nextPostRaw
        ? {
            id: nextPostRaw.id,
            publishTime: nextPostRaw.publishTime
              ? nextPostRaw.publishTime.toISOString()
              : null,
            captionPreview:
              nextPostRaw.caption.length > 120
                ? `${nextPostRaw.caption.slice(0, 120)}…`
                : nextPostRaw.caption,
            uploadId: nextPostRaw.csvUploadId ?? null,
          }
        : null,
      uploads,
    })
  } catch (error) {
    console.error('Account history error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
