/**
 * Redis Connection Monitor & Metrics
 *
 * CRITICAL FOR PRODUCTION: This module provides Redis connection monitoring
 * to detect connection leaks EARLY before they crash the application.
 *
 * What it monitors:
 *   - connected_clients: Total clients connected to Redis
 *   - blocked_clients: Clients blocked on blocking commands
 *   - rejected_connections: Connections rejected due to maxclients limit
 *   - used_memory: Redis memory usage
 *   - connected_slaves: Replication status (if applicable)
 *
 * Why this matters:
 *   ❌ Without monitoring, you won't know about connection leaks until Redis crashes
 *   ✅ With monitoring, you can detect leaks when connected_clients keeps growing
 *
 * Usage:
 *   import { getRedisMetrics, checkRedisHealth } from '@/lib/redis-monitor'
 */

import redis from './redis'

// ─── Types ──────────────────────────────────────────────────────────

export interface RedisConnectionMetrics {
  /** Total number of client connections (excluding this monitor's connection) */
  connected_clients: number
  /** Number of clients blocked on blocking commands (BLPOP, etc.) */
  blocked_clients: number
  /** Total connections rejected since Redis started (indicates maxclients issues!) */
  rejected_connections: number
  /** Used memory in bytes */
  used_memory: number
  /** Used memory percentage (based on maxmemory config) */
  used_memory_percent: number
  /** Memory allocator being used */
  mem_allocator: string
  /** Redis uptime in seconds */
  uptime_in_seconds: number
  /** Redis version */
  redis_version: string
  /** Whether metrics collection was successful */
  healthy: boolean
  /** Error message if metrics collection failed */
  error?: string
}

export interface RedisHealthCheckResult {
  /** Whether Redis is reachable and responding */
  healthy: boolean
  /** Latency of the ping in milliseconds */
  latencyMs: number
  /** Detailed metrics (if requested) */
  metrics?: RedisConnectionMetrics
  /** Timestamp of the check */
  timestamp: string
  /** Error message when the health check failed */
  error?: string
}

// ─── Metrics Collection ─────────────────────────────────────────────

/**
 * Get comprehensive Redis connection and memory metrics.
 * 
 * Uses INFO command to fetch all relevant metrics in one call.
 * This is safe to call frequently (every 10-30 seconds) as it's
 * a lightweight O(1) operation in Redis.
 * 
 * @returns RedisConnectionMetrics with all monitored values
 * 
 * Example:
 * ```ts
 * const metrics = await getRedisMetrics()
 * if (metrics.rejected_connections > 0) {
 *   console.warn(`⚠️ Redis has rejected ${metrics.rejected_connections} connections!`)
 * }
 * ```
 */
