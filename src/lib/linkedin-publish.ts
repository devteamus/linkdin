/**
 * LinkedIn Publishing Client
 *
 * Actually publishes a post to LinkedIn via the REST Posts API:
 *   POST https://api.linkedin.com/rest/posts
 *
 * Supports:
 *   - Text-only posts
 *   - Image posts (image_url) — uploaded to LinkedIn's image asset storage
 *   - Video posts (video_url) — uploaded to LinkedIn's video asset storage
 *
 * NOTE: Auto-commenting was tried and removed — it requires LinkedIn's
 * Community Management API product access, which this app does not have.
 * Every call attempt (legacy v2 and versioned REST, share URN and
 * activity URN) returned 404.
 *
 * Required OAuth scopes (already requested by linkedin/auth/route.ts):
 *   w_member_social   — required to publish posts on behalf of the member
 *   openid profile    — to read authorUrn (member URN)
 *
 * The LinkedIn member URN format is: urn:li:member:<memberId>
 * The author URN format is: urn:li:person:<memberId>  (for REST Posts API)
 *
 * Reference: https://learn.microsoft.com/linkedin/marketing/integrations/community-management/shares/ugc-post-api
 *            https://learn.microsoft.com/linkedin/marketing/integrations/community-management/shares/posts-api
 *
 * ─── RATE LIMITING (Bugs #1–#6 fixes) ────────────────────────────────────
 *
 * EVERY call to api.linkedin.com goes through linkedinRestFetch() below,
 * which enforces — no matter which path triggers it (BullMQ worker,
 * cron, manual "Publish Now"):
 *
 *   a) PER-MEMBER sliding-window throttle (Redis, atomic Lua) keyed by
 *      linkedinMemberId — LinkedIn throttles per member identity, so this
 *      mirrors their view. A publish with image = 2 REST calls, video = 3+
 *      REST calls — each call acquires its own slot (Bug #4: previously
 *      the limiter counted 1 "job" and let 2-3x the real call volume out).
 *
 *   b) The plan's per-account 24h API budget (Free/Pro 150, Enterprise
 *      500) checked against ApiUsageLog BEFORE the call is made (Bug #5:
 *      the limit was documented as "enforced" but nothing ever enforced
 *      it — the worker limiter alone allowed thousands of calls per day).
 *
 *   c) LinkedIn 429 responses are honored: we read their Retry-After
 *      header, wait (bounded), and retry ONCE in-flight. If still
 *      throttled we throw an error that explicitly contains "429" so the
 *      worker's retry classifier treats it as rate-limit (Bug #6: the old
 *      message "LinkedIn rate limit hit…" contained no "429", fell into
 *      the default-retriable bucket, and was retried after just 5s —
 *      deepening the throttle and burning the post's 3 attempts).
 *
 *   d) 401/403 messages now include the words "Unauthorized"/"Forbidden"
 *      so the worker classifies them PERMANENT instead of retrying a
 *      dead token 3 times.
 */

import { decryptToken } from './encryption'
import { db } from './db'
import {
  acquireMemberSlotWithWait,
  LINKEDIN_RATE_LIMIT_MAX,
  LINKEDIN_RATE_LIMIT_WINDOW_MS,
} from './linkedin-rate-limiter'
import { getPlanLimits } from './plan-limits'
import { getEffectivePlan } from './plan-helpers'
import type { Plan } from '@prisma/client'

const LINKEDIN_VERSION = '202607'

// ─── API Usage Tracking ────────────────────────────────────────────

/**
 * Log a single LinkedIn API call to the ApiUsageLog table.
 * Used to enforce the 150-calls / 24-hour LinkedIn API safety limit.
 *
 * Failures here are non-fatal — we just log them and continue. A failure
 * to record usage must never block an actual publish.
 */
async function logApiCall(
  userId: string,
  accountId: string | undefined,
  endpoint: string,
  method: string,
  status: number
): Promise<void> {
  try {
    await db.apiUsageLog.create({
      data: { userId, accountId: accountId || null, endpoint, method, status },
    })
  } catch (err) {
    // Non-fatal — just log to console
    console.warn('[api-usage] Failed to log API call:', err)
  }
}

// ─── Bug #5: enforce the plan's per-account 24h API call budget ─────

