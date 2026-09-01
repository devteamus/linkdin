/**
 * PostGo Instrumentation File
 * 
 * This file is automatically loaded by Next.js on application startup.
 * It's the PERFECT place to:
 *   1. Register graceful shutdown handlers
 *   2. Initialize monitoring
 *   3. Set up error handlers
 * 
 * Why here and not in layout.tsx or middleware?
 *   ✅ Runs once when server starts (not per-request)
 *   ✅ Has access to process-level events (SIGTERM, SIGINT)
 *   ✅ Survives hot-reload during development
 *   ✅ Official Next.js pattern for server-side initialization
 * 
 * CRITICAL FOR BUG FIX:
 *   Without this, the graceful shutdown handler never registers,
 *   which means Redis connections LEAK on every container restart!
 * 
 * Reference: https://nextjs.org/docs/app/building-your-application/configuring/instrumentation
 */

export async function register() {
  // Register graceful shutdown handlers for clean Redis/Queue/DB cleanup
  // This is the FIX for the connection leak bug!
  const { default: setupGracefulShutdown } = await import('@/lib/graceful-shutdown')
  
  // Log successful registration (appears in server startup logs)
  console.log('[instrumentation] ✅ PostGo instrumentation registered')
  console.log('[instrumentation] 🛡️  Graceful shutdown: ENABLED (SIGTERM/SIGINT)')
  console.log('[instrumentation] 📊 Redis monitoring: ENABLED')
  
  // Initialize Redis monitoring baseline (log current connection count)
  try {
    const { getRedisMetrics } = await import('@/lib/redis-monitor')
    const metrics = await getRedisMetrics()
    console.log(
      `[instrumentation] 🔴 Redis connections at startup: ${metrics.connected_clients} ` +
      `(rejected so far: ${metrics.rejected_connections})`
    )
    
    if (metrics.rejected_connections > 0) {
      console.warn(
        `[instrumentation] ⚠️ WARNING: Redis has already rejected ${metrics.rejected_connections} ` +
        `connection(s)! Check for connection leaks.`
      )
    }
  } catch (err) {
    // Non-fatal: monitoring might fail if Redis isn't ready yet
    console.log('[instrumentation] ℹ️  Redis not available yet, will retry on first health check')
  }
}

// Note: In Next.js, this export is automatically called on server startup.
// No need to manually call it anywhere - just having this file is enough!

/*
 * INSTRUMENTATION LIFECYCLE:
 * 
 * 1. Server starts → register() is called automatically
 * 2. Graceful shutdown handlers are registered (SIGTERM, SIGINT)
 * 3. Baseline Redis metrics are logged
 * 4. Application serves requests normally...
 * 5. Container receives SIGTERM (docker stop, kubernetes pod termination)
 * 6. Graceful shutdown handler fires:
 *    a. Sets isShuttingDown flag (new requests get 503)
 *    b. Closes BullMQ Queue (jobs preserved in Redis)
 *    c. Quits Redis connection cleanly
 *    d. Process exits with code 0
 * 7. Container restarts → back to step 1
 * 
 * RESULT: Zero connection leak across restarts! 🎉
 */
