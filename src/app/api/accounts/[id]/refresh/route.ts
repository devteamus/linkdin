import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { encryptToken } from '@/lib/encryption'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()
    const { accessToken } = body

    if (!accessToken) {
      return NextResponse.json({ error: 'Missing required field: accessToken' }, { status: 400 })
    }

    const account = await db.linkedinAccount.findUnique({
      where: { id },
    })

    if (!account || account.userId !== session.userId) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    const encryptedToken = encryptToken(accessToken)

    const updated = await db.linkedinAccount.update({
      where: { id },
      data: {
        accessToken: encryptedToken,
        isActive: true,
      },
      select: {
        id: true,
        linkedinMemberId: true,
        accountName: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    return NextResponse.json({ account: updated })
  } catch (error) {
    console.error('Refresh account error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
