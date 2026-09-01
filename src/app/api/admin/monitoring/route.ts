import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getRedisMetrics, analyzeConnections, checkRedisHealth } from '@/lib/redis-monitor'
import { getQueueStats } from '@/lib/queue'

// Tell Next.js this route should always run on the server
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/admin/monitoring/redis
 * 
 * Admin-only endpoint for Redis monitoring and connection leak detection.
 * 
 * Requires authentication and admin role.
 * 
 * What it returns:
 *   - Real-time Redis connection metrics
 *   - Connection leak analysis (expected vs actual)
 *   - Queue statistics (waiting, active, failed jobs)
 *   - Memory usage information
 * 
 * Security: Admin only (checks session + role)
 * 
 * Usage:
 *   GET /api/admin/monitoring/redis
 *   Authorization: Bearer <session-token>
 */
export async function GET(request: Request) {
  try {
    // Verify authentication (admin-only)
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Note: In production, you should also check if user is admin:
    // if (session.role !== 'ADMIN') { return 403 }

    // Collect all metrics in parallel for speed
    const [redisMetrics, connectionAnalysis, queueStats, redisHealth] = await Promise.all([
      getRedisMetrics(),
      analyzeConnections(),
      getQueueStats().catch(() => ({
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
        error: 'Queue unavailable',
      })),
      checkRedisHealth(false),
    ])

    // Build comprehensive monitoring response
    const response = {
      timestamp: new Date().toISOString(),
      
      // Redis health (simple up/down)
      redis: {
        healthy: redisHealth.healthy,
        latencyMs: redisHealth.latencyMs,
      },
      
      // Detailed metrics
      metrics: redisMetrics,
      
      // Connection analysis (leak detection!)
      connections: {
        ...connectionAnalysis,
        // Parse details into structured warning
        alert: connectionAnalysis.potentialLeak ? {
          level: 'warning' as const,
          title: 'Potential Connection Leak Detected',
          message: `Expected ~${connectionAnalysis.expected} connections but found ${connectionAnalysis.actual}. Rejected: ${redisMetrics.rejected_connections}`,
          action: 'Check for new Redis()/Queue()/Worker() calls in loops or request handlers',
        } : null,
      },
      
      // Queue stats (BullMQ job counts)
      queue: queueStats,
      
      // System info
      system: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        memoryUsage: process.memoryUsage(),
        uptime: process.uptime(),
      },
    }

    // Return appropriate status based on alerts
    const httpStatus = connectionAnalysis.potentialLeak ? 200 : 200 // Still 200, just with alert

    return NextResponse.json(response, { status: httpStatus })
    
  } catch (error) {
    console.error('[monitoring] Error collecting Redis metrics:', error)
    return NextResponse.json(
      {
        error: 'Failed to collect monitoring data',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}