/**
 * Throws BEFORE the LinkedIn call is made when the account has already
 * consumed its plan's per-account API budget in the last 24h.
 *
 * The thrown message deliberately contains "daily API budget exhausted"
 * which the worker classifies as a PERMANENT error (no pointless retries).
 */
async function enforceDailyApiBudget(
  userId: string,
  accountId: string | undefined
): Promise<void> {
  if (!userId) return
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const used = await db.apiUsageLog.count({
      where: {
        userId,
        ...(accountId ? { accountId } : {}),
        createdAt: { gte: since },
      },
    })

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { plan: true, planExpiresAt: true },
    })
    const rawPlan = (user?.plan as Plan) || 'free'
    const effectivePlan = getEffectivePlan(rawPlan, user?.planExpiresAt ?? null)
    const limit = getPlanLimits(effectivePlan).maxApiCallsPerDay

    if (used >= limit) {
      throw new Error(
        `Daily LinkedIn API budget exhausted for this account: ${used}/${limit} calls in the last 24h ` +
        `(${effectivePlan} plan). Posting automatically resumes when the oldest calls in the 24h window expire — ` +
        'no action needed, do not retry.'
      )
    }
  } catch (err) {
    // Re-throw OUR limit error; swallow infrastructure errors (a broken
    // usage counter must never block publishing).
    if (err instanceof Error && err.message.includes('Daily LinkedIn API budget exhausted')) {
      throw err
    }
    console.warn('[api-usage] Could not verify daily budget (continuing):', err)
  }
}

// ─── Bug #2/#4/#6: rate-limited LinkedIn REST fetch wrapper ─────────

interface LinkedInCallContext {
  /** LinkedIn member id — the identity LinkedIn throttles by (Bug #1) */
  memberId: string
  userId: string
  accountId: string
  endpoint: string
  method: string
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Parse LinkedIn's Retry-After header (seconds) into a bounded wait. */
function parseRetryAfterSeconds(res: Response): number {
  const raw = parseInt(res.headers.get('retry-after') || '', 10)
  if (!Number.isFinite(raw) || raw <= 0) return 60
  return Math.min(raw, 120) // cap: never sleep longer than 2 minutes in-flight
}

/**
 * Makes ONE logical LinkedIn REST API call:
 *   1. enforce the per-account 24h budget (Bug #5)
 *   2. acquire a per-member throttle slot, waiting + re-checking if the
 *      member's window is saturated (Bugs #1, #2, #4)
 *   3. fetch, with a fresh AbortSignal.timeout per attempt
 *   4. log the call to ApiUsageLog
 *   5. on 429: honor Retry-After, retry once (Bug #6)
 */
async function linkedinRestFetch(
  ctx: LinkedInCallContext,
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  await enforceDailyApiBudget(ctx.userId, ctx.accountId)

  const doAttempt = async (): Promise<Response> => {
    const decision = await acquireMemberSlotWithWait(ctx.memberId, { maxWaitMs: 60_000 })
    if (!decision.allowed) {
      throw new Error(
        `LinkedIn per-member rate limit still saturated after 60s of waiting (429 backpressure, ` +
        `${decision.used}/${LINKEDIN_RATE_LIMIT_MAX} calls in the last ` +
        `${LINKEDIN_RATE_LIMIT_WINDOW_MS / 1000}s window) — backing off, will retry later`
      )
    }
    return fetch(url, {
      ...init,
      // Fresh signal per attempt so a Retry-After wait doesn't eat the budget
      signal: AbortSignal.timeout(timeoutMs),
    })
  }

  let res = await doAttempt()
  await logApiCall(ctx.userId, ctx.accountId, ctx.endpoint, ctx.method, res.status)

  if (res.status === 429) {
    const retryAfterSec = parseRetryAfterSeconds(res)
    console.warn(
      `[linkedin] 429 rate limit on ${ctx.endpoint} — honoring Retry-After: ${retryAfterSec}s, retrying once`
    )
    await sleep(retryAfterSec * 1000)

    res = await doAttempt()
    await logApiCall(ctx.userId, ctx.accountId, ctx.endpoint, ctx.method, res.status)

    if (res.status === 429) {
      throw new Error(
        `LinkedIn API 429 rate limit hit — waited ${retryAfterSec}s (Retry-After) and still throttled. ` +
        'Job will retry with backoff; the per-member window needs time to drain.'
      )
    }
  }

  return res
}

// ─── Helpers ───────────────────────────────────────────────────────

function isVideoUrl(url: string): boolean {
  const lower = url.toLowerCase().split('?')[0].split('#')[0]
  return (
    lower.endsWith('.mp4') ||
    lower.endsWith('.mov') ||
    lower.endsWith('.avi') ||
    lower.endsWith('.mkv') ||
    lower.endsWith('.webm')
  )
}

async function isVideoContent(url: string): Promise<boolean> {
  // First check by extension
  if (isVideoUrl(url)) return true
  // Otherwise HEAD the URL and check the content-type header.
  // IMPORTANT: use HEAD, not GET — a GET here would download the entire
  // file body (potentially a multi-hundred-MB video) just to read one
  // header. For a CSV with hundreds of media_url rows, that would make
  // bulk upload extremely slow or time out the request.
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(8000),
    })
    const contentType = (res.headers.get('content-type') || '').toLowerCase()
    if (contentType.startsWith('video/')) return true
    if (contentType.startsWith('image/')) return false
  } catch {
    // Some servers don't support HEAD — fall back to extension check
    // (already done above). We deliberately do NOT fall back to a full
    // GET here for the same size/latency reason.
  }
  return false
}

