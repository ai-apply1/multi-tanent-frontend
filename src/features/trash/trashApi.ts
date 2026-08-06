import api from "@/lib/api"

// ---------------------------------------------------------------------
// "Recently deleted" (trash) — lists, restore, delete forever.
//
// Deleting a candidate / interview attempt / job anywhere in the app now
// moves it here instead of destroying it. Rows sit for
// `retentionDays` (server-configured, default 30), then the backend's
// purge cron erases them for good; "Delete forever" does the same
// immediately. Restore puts the row back exactly as it was.
// ---------------------------------------------------------------------

export interface TrashCandidateRow {
  id: string
  fullName: string
  email: string
  jobId: string
  jobTitle: string | null
  deletedAt: string
  purgeAt: string
  deletedByName: string | null
}

export interface TrashInterviewRow {
  sessionId: string
  candidateId: string
  candidateName: string
  email: string
  attemptNumber: number
  jobId: string
  jobTitle: string | null
  deletedAt: string
  purgeAt: string
  deletedByName: string | null
}

export interface TrashJobRow {
  id: string
  title: string
  status: string
  deletedAt: string
  purgeAt: string
  deletedByName: string | null
}

export interface TrashPage<T> {
  data: T[]
  total: number
  page: number
  limit: number
  /** Days a row sits in the trash before the automatic purge erases it. */
  retentionDays: number
}

interface TrashListParams {
  page?: number
  limit?: number
}

// ── Lists ─────────────────────────────────────────────────────────────

export async function listTrashCandidates(params: TrashListParams = {}) {
  const { data } = await api.get<TrashPage<TrashCandidateRow>>(
    "/admin/trash/candidates",
    { params: { page: params.page ?? 1, limit: params.limit ?? 20 } }
  )
  return data
}

export async function listTrashInterviews(params: TrashListParams = {}) {
  const { data } = await api.get<TrashPage<TrashInterviewRow>>(
    "/admin/trash/interviews",
    { params: { page: params.page ?? 1, limit: params.limit ?? 20 } }
  )
  return data
}

export async function listTrashJobs(params: TrashListParams = {}) {
  const { data } = await api.get<TrashPage<TrashJobRow>>("/admin/trash/jobs", {
    params: { page: params.page ?? 1, limit: params.limit ?? 20 },
  })
  return data
}

// ── Restore ───────────────────────────────────────────────────────────

export async function restoreTrashCandidate(id: string) {
  const { data } = await api.post<{ restored: true; candidateId: string }>(
    `/admin/trash/candidates/${id}/restore`
  )
  return data
}

export async function restoreTrashInterview(sessionId: string) {
  const { data } = await api.post<{ success: true; sessionId: string }>(
    `/admin/trash/interviews/${sessionId}/restore`
  )
  return data
}

export async function restoreTrashJob(id: string) {
  const { data } = await api.post<{
    restored: true
    jobId: string
    /** May differ from the original if another job claimed the URL meanwhile. */
    slug: string
  }>(`/admin/trash/jobs/${id}/restore`)
  return data
}

// ── Delete forever ────────────────────────────────────────────────────

export async function purgeTrashCandidate(id: string) {
  const { data } = await api.delete<{ deleted: true; candidateId: string }>(
    `/admin/trash/candidates/${id}`
  )
  return data
}

export async function purgeTrashInterview(sessionId: string) {
  const { data } = await api.delete<{ success: true; sessionId: string }>(
    `/admin/trash/interviews/${sessionId}`
  )
  return data
}

export async function purgeTrashJob(id: string) {
  const { data } = await api.delete<{ deleted: true; jobId: string }>(
    `/admin/trash/jobs/${id}`
  )
  return data
}
