import api from "@/lib/api"
import type {
  InterviewAttempt,
  InterviewDetail,
  InterviewListItem,
  ListInterviewsParams,
  PaginatedResponse,
  ScoringStatus
} from "@/features/interviews/types"

export async function listInterviews(params: ListInterviewsParams = {}) {
  const { data } = await api.get<PaginatedResponse<InterviewListItem>>("/admin/interviews", {
    params: {
      page: params.page ?? 1,
      limit: params.limit ?? 20,
      ...(params.status ? { status: params.status } : {})
    }
  })
  return data
}

export async function getInterview(sessionId: string) {
  const { data } = await api.get<InterviewDetail>(`/admin/interviews/${sessionId}`)
  return data
}

/**
 * Every interview ATTEMPT for the applicant who owns this sessionId, oldest
 * to newest, for the detail drawer's version dropdown. A single-element list
 * for candidates who only attempted once (or legacy direct-entry sessions).
 */
export async function getInterviewAttempts(sessionId: string) {
  const { data } = await api.get<InterviewAttempt[]>(
    `/admin/interviews/${sessionId}/attempts`
  )
  return data
}

/**
 * Mint a short-lived presigned GET URL for this interview's CV.
 * Mirrors `getApplicantCvUrl` — same private-bucket constraint, same
 * popup-then-redirect callsite pattern in the interview detail
 * drawer.
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
 * backend.
 */
export async function retranscodeInterviewVideo(sessionId: string) {
  const { data } = await api.post<{
    success: boolean
    status: "pending" | "processing" | "ready" | "failed" | null
    queued: boolean
  }>(`/admin/interviews/${sessionId}/transcode`)
  return data
}

/**
 * Re-run the FULL AI scoring pipeline for a submitted interview:
 * re-judge the stored transcripts, redo the fluency pass + the
 * communication fold, and re-mirror the (possibly changed) verdict
 * onto the applicant. Useful after the backend's weights/prompts are
 * tuned, or to retry a failed scoring run.
 *
 * Safe to call while a run is already in flight — the backend reports
 * the current state (`queued: false`, `alreadyQueued: true`) instead of
 * stacking a second job. Only submitted interviews are scorable; any other
 * state is a 400 with an explanatory message.
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
 * Mint a fresh short-lived presigned download URL for one technical-round
 * answer file, addressed by its question + index in that question's
 * `answerFiles`. Called on click (not at drawer open) so the link can't expire
 * before the reviewer uses it. Mirrors `getInterviewCvUrl`.
 */
export async function getTechnicalSolutionUrl(
  sessionId: string,
  questionId: string,
  index: number
) {
  const { data } = await api.get<{
    url: string
    expiresIn: number
    name: string
  }>(
    `/admin/technical/${sessionId}/solution/${encodeURIComponent(questionId)}/${index}/url`
  )
  return data
}

/**
 * (Re)queue the candidate's technical-round SCREEN recording for HLS
 * transcoding — retry a failed transcode or backfill an older recording.
 */
export async function retranscodeTechnicalVideo(sessionId: string) {
  const { data } = await api.post<{
    success: boolean
    status: "pending" | "processing" | "ready" | "failed" | null
  }>(`/admin/technical/${sessionId}/transcode`)
  return data
}