export async function getRedisMetrics(): Promise<RedisConnectionMetrics> {
  const defaultMetrics: RedisConnectionMetrics = {
    connected_clients: 0,
    blocked_clients: 0,
    rejected_connections: 0,
    used_memory: 0,
    used_memory_percent: 0,
    mem_allocator: 'unknown',
    uptime_in_seconds: 0,
    redis_version: 'unknown',
    healthy: false,
  }

  try {
    // Single INFO call gets everything we need efficiently
    const info = await redis.info('default', 'clients', 'memory', 'server')
    
    // Parse INFO output (Redis returns text format)
    const parseInfoValue = (infoText: string, key: string): number => {
      const regex = new RegExp(`^${key}:(\\d+)`, 'm')
      const match = infoText.match(regex)
      return match ? parseInt(match[1], 10) : 0
    }

    const parseInfoString = (infoText: string, key: string): string => {
      const regex = new RegExp(`^${key}:(.+)$`, 'm')
      const match = infoText.match(regex)
      return match ? match[1].trim() : 'unknown'
    }

    // Extract numeric values
    const connectedClients = parseInfoValue(info, 'connected_clients')
    const blockedClients = parseInfoValue(info, 'blocked_clients')
    const rejectedConnections = parseInfoValue(info, 'rejected_connections')
    const usedMemory = parseInfoValue(info, 'used_memory')
    const maxMemory = parseInfoValue(info, 'maxmemory') // 0 = no limit
    const uptimeSeconds = parseInfoValue(info, 'uptime_in_seconds')

    // Calculate memory percentage (only if maxmemory is set)
    const usedMemoryPercent = maxMemory > 0 
      ? Math.round((usedMemory / maxMemory) * 100) 
      : 0

    const metrics: RedisConnectionMetrics = {
      connected_clients: Math.max(0, connectedClients - 1), // Subtract this monitor's connection
      blocked_clients: blockedClients,
      rejected_connections: rejectedConnections,
      used_memory: usedMemory,
      used_memory_percent: usedMemoryPercent,
      mem_allocator: parseInfoString(info, 'mem_allocator'),
      uptime_in_seconds: uptimeSeconds,
      redis_version: parseInfoString(info, 'redis_version'),
      healthy: true,
    }

    // ⚠️ ALERT: Log warning if we see rejected connections (connection leak indicator!)
    if (rejectedConnections > 0) {
      console.warn(
        `[redis-monitor] ⚠️ Redis has REJECTED ${rejectedConnections} connection(s) since startup! ` +
        `This may indicate a connection leak or maxclients limit reached.`
      )
    }

    // ⚠️ ALERT: Log warning if too many clients connected
    if (connectedClients > 50) {
      console.warn(
        `[redis-monitor] ⚠️ High Redis client count: ${connectedClients}. ` +
        `Expected: ~3-5 (1 web queue + 1 worker + monitors). May indicate connection leak.`
      )
    }

    return metrics

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[redis-monitor] Failed to collect Redis metrics:`, errorMessage)
    
    return {
      ...defaultMetrics,
      error: errorMessage,
      healthy: false,
    }
  }
}

/**
 * Perform a quick Redis health check.
 * 
 * Much lighter than getRedisMetrics() - just sends a PING command.
 * Use this for load balancer health checks (/health endpoint).
 * 
 * @param includeMetrics - Whether to also collect detailed metrics
 * @returns RedisHealthCheckResult with status and optional metrics
 * 
 * Example:
 * ```ts
 * const health = await checkRedisHealth()
 * if (!health.healthy) {
 *   // Return 503 Service Unavailable
 * }
 * ```
 */
export async function checkRedisHealth(
  includeMetrics: boolean = false
): Promise<RedisHealthCheckResult> {
  const startTime = Date.now()
  const timestamp = new Date().toISOString()

  try {
    // Simple PING command - fastest health check
    const result = await redis.ping()
    const latencyMs = Date.now() - startTime

    if (result !== 'PONG') {
      return {
        healthy: false,
        latencyMs,
        timestamp,
        error: `Unexpected PING response: ${result}`,
      }
    }

    // Optionally include detailed metrics
    const metrics = includeMetrics ? await getRedisMetrics() : undefined

    return {
      healthy: true,
      latencyMs,
      metrics,
      timestamp,
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    const latencyMs = Date.now() - startTime

    console.error(`[redis-monitor] Redis health check failed:`, errorMessage)

    return {
      healthy: false,
      latencyMs,
      timestamp,
      error: errorMessage,
    }
  }
}

/**
 * Get expected vs actual Redis connection count.
 * 
 * Helps identify connection leaks by comparing expected vs actual counts.
 * 
 * Expected connections for PostGo architecture:
 *   - Web app Queue connection: 1
 *   - Worker connection: 1  
 *   - Monitoring/health checks: 0-2 (transient)
 *   - Total expected: 2-4 persistent connections
 * 
 * @returns Object with expected count, actual count, and whether there's a potential leak
 */
export async function analyzeConnections(): Promise<{
  expected: number
  actual: number
  potentialLeak: boolean
  details: string
}> {
  const metrics = await getRedisMetrics()
  
  // Expected persistent connections based on architecture
  const expectedConnections = 3 // 1 (web queue) + 1 (worker) + 1 (monitoring buffer)
  const actualConnections = metrics.connected_clients
  
  // Consider it a potential leak if we have more than 2x expected connections
  const potentialLeak = actualConnections > expectedConnections * 2
  
  let details = ''
  if (potentialLeak) {
    details = (
      `⚠️ POTENTIAL CONNECTION LEAK DETECTED!\n` +
      `   Expected: ~${expectedConnections} persistent connections\n` +
      `   Actual: ${actualConnections} connections\n` +
      `   Rejected (total): ${metrics.rejected_connections} connections\n` +
      `   Action: Check for new Redis()/Queue()/Worker() calls in loops or request handlers`
    )
  } else {
    details = (
      `✅ Connection count looks normal.\n` +
      `   Expected: ~${expectedConnections}\n` +
      `   Actual: ${actualConnections}\n` +
      `   Rejected (total): ${metrics.rejected_connections}`
    )
  }

  return {
    expected: expectedConnections,
    actual: actualConnections,
    potentialLeak,
    details,
  }
}

export default {
  getRedisMetrics,
  checkRedisHealth,
  analyzeConnections,
}
