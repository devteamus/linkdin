/**
 * Redis Connection Helper
 *
 * Provides a singleton Redis client instance configured for use with BullMQ.
 * Uses ioredis with settings optimized for job queue operations.
 *
 * Configuration:
 *   - REDIS_URL: Full Redis connection string (redis://host:port/db)
 *   - Falls back to redis://localhost:6379 if not set
 *
 * Key Settings:
 *   - maxRetriesPerRequest: null (required by BullMQ for proper error handling)
 *   - Connection retry logic for resilience
 */

import Redis from 'ioredis'

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined
}

/**
 * Get the Redis URL from environment variables.
 * Supports both full connection strings and host:port format.
 */
function getRedisUrl(): string {
  const url = process.env.REDIS_URL
  if (url) {
    return url
  }
  
  // Fallback to individual components
  const host = process.env.REDIS_HOST || 'localhost'
  const port = process.env.REDIS_PORT || '6379'
  const password = process.env.REDIS_PASSWORD
  const db = process.env.REDIS_DB || '0'

  if (password) {
    return `redis://:${password}@${host}:${port}/${db}`
  }
  return `redis://${host}:${port}/${db}`
}

/**
 * Create a new Redis client instance with BullMQ-optimized settings.
 *
 * Important: maxRetriesPerRequest must be null for BullMQ compatibility.
 * This allows BullMQ to handle its own retry logic rather than relying
 * on ioredis's built-in retry mechanism, which can cause issues with
 * queue command processing.
 */
function createRedisClient(): Redis {
  const url = getRedisUrl()
  
  const client = new Redis(url, {
    // CRITICAL: Must be null for BullMQ
    // When set to null, ioredis will not retry commands that fail,
    // allowing BullMQ's own retry mechanism to handle failures properly
    maxRetriesPerRequest: null,
    
    // Connection settings
    enableReadyCheck: true,
    keepAlive: 10000, // Send ping every 10 seconds
    connectTimeout: 10000, // 10 second connection timeout
    
    // Reconnection strategy
    retryStrategy: (times: number) => {
      // Exponential backoff with max delay of 3 seconds
      const delay = Math.min(times * 200, 3000)
      return delay
    },
  })

  // Connection event handlers
  client.on('connect', () => {
    console.log('[redis] Connected to Redis')
  })

  client.on('ready', () => {
    console.log('[redis] Redis connection ready')
  })

  client.on('error', (err: Error) => {
    console.error('[redis] Connection error:', err.message)
  })

  client.on('close', () => {
    console.warn('[redis] Connection closed')
  })

  client.on('reconnecting', () => {
    console.log('[redis] Reconnecting...')
  })

  return client
}

// Singleton pattern - reuse the same connection across the application
export const redis =
  globalForRedis.redis ??
  createRedisClient()

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.redis = redis
}

/**
 * Gracefully close the Redis connection.
 * Call this during application shutdown to ensure clean disconnect.
 */
export async function closeRedisConnection(): Promise<void> {
  if (globalForRedis.redis) {
    await globalForRedis.redis.quit()
    globalForRedis.redis = undefined
  }
}

/**
 * Check if Redis connection is ready.
 * Useful for health checks and startup validation.
 */
export async function isRedisHealthy(): Promise<boolean> {
  try {
    const result = await redis.ping()
    return result === 'PONG'
  } catch {
    return false
  }
}

export default redis
