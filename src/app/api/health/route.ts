import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { checkRedisHealth, getRedisMetrics } from '@/lib/redis-monitor'

// Tell Next.js this route should always run on the server, never be cached.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/health
 * 
 * Comprehensive health check endpoint for:
 *   - PostgreSQL database connectivity
 *   - Redis connectivity (BullMQ backend)
 *   - Application uptime
 *   - Response latency
 * 
 * CRITICAL: This endpoint does NOT create new Redis connections!
 * It reuses the existing singleton Redis client via redis-monitor.
 * 
 * Safe to call every 10-30 seconds by load balancers / Docker health checks.
 * 
 * Response format:
 * {
 *   status: 'ok' | 'degraded',
 *   uptime: 123.456,
 *   db: 'ok' | 'error',
 *   redis: 'ok' | 'error' | 'missing',
 *   latencyMs: 12,
 *   time: '2024-01-01T00:00:00.000Z',
 *   redisMetrics?: { ... }  // Only if includeMetrics=true
 * }
 */
export async function GET(request: Request) {
  const start = Date.now()
  
  // Check if detailed metrics were requested
  const url = new URL(request.url)
  const includeMetrics = url.searchParams.get('metrics') === 'true'
  
  try {
    // ─── Parallel Health Checks ─────────────────────────────────────
    // Run DB and Redis checks concurrently for faster response
    
    const [dbResult, redisHealth] = await Promise.allSettled([
      // Database health: Simple query that fails fast if DB is unreachable
      db.$queryRaw`SELECT 1`,
      
      // Redis health: PING command (lightweight, no connection creation!)
      checkRedisHealth(includeMetrics),
    ])

    // Parse database health
    const dbOk = dbResult.status === 'fulfilled'
    const dbError = dbResult.status === 'rejected' ? dbResult.reason : null

    // Parse Redis health  
    const redisOk = redisHealth.status === 'fulfilled' && redisHealth.value.healthy
    const redisData = redisHealth.status === 'fulfilled' ? redisHealth.value : null
    const redisError = redisHealth.status === 'rejected' ? redisHealth.reason : null

    // Determine overall status
    const overallStatus = (dbOk && redisOk) ? 'ok' : 'degraded'
    
    // Calculate total latency
    const latencyMs = Date.now() - start

    // Build response
    const response = {
      status: overallStatus,
      uptime: process.uptime(),
      db: dbOk ? 'ok' : 'error',
      redis: redisOk ? 'ok' : (redisData ? 'error' : 'missing'),
      latencyMs,
      time: new Date().toISOString(),
      
      // Include error details in degraded mode (helpful for debugging)
      ...(overallStatus === 'degraded' ? {
        errors: {
          ...(dbOk ? {} : { db: dbError instanceof Error ? dbError.message : 'Database connection failed' }),
          ...(redisOk ? {} : { redis: redisError?.message || redisData?.error || 'Redis connection failed' }),
        }
      } : {}),
      
      // Include Redis metrics if requested (for monitoring dashboards)
      ...(includeMetrics && redisData?.metrics ? {
        redisMetrics: redisData.metrics,
      } : {}),
    }

    // Return appropriate HTTP status code
    const httpStatus = overallStatus === 'ok' ? 200 : 503

    return NextResponse.json(response, { status: httpStatus })
    
  } catch (err) {
    // Fallback: Something unexpected went wrong with the health check itself
    console.error('[health] Unexpected error:', err)
    return NextResponse.json(
      {
        status: 'degraded',
        db: 'unknown',
        redis: 'unknown',
        latencyMs: Date.now() - start,
        time: new Date().toISOString(),
        error: err instanceof Error ? err.message : 'Unknown health check error',
      },
      { status: 503 }
    )
  }
}
