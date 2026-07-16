import api from "@/lib/api"
import type {
  AdminInterviewAttempt,
  AdminInterviewDetail,
  AdminInterviewListItem,
  ListInterviewsParams,
  PaginatedResponse,
  ScoringStatus,
  WebcamHlsStatus
} from "@/features/interviews/types"

/**
 * `:sessionId` on every route below is the interview's `publicSessionId`
 * (a UUID) — never the Mongo `_id`.
 */

export async function listInterviews(params: ListInterviewsParams = {}) {
  const { data } = await api.get<PaginatedResponse<AdminInterviewListItem>>(
    "/admin/interviews",
    {
      params: {
        page: params.page ?? 1,
        limit: params.limit ?? 25,
        ...(params.jobId ? { jobId: params.jobId } : {}),
        ...(params.status ? { status: params.status } : {}),
        ...(params.scoringStatus ? { scoringStatus: params.scoringStatus } : {}),
        ...(params.search ? { search: params.search } : {}),
        ...(params.latestOnly === false ? { latestOnly: false } : {})
      }
    }
  )
  return data
}

export async function getInterview(sessionId: string) {
  const { data } = await api.get<AdminInterviewDetail>(
    `/admin/interviews/${sessionId}`
  )
  return data
}

/**
 * Every interview ATTEMPT by the candidate who owns this sessionId, oldest to
 * newest, for the detail drawer's version dropdown. A single-element list for
 * candidates who only attempted once. The backend resolves every attempt from
 * any one of the candidate's sessionIds.
 */
export async function getInterviewAttempts(sessionId: string) {
  const { data } = await api.get<AdminInterviewAttempt[]>(
    `/admin/interviews/${sessionId}/attempts`
  )
  return data
}

/**
 * Mint a short-lived presigned GET URL for this interview's CV. The bucket is
 * private, so this is the only way to open it; called on click (not at drawer
 * open) so the link can't expire before the reviewer uses it. 404s with an
 * explanatory message when the candidate has no CV on file.
 */
export async function getInterviewCvUrl(sessionId: string) {
  const { data } = await api.get<{ url: string; expiresIn: number }>(
    `/admin/interviews/${sessionId}/cv`
  )
  return data
}

export async function deleteInterview(sessionId: string) {
  const { data } = await api.delete<{ success: boolean; sessionId: string }>(
    `/admin/interviews/${sessionId}`
  )
  return data
}

/**
 * Download every candidate answer's audio for a session as a single zip.
 *
 * The endpoint is `@SkipCrypto()` on the backend (it streams a binary zip,
 * not a JSON envelope), so we bypass the client crypto layer with the
 * `x-skip-crypto` marker header AND ask axios for a `blob` response. Both
 * are required: the request interceptor only preserves a non-JSON
 * `responseType` when the crypto path is skipped. The perimeter Basic Auth
 * header and the admin session cookie still ride along via the shared
 * axios instance, so the download stays authenticated.
 *
 * Resolves to the raw zip Blob; the caller builds a filename and triggers
 * the browser download. A 404 means the interview has no answer audio
 * (every question skipped, or a legacy audio-less record).
 */
export async function downloadInterviewAnswersAudio(sessionId: string) {
  // Extension-less path (not `.zip`) so a browser download manager (IDM)
  // doesn't grab it and re-request without the perimeter Basic Auth. We
  // fetch the bytes here and name the saved `.zip` client-side.
  const { data } = await api.get<Blob>(
    `/admin/interviews/${sessionId}/answers-audio`,
    {
      responseType: "blob",
      headers: { "x-skip-crypto": "1" }
    }
  )
  return data
}

/**
 * Download the candidate's webcam recording as a single video file.
 *
 * Same `@SkipCrypto()` + blob mechanics as the answer-audio download. The
 * backend returns the intact raw recording when it still exists, or an MP4
 * rebuilt from the HLS segments for already-transcoded interviews (the
 * original single file is deleted post-transcode). The caller derives the
 * extension from the returned Blob's `type` (video/mp4 vs video/webm). A
 * 404 means there's no downloadable recording yet (still processing, or
 * the transcode failed).
 */
export async function downloadInterviewVideo(sessionId: string) {
  const { data } = await api.get<Blob>(
    `/admin/interviews/${sessionId}/video/download`,
    {
      responseType: "blob",
      headers: { "x-skip-crypto": "1" }
    }
  )
  return data
}

/**
 * (Re)queue the webcam recording for HLS transcoding — used to retry a
 * failed transcode or backfill an older recording. Idempotent on the
 * backend. Note `failed` is never auto-retried (the detail GET only lazily
 * backfills a recording that was NEVER transcoded), so this is the only way
 * back from a failure.
 */
export async function retranscodeInterviewVideo(sessionId: string) {
  const { data } = await api.post<{
    success: boolean
    status: WebcamHlsStatus | null
    queued: boolean
  }>(`/admin/interviews/${sessionId}/transcode`)
  return data
}

/**
 * Re-run the FULL AI scoring pipeline for a submitted interview: re-judge the
 * stored transcripts, redo the fluency pass + the communication fold, and
 * re-mirror the (possibly changed) verdict onto the candidate. Useful after
 * the job's weights/threshold are tuned, or to retry a failed run.
 *
 * Safe to call while a run is already in flight — the backend reports the
 * current state (`queued: false`, `alreadyQueued: true`) instead of stacking a
 * second job. Only submitted interviews are scorable; any other state is a 409
 * with an explanatory message.
 */
export async function rescoreInterview(sessionId: string) {
  const { data } = await api.post<{
    success: boolean
    /** The lifecycle state the session is in AFTER the call (either way). */
    scoringStatus: ScoringStatus
    /** True when THIS call enqueued a fresh job. */
    queued: boolean
    /**
     * True when a run was ALREADY in flight (`queued` / `processing`) — this
     * call was a no-op and did NOT stack a second job. The UI keeps the button
     * disabled and polls `scoringStatus` until it settles.
     */
    alreadyQueued: boolean
  }>(`/admin/interviews/${sessionId}/rescore`)
  return data
}

/**
 * Lightweight poll of a submitted interview's background-scoring lifecycle:
 * just `scoringStatus` (+ any `scoringError`), NO transcripts / scores in the
 * payload, so it's cheap to hit on an interval. The detail drawer polls this
 * after triggering a rescore to watch `queued → processing → done/failed`,
 * then refetches the full interview detail exactly once — when it settles —
 * so the (possibly changed) scores land in place without re-pulling the heavy
 * payload on every tick.
 */
export async function getInterviewScoringStatus(sessionId: string) {
  const { data } = await api.get<{
    sessionId: string
    scoringStatus: ScoringStatus
    /** Short failure message when `failed` / `needs_review`; empty otherwise. */
    scoringError: string
  }>(`/admin/interviews/${sessionId}/scoring-status`)
  return data
}

/**
 * Authorise attempt N+1 for the candidate: mints a fresh invite link and
 * emails it. 409 `MAX_ATTEMPTS` when they've used
 * `job.maxAttempts ?? org.settings.maxInterviewAttempts ?? 1` already.
 */
export async function reinviteInterview(sessionId: string) {
  const { data } = await api.post<{
    success: true
    sessionId: string
    candidateId: string
    /** The freshly authorised attempt (1-based). */
    attemptNumber: number
    expiresAt: string
  }>(`/admin/interviews/${sessionId}/reinvite`)
  return data
}
