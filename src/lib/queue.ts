/**
 * BullMQ Queue Manager for LinkedIn Post Scheduling
 *
 * Manages the `linkedin-post-queue` for delayed job processing.
 * Replaces the old cron/polling mechanism with a proper job queue system.
 *
 * Features:
 *   - Delayed Jobs: Posts are scheduled with precise publish times
 *   - Auto-cleanup: Completed jobs are automatically removed
 *   - Retry support: Failed jobs can be retried with exponential backoff
 *   - Job priority: Supports priority-based processing
 *
 * Queue Name: linkedin-post-queue
 */

import { Queue, Job } from 'bullmq'
import redis from './redis'

// ─── Types ──────────────────────────────────────────────────────────

/**
 * Data payload for a LinkedIn post publishing job.
 */
export interface LinkedInPostJobData {
  /** The Post record ID in PostgreSQL */
  postId: string
  /** The User ID who owns this post (for tenant isolation) */
  userId: string
  /** When this post should be published (used for delay calculation) */
  scheduledAt: Date
}

/**
 * Result returned after adding a job to the queue.
 */
export interface QueuedJobResult {
  /** BullMQ job ID */
  jobId: string
  /** The Post ID */
  postId: string
  /** When the job is scheduled to process */
  scheduledAt: Date
}

// ─── Queue Configuration ────────────────────────────────────────────

/**
 * Default queue options for the LinkedIn post queue.
 */
const QUEUE_OPTIONS = {
  connection: redis,
  
  // Job settings
  defaultJobOptions: {
    // Remove completed jobs from Redis automatically
    // Keeps memory usage low for high-volume scenarios
    removeOnComplete: {
      count: 100, // Keep last 100 completed jobs for debugging
      age: 24 * 3600, // Or jobs older than 24 hours
    },
    
    // Keep some failed jobs for inspection
    removeOnFail: {
      count: 500, // Keep more failed jobs for troubleshooting
      age: 7 * 24 * 3600, // Keep for 1 week
    },
    
    // Default retry attempts (can be overridden per-job)
    attempts: 3,
    
    // Exponential backoff for retries
    backoff: {
      type: 'exponential' as const,
      delay: 5000, // Start with 5 seconds, then exponential
    },
    
    // Job timeout - max time worker has to process one post
    timeout: 120_000, // 2 minutes (accounts for media upload time)
  },
}

// ─── Queue Instance ─────────────────────────────────────────────────

/**
 * The main LinkedIn post publishing queue.
 * Uses singleton pattern to ensure single connection.
 */
const globalForQueue = globalThis as unknown as {
  linkedinPostQueue: Queue<LinkedInPostJobData> | undefined
}

export const linkedinPostQueue =
  globalForQueue.linkedinPostQueue ??
  new Queue<LinkedInPostJobData>('linkedin-post-queue', QUEUE_OPTIONS)

if (process.env.NODE_ENV !== 'production') {
  globalForQueue.linkedinPostQueue = linkedinPostQueue
}

// ─── Queue Operations ───────────────────────────────────────────────

/**
 * Add a post to the LinkedIn publishing queue with a delayed schedule.
 *
 * @param postId - The Post record ID in PostgreSQL
 * @param userId - The User ID (for audit trail and tenant isolation)
 * @param scheduledAt - When the post should be published
 * @returns Job information including the BullMQ job ID
 *
 * Example:
 * ```ts
 * const result = await addPostToQueue('post_123', 'user_456', new Date('2024-12-25T10:00:00Z'))
 * console.log(result.jobId) // 'bull:job:abc123'
 * ```
 */
export async function addPostToQueue(
  postId: string,
  userId: string,
  scheduledAt: Date
): Promise<QueuedJobResult> {
  const now = new Date()
  const delay = Math.max(0, scheduledAt.getTime() - now.getTime())
  
  const job = await linkedinPostQueue.add(
    'publish-linkedin-post',
    {
      postId,
      userId,
      scheduledAt,
    },
    {
      // Delay in milliseconds (0 or positive)
      delay,
      
      // Use scheduledAt as the job ID prefix for easier debugging
      jobId: `post-${postId}-${scheduledAt.getTime()}`,
      
      // Priority: lower number = higher priority
      // We don't use strict priority here since scheduling order matters more
      priority: 1,
    }
  )

  return {
    jobId: job.id!,
    postId,
    scheduledAt,
  }
}