// ─── Image Upload ──────────────────────────────────────────────────

/**
 * Uploads an externally-hosted image into LinkedIn's own asset storage and
 * returns the resulting image URN (urn:li:image:xxx).
 */
async function uploadImageToLinkedIn(
  accessToken: string,
  authorUrn: string,
  authorMemberId: string,
  imageUrl: string,
  userId: string,
  accountId: string
): Promise<string> {
  // Step 1: ask LinkedIn to initialize an upload slot for this owner.
  const initRes = await linkedinRestFetch(
    { memberId: authorMemberId, userId, accountId, endpoint: '/rest/images?action=initializeUpload', method: 'POST' },
    'https://api.linkedin.com/rest/images?action=initializeUpload',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
        'LinkedIn-Version': LINKEDIN_VERSION,
      },
      body: JSON.stringify({ initializeUploadRequest: { owner: authorUrn } }),
    },
    15000
  )

  if (!initRes.ok) {
    const errText = await initRes.text().catch(() => '')
    throw new Error(
      `LinkedIn rejected the image upload request (${initRes.status}): ${errText.slice(0, 200) || 'no details'}`
    )
  }

  const initData = await initRes.json().catch(() => null)
  const uploadUrl: string | undefined = initData?.value?.uploadUrl
  const imageUrn: string | undefined = initData?.value?.image

  if (!uploadUrl || !imageUrn) {
    throw new Error('LinkedIn did not return an upload URL / image URN — image upload cannot proceed')
  }

  // Step 2: fetch the source image from the caller-supplied public URL.
  let imageBuffer: Buffer
  try {
    const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(20000) })
    if (!imgRes.ok) {
      throw new Error(`could not fetch image_url (HTTP ${imgRes.status})`)
    }
    const contentType = imgRes.headers.get('content-type') || ''
    if (!contentType.startsWith('image/')) {
      throw new Error(`image_url did not return an image (content-type: ${contentType || 'unknown'})`)
    }
    const arrayBuffer = await imgRes.arrayBuffer()
    imageBuffer = Buffer.from(arrayBuffer)
    if (imageBuffer.byteLength === 0) {
      throw new Error('image_url returned an empty file')
    }
    if (imageBuffer.byteLength > 200 * 1024 * 1024) {
      throw new Error('image is larger than 200MB — LinkedIn will reject it')
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error fetching image'
    throw new Error(`Failed to fetch image_url — it must be a public, directly-loadable image URL (${msg})`)
  }

  // Step 3: PUT the raw binary to LinkedIn's pre-signed upload URL.
  // PUT to the upload URL is against a pre-signed S3-style URL, not the
  // LinkedIn API itself — not logged / not rate-limited (by design, to
  // avoid over-counting).
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${accessToken}` },
    body: new Uint8Array(imageBuffer),
    signal: AbortSignal.timeout(60000),
  })

  if (!putRes.ok) {
    throw new Error(`LinkedIn image binary upload failed (HTTP ${putRes.status})`)
  }

  return imageUrn
}

// ─── Video Upload ─────────────────────────────────────────────────

/**
 * Uploads an externally-hosted video into LinkedIn's own asset storage and
 * returns the resulting video URN (urn:li:video:xxx).
 *
 * LinkedIn's video upload is a 3-step process:
 *   1. initializeUpload (returns upload URL + video URN + upload token)
 *   2. PUT binary to the upload URL (possibly multiple parts)
 *   3. finalizeUpload — REQUIRED for multi-part video
 *
 * Reference: https://learn.microsoft.com/linkedin/marketing/integrations/community-management/shares/videos-and-live-video
 */
async function uploadVideoToLinkedIn(
  accessToken: string,
  authorUrn: string,
  authorMemberId: string,
  videoUrl: string,
  userId: string,
  accountId: string
): Promise<string> {
  // Step 1: fetch the source video FIRST — LinkedIn requires the exact
  // file size (fileSizeBytes) up front in the initializeUpload call, so
  // we must know the size before we can even start.
  let videoBuffer: Buffer
  try {
    const vidRes = await fetch(videoUrl, { signal: AbortSignal.timeout(60000) })
    if (!vidRes.ok) {
      throw new Error(`could not fetch video_url (HTTP ${vidRes.status})`)
    }
    const contentType = vidRes.headers.get('content-type') || ''
    if (!contentType.startsWith('video/')) {
      throw new Error(`video_url did not return a video (content-type: ${contentType || 'unknown'})`)
    }
    const arrayBuffer = await vidRes.arrayBuffer()
    videoBuffer = Buffer.from(arrayBuffer)
    if (videoBuffer.byteLength === 0) {
      throw new Error('video_url returned an empty file')
    }
    // LinkedIn's Video Ads spec: 75KB–500MB. We cap at 200MB to keep this
    // server-side fetch-then-upload flow reasonably fast.
    if (videoBuffer.byteLength > 200 * 1024 * 1024) {
      throw new Error('video is larger than 200MB — please use a smaller video')
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error fetching video'
    throw new Error(`Failed to fetch video_url — it must be a public, directly-loadable video URL (${msg})`)
  }

  // Step 2: initialize the upload slot, declaring the exact file size.
  const initRes = await linkedinRestFetch(
    { memberId: authorMemberId, userId, accountId, endpoint: '/rest/videos?action=initializeUpload', method: 'POST' },
    'https://api.linkedin.com/rest/videos?action=initializeUpload',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
        'LinkedIn-Version': LINKEDIN_VERSION,
      },
      body: JSON.stringify({
        initializeUploadRequest: {
          owner: authorUrn,
          fileSizeBytes: videoBuffer.byteLength,
          uploadCaptions: false,
          uploadThumbnail: false,
        },
      }),
    },
    15000
  )

  if (!initRes.ok) {
    const errText = await initRes.text().catch(() => '')
    throw new Error(
      `LinkedIn rejected the video upload request (${initRes.status}): ${errText.slice(0, 300) || 'no details'}`
    )
  }

  const initData = await initRes.json().catch(() => null)
  const uploadInstructions: Array<{ uploadUrl: string; firstByte: number; lastByte: number }> =
    initData?.value?.uploadInstructions || []
  const videoUrn: string | undefined = initData?.value?.video
  const uploadToken: string = initData?.value?.uploadToken || ''

  if (uploadInstructions.length === 0 || !videoUrn) {
    throw new Error('LinkedIn did not return upload instructions / a video URN — video upload cannot proceed')
  }

  // Step 3: LinkedIn splits large videos into multiple ~4MB parts, each
  // with its own byte range and its own pre-signed upload URL. Every part
  // must be PUT separately (pre-signed URLs — not the LinkedIn REST API,
  // so not rate-limit-counted), and every part's response ETag header must
  // be collected — finalizeUpload needs them all, in order.
  const partIds: string[] = []
  for (const part of uploadInstructions) {
    const chunk = videoBuffer.subarray(part.firstByte, part.lastByte + 1)
    const putRes = await fetch(part.uploadUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/octet-stream',
      },
      body: new Uint8Array(chunk),
      signal: AbortSignal.timeout(120000),
    })

    if (!putRes.ok) {
      const errText = await putRes.text().catch(() => '')
      throw new Error(
        `LinkedIn video part upload failed (HTTP ${putRes.status}, bytes ${part.firstByte}-${part.lastByte}): ${errText.slice(0, 200)}`
      )
    }

    const etag = putRes.headers.get('etag') || putRes.headers.get('ETag')
    if (!etag) {
      throw new Error(`LinkedIn did not return an ETag for video part (bytes ${part.firstByte}-${part.lastByte}) — cannot finalize upload`)
    }
    partIds.push(etag)
  }

  // Step 4: finalize — this is REQUIRED (not optional) for multi-part
  // video. Without a successful finalize call carrying the correct
  // uploadedPartIds, the video never leaves "processing" and can't be
  // attached to a post.
  const finalizeRes = await linkedinRestFetch(
    { memberId: authorMemberId, userId, accountId, endpoint: '/rest/videos?action=finalizeUpload', method: 'POST' },
    'https://api.linkedin.com/rest/videos?action=finalizeUpload',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
        'LinkedIn-Version': LINKEDIN_VERSION,
      },
      body: JSON.stringify({
        finalizeUploadRequest: {
          video: videoUrn,
          uploadToken,
          uploadedPartIds: partIds,
        },
      }),
    },
    15000
  )

  if (!finalizeRes.ok) {
    const errText = await finalizeRes.text().catch(() => '')
    throw new Error(`LinkedIn video finalize failed (HTTP ${finalizeRes.status}): ${errText.slice(0, 300)}`)
  }

  return videoUrn
}

// Note: auto-commenting via LinkedIn's API was removed — it requires the
// Community Management API product, which this app's LinkedIn Developer
// App does not have access to. Every call attempt returned 404 regardless
// of endpoint or URN format tried. See conversation history for details.

// ─── Types ─────────────────────────────────────────────────────────

export interface LinkedInPostResult {
  /** LinkedIn's ID for the created post (urn:li:share:XXXX) */
  postUrn: string
  /** The share URL if LinkedIn returns one */
  shareUrl?: string
  /** Raw response for debugging */
  raw: unknown
}

// ─── Main Publish Function ────────────────────────────────────────

/**
 * Publish a text + optional image/video post to LinkedIn on behalf of a member.
 *
 * Every LinkedIn REST call inside (media initialize/finalize + the posts
 * call itself) goes through linkedinRestFetch(), which rate-limits per
 * LinkedIn member id, enforces the plan's 24h budget, and honors 429
 * Retry-After — for EVERY caller (worker / cron / manual publish).
 *
 * @param encryptedAccessToken  The encrypted token stored in DB
 * @param authorMemberId        The LinkedIn member ID (linkedinMemberId column)
 * @param caption                Post text (3000 char max)
 * @param imageUrl               Optional image URL (legacy field name; for back-compat).
 * @param videoUrl               Optional video URL — if provided, takes precedence
 *                                over imageUrl as the attached media.
 * @param userId                 Required for API usage tracking. If omitted,
 *                                usage is not tracked (back-compat with old callers).
 * @param accountId              The connected LinkedinAccount's own DB id — REQUIRED
 *                                for per-account usage tracking. Every logged API call
 *                                for this publish is attributed to this account, never
 *                                just to the user, so multi-account usage never mixes.
 * @returns LinkedInPostResult with the post URN
 */
export async function publishToLinkedIn(
  encryptedAccessToken: string,
  authorMemberId: string,
  caption: string,
  imageUrl?: string | null,
  videoUrl?: string | null,
  userId?: string,
  accountId?: string
): Promise<LinkedInPostResult> {
  // Decrypt the stored token
  const accessToken = decryptToken(encryptedAccessToken)

  if (!authorMemberId || authorMemberId === 'unknown') {
    throw new Error('LinkedIn member ID missing — re-connect the account')
  }

  // LinkedIn author URN. The REST Posts API uses urn:li:person:<id>
  const authorUrn = `urn:li:person:${authorMemberId}`

  // Context shared by every rate-limited call in this publish
  const callCtx = {
    memberId: authorMemberId,
    userId: userId || '',
    accountId: accountId || '',
  }

  // Build the post body for the REST Posts API
  const postBody: Record<string, unknown> = {
    author: authorUrn,
    lifecycleState: 'PUBLISHED',
    visibility: 'PUBLIC',
    distribution: {
      feedDistribution: 'MAIN_FEED',
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    commentary: caption.slice(0, 3000),
  }

  // Determine which media to attach.
  // Priority: video_url > image_url (legacy) — we don't support both on the same post.
  const effectiveVideoUrl = videoUrl?.trim() || undefined
  const effectiveImageUrl = imageUrl?.trim() || undefined

  if (effectiveVideoUrl) {
    const vidUrn = await uploadVideoToLinkedIn(
      accessToken, authorUrn, authorMemberId, effectiveVideoUrl,
      callCtx.userId, callCtx.accountId
    )
    postBody.content = {
      media: {
        title: caption.slice(0, 120) || 'Video',
        id: vidUrn,
      },
    }
  } else if (effectiveImageUrl) {
    const imgUrn = await uploadImageToLinkedIn(
      accessToken, authorUrn, authorMemberId, effectiveImageUrl,
      callCtx.userId, callCtx.accountId
    )
    postBody.content = {
      media: {
        title: caption.slice(0, 120) || 'Post',
        id: imgUrn,
      },
    }
  }

  // Call the REST Posts API (rate-limited + budget-checked + 429-aware)
  const response = await linkedinRestFetch(
    { ...callCtx, endpoint: '/rest/posts', method: 'POST' },
    'https://api.linkedin.com/rest/posts',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
        'LinkedIn-Version': LINKEDIN_VERSION,
      },
      body: JSON.stringify(postBody),
    },
    30000
  )

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    let errorMessage = `LinkedIn API returned ${response.status}`
    try {
      const errJson = JSON.parse(errText)
      if (errJson?.message) errorMessage += `: ${errJson.message}`
    } catch {
      if (errText) errorMessage += `: ${errText.slice(0, 200)}`
    }

    // Friendly error mapping. Messages intentionally contain the exact
    // keyword the worker's isRetriableErrorType() matches on, so a dead
    // token is NEVER retried and a rate limit ALWAYS is (Bug #6).
    if (response.status === 401) {
      throw new Error(
        'LinkedIn token is invalid or expired (401 Unauthorized) — please refresh the access token for this account.'
      )
    }
    if (response.status === 403) {
      throw new Error(
        'LinkedIn rejected the post — insufficient scope (403 Forbidden). Ensure the account was connected with w_member_social scope.'
      )
    }
    if (response.status === 429) {
      // (Normally handled inside linkedinRestFetch; kept as a safety net.)
      throw new Error(
        'LinkedIn API 429 rate limit hit — too many requests. Backing off and retrying later.'
      )
    }
    throw new Error(errorMessage)
  }

  // LinkedIn returns the created post's URN in the `x-restli-id` response
  // header (not the body — a successful create returns 201 with an empty body).
  const postUrn = response.headers.get('x-restli-id') || ''
  let shareUrl: string | undefined

  // Try to parse the body if present
  let raw: unknown = null
  try {
    const text = await response.text()
    if (text) {
      raw = JSON.parse(text)
      const parsed = raw as Record<string, unknown>
      if (typeof parsed.shareUrl === 'string') {
        shareUrl = parsed.shareUrl
      } else if (typeof parsed.id === 'string' && !postUrn) {
        return { postUrn: parsed.id, shareUrl, raw }
      }
    }
  } catch {
    // Body is not JSON — that's fine, just rely on the header
  }

  if (!postUrn) {
    throw new Error('LinkedIn accepted the post but returned no post URN. Check the account on linkedin.com to verify.')
  }

  return { postUrn, shareUrl, raw }
}

/**
 * Inspect a media URL by fetching its content-type to determine if
 * it's a video or an image. Used during bulk upload to route the
 * `media_url` column to either image_url or video_url internally.
 */
export async function detectMediaType(url: string): Promise<'image' | 'video' | 'unknown'> {
  if (!url?.trim()) return 'unknown'
  const isVid = await isVideoContent(url)
  return isVid ? 'video' : 'image'
}
