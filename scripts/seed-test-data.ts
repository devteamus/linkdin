// Test data insertion script — creates a fake LinkedIn account + CSV upload
// for the test@postgo.local user, so we can verify the schedule management
// controls work end-to-end in the dashboard.

import { db } from '../src/lib/db'
import { encryptToken } from '../src/lib/encryption'

async function main() {
  const user = await db.user.findUnique({ where: { email: 'test@postgo.local' } })
  if (!user) {
    console.error('Test user not found')
    process.exit(1)
  }

  // Encryption key is needed by encryptToken
  if (!process.env.ENCRYPTION_KEY) {
    console.error('ENCRYPTION_KEY not set')
    process.exit(1)
  }
  // Override the encryption key to something predictable for testing
  const fakeToken = encryptToken('fake-access-token-for-testing')

  // 1. Create a fake LinkedIn account
  const account = await db.linkedinAccount.create({
    data: {
      userId: user.id,
      linkedinMemberId: 'test_member_123',
      accountName: 'Test LinkedIn Account',
      accessToken: fakeToken,
      isActive: true,
    },
  })
  console.log('Created test account:', account.id)

  // 2. Create a fake CSV upload with various post states
  const csvUpload = await db.csvUpload.create({
    data: {
      userId: user.id,
      accountId: account.id,
      filename: 'test_upload.csv',
      totalPosts: 5,
      intervalValue: 30,
      intervalUnit: 'minute',
      status: 'completed',
      scheduleState: 'active',
    },
  })
  console.log('Created test CSV upload:', csvUpload.id)

  // 3. Create 5 posts: 2 published, 2 scheduled, 1 failed
  const now = new Date()
  const inOneHour = new Date(now.getTime() + 60 * 60 * 1000)
  const inTwoHours = new Date(now.getTime() + 2 * 60 * 60 * 1000)
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  await db.post.createMany({
    data: [
      {
        userId: user.id,
        accountId: account.id,
        caption: 'Published post #1 with image',
        imageUrl: 'https://example.com/image1.jpg',
        status: 'published',
        publishTime: yesterday,
        csvUploadId: csvUpload.id,
      },
      {
        userId: user.id,
        accountId: account.id,
        caption: 'Published post #2 with video',
        videoUrl: 'https://example.com/video1.mp4',
        status: 'published',
        publishTime: yesterday,
        csvUploadId: csvUpload.id,
      },
      {
        userId: user.id,
        accountId: account.id,
        caption: 'Scheduled post #1 with comment',
        comment: 'Auto-comment for scheduled post',
        status: 'scheduled',
        publishTime: inOneHour,
        csvUploadId: csvUpload.id,
      },
      {
        userId: user.id,
        accountId: account.id,
        caption: 'Scheduled post #2 (text only)',
        status: 'scheduled',
        publishTime: inTwoHours,
        csvUploadId: csvUpload.id,
      },
      {
        userId: user.id,
        accountId: account.id,
        caption: 'Failed post',
        status: 'failed',
        publishTime: yesterday,
        error: 'LinkedIn API returned 401: token expired',
        csvUploadId: csvUpload.id,
      },
    ],
  })
  console.log('Created 5 test posts')

  await db.$disconnect()
  console.log('Done!')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