/**
 * Bulk add multiple posts to the queue.
 * More efficient than calling addPostToQueue in a loop for CSV uploads.
 *
 * @param posts - Array of {postId, userId, scheduledAt} objects
 * @returns Array of queued job results
 */
export async function bulkAddPostsToQueue(
  posts: Array<{ postId: string; userId: string; scheduledAt: Date }>
): Promise<QueuedJobResult[]> {
  const now = new Date()
  
  const jobs = posts.map((post) => ({
    name: 'publish-linkedin-post' as const,
    data: {
      postId: post.postId,
      userId: post.userId,
      scheduledAt: post.scheduledAt,
    } as LinkedInPostJobData,
    opts: {
      delay: Math.max(0, post.scheduledAt.getTime() - now.getTime()),
      jobId: `post-${post.postId}-${post.scheduledAt.getTime()}`,
      priority: 1,
    },
  }))

  const addedJobs = await linkedinPostQueue.addBulk(jobs)

  return addedJobs.map((job, index) => ({
    jobId: job.id!,
    postId: posts[index].postId,
    scheduledAt: posts[index].scheduledAt,
  }))
}

/**
 * Get a specific job by its ID.
 * Useful for checking status of a previously queued post.
 */
export async function getJobStatus(jobId: string): Promise<Job<LinkedInPostJobData> | null> {
  return (await linkedinPostQueue.getJob(jobId)) ?? null
}

/**
 * Remove a job from the queue (e.g., when user deletes a scheduled post).
 * Works for both pending (delayed) and waiting jobs.
 *
 * @returns true if job was found and removed, false otherwise
 */
export async function removePostFromQueue(jobId: string): Promise<boolean> {
  const job = await linkedinPostQueue.getJob(jobId)
  if (!job) {
    return false
  }
  
  // Only remove if job hasn't started processing yet
  if (await job.isWaiting() || await job.isDelayed()) {
    await job.remove()
    return true
  }
  
  return false
}

/**
 * Get queue statistics for monitoring/health checks.
 */
export async function getQueueStats(): Promise<{
  waiting: number
  active: number
  completed: number
  failed: number
  delayed: number
}> {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    linkedinPostQueue.getWaitingCount(),
    linkedinPostQueue.getActiveCount(),
    linkedinPostQueue.getCompletedCount(),
    linkedinPostQueue.getFailedCount(),
    linkedinPostQueue.getDelayedCount(),
  ])

  return { waiting, active, completed, failed, delayed }
}

/**
 * Pause the queue (stops processing new jobs).
 * Useful during maintenance or when pausing all schedules.
 */
export async function pauseQueue(): Promise<void> {
  await linkedinPostQueue.pause()
}

/**
 * Resume the queue after pausing.
 */
export async function resumeQueue(): Promise<void> {
  await linkedinPostQueue.resume()
}

/**
 * Clean up old jobs from the queue.
 * Call periodically to free up Redis memory.
 */
export async function cleanQueue(
  graceMs: number = 24 * 3600 * 1000, // 24 hours default
  limit: number = 1000
): Promise<{
  cleaned: string[]
  current: string[]
}> {
  const [cleaned, current] = await Promise.all([
    linkedinPostQueue.clean(graceMs, limit, 'completed' as const),
    linkedinPostQueue.clean(graceMs, limit, 'failed' as const),
  ])
  
  return { cleaned, current }
}

/**
 * Gracefully close the queue connection.
 * Call during application shutdown.
 */
export async function closeQueue(): Promise<void> {
  await linkedinPostQueue.close()
  if ((globalThis as unknown as { linkedinPostQueue?: Queue }).linkedinPostQueue) {
    (globalThis as unknown as { linkedinPostQueue?: Queue }).linkedinPostQueue = undefined
  }
}

export default linkedinPostQueue
