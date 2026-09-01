import { db } from '../src/lib/db'
import { hash } from 'bcryptjs'

/**
 * Seed script — creates a super admin if env vars are present.
 * Set ADMIN_EMAIL and ADMIN_PASSWORD env vars before running.
 * If env vars are missing, the script logs and exits without error
 * (so it is safe to run during container build).
 */
async function seed() {
  const email = process.env.ADMIN_EMAIL
  const password = process.env.ADMIN_PASSWORD

  if (!email || !password) {
    console.log('[seed] ADMIN_EMAIL / ADMIN_PASSWORD not set — skipping admin seed.')
    await db.$disconnect()
    return
  }

  if (password.length < 8) {
    console.error('[seed] ADMIN_PASSWORD must be at least 8 chars — skipping.')
    await db.$disconnect()
    return
  }

  const existing = await db.user.findUnique({ where: { email } })
  if (existing) {
    console.log('[seed] Admin already exists, updating role to admin & plan to pro...')
    await db.user.update({
      where: { email },
      data: { role: 'admin', plan: 'pro' },
    })
    console.log('[seed] Admin updated!')
  } else {
    const hashed = await hash(password, 12)
    await db.user.create({
      data: { email, password: hashed, name: 'Admin', role: 'admin', plan: 'pro' },
    })
    console.log('[seed] Admin created!')
  }
  await db.$disconnect()
}

seed().catch((err) => {
  console.error('[seed] Error:', err)
  process.exit(1)
})
