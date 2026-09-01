import { PrismaClient, Prisma } from '@prisma/client'
import { AsyncLocalStorage } from 'node:async_hooks'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Only enable query logging in development — production logs must stay clean.
const isDev = process.env.NODE_ENV !== 'production'

// ─── Async Local Storage for Per-Request Tenant Isolation ──────────
//
// AsyncLocalStorage ensures TRUE per-request isolation:
//   - Each HTTP request gets its own storage context
//   - Concurrent requests NEVER interfere with each other

const tenantAsyncStorage = new AsyncLocalStorage<string | null>()

/**
 * Get the current request's tenant ID safely.
 * Returns null if no tenant context is set (e.g., admin operations).
 */
function getCurrentTenantId(): string | null {
  return tenantAsyncStorage.getStore() || null
}

// ─── Tenant Context API ─────────────────────────────────────────────

export async function runInTenantContext<T>(
  userId: string,
  fn: () => Promise<T>
): Promise<T> {
  return tenantAsyncStorage.run(userId, fn)
}

export function setTenantContext(userId: string): void {
  console.warn(
    '[db] setTenantContext() called outside runInTenantContext(). ' +
    'Use runInTenantContext(userId, fn) for proper isolation.'
  )
}

export function clearTenantContext(): void {
  // No-op: AsyncLocalStorage handles cleanup automatically
}

export function getTenantId(): string | null {
  return getCurrentTenantId()
}

export async function withTenantAuth<T>(
  request: Request,
  handler: (session: { userId: string }) => Promise<T>
): Promise<T> {
  const { getSession } = await import('./auth')
  // getSession accepts both plain Request and NextRequest (cookie parsing built-in)
  const session = await getSession(request)

  if (!session) {
    throw new Error('Unauthorized')
  }

  return runInTenantContext(session.userId, () => handler(session))
}

// ─── Prisma Client Creation ─────────────────────────────────────────

function createBasePrismaClient(): PrismaClient {
  return new PrismaClient({
    log: isDev ? ['query', 'error', 'warn'] : ['error', 'warn'],
    datasourceUrl: process.env.DATABASE_URL,
  })
}

// ─── Tenant Isolation via Client Extension ($extends) ───────────────
//
// CRITICAL FIX: The old implementation used `client.$use()` middleware.
// Prisma removed $use in recent 6.x releases (this project resolves to
// Prisma 6.19.x), so calling $use threw "client.$use is not a function"
// at import time — crashing EVERY route that touches the database.
//
// We now use the supported `$extends({ query })` client extension API,
// which injects the same userId tenant filters. Behavior is identical:
//   - Read ops get `where.userId` injected
//   - create/createMany get `data.userId` enforced
//   - update/upsert/delete get `where.userId` injected

const TENANT_MODELS = new Set<string>([
  'Post',
  'LinkedinAccount',
  'CsvUpload',
  'Payment',
  'ApiUsageLog',
  'PasswordResetToken',
])

type QueryArgs = Record<string, unknown> & {
  where?: Record<string, unknown>
  data?: unknown
}

function applyTenantScope(operation: string, rawArgs: unknown, tenantId: string): QueryArgs {
  const args: QueryArgs = (rawArgs as QueryArgs) ?? {}

  switch (operation) {
    case 'findMany':
    case 'findFirst':
    case 'findFirstOrThrow':
    case 'findUnique':
    case 'findUniqueOrThrow':
    case 'count':
    case 'aggregate':
    case 'groupBy':
      args.where = { ...(args.where ?? {}), userId: tenantId }
      break

    case 'create':
      args.data = { ...((args.data as Record<string, unknown>) ?? {}), userId: tenantId }
      break

    case 'createMany':
    case 'createManyAndReturn': {
      const data = args.data
      if (Array.isArray(data)) {
        args.data = (data as Record<string, unknown>[]).map(
          (item) => ({ ...item, userId: tenantId })
        )
      } else {
        args.data = { ...((data as Record<string, unknown>) ?? {}), userId: tenantId }
      }
      break
    }

    case 'update':
    case 'upsert':
    case 'updateMany':
    case 'updateManyAndReturn':
    case 'delete':
    case 'deleteMany':
      args.where = { ...(args.where ?? {}), userId: tenantId }
      break
  }

  return args
}

function createPrismaWithTenantIsolation(): PrismaClient {
  const client = createBasePrismaClient()

  const extended = client.$extends({
    query: {
      $allModels: {
        async $allOperations({
          model,
          operation,
          args,
          query,
        }: {
          model?: string
          operation: string
          args: unknown
          query: (args: unknown) => Promise<unknown>
        }) {
          const tenantId = getCurrentTenantId()
          if (model && tenantId && TENANT_MODELS.has(model)) {
            args = applyTenantScope(operation, args, tenantId)
          }
          return query(args)
        },
      },
    },
  })

  // The extended client is API-compatible with PrismaClient for all model
  // operations used across this codebase, so we cast back for convenience.
  return extended as unknown as PrismaClient
}

// Create the enhanced Prisma client with tenant isolation
export const db =
  globalForPrisma.prisma ??
  createPrismaWithTenantIsolation()

if (isDev) globalForPrisma.prisma = db

// Re-export types for convenience
export type {
  User,
  Post,
  LinkedinAccount,
  CsvUpload,
  Payment,
  ApiUsageLog,
  UserRole,
  Plan,
  PostStatus,
  CsvUploadStatus,
  ScheduleState,
  PaymentStatus,
} from '@prisma/client'
