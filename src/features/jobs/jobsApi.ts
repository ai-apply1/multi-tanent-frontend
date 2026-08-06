import api from "@/lib/api"
import type {
  CreateJobPayload,
  Job,
  JobLinkedInStatus,
  JobListItem,
  JobQuestionItemPayload,
  JobStatus,
  Paginated,
  UpdateJobPayload,
} from "@/features/jobs/types"

/**
 * The columns `GET /admin/jobs` can order by, mirroring the backend's
 * `JOB_SORT_FIELDS`. "Classification" is absent there and here: the cell is up
 * to three independent chips, so there is no single value to compare.
 */
export type JobSortField =
  | "title"
  | "status"
  | "applicants"
  | "questions"
  | "threshold"
  | "created"

/**
 * The org's job board. `organizationId` is never sent — the backend scopes
 * every route to the JWT's org.
 */
export async function listJobs(
  params: {
    page?: number
    limit?: number
    search?: string
    status?: JobStatus
    /** Omit for the API's own order (newest first). */
    sortBy?: JobSortField
    sortDir?: "asc" | "desc"
  } = {}
) {
  const { data } = await api.get<Paginated<JobListItem>>("/admin/jobs", {
    params: {
      page: params.page ?? 1,
      limit: params.limit ?? 25,
      ...(params.search ? { search: params.search } : {}),
      ...(params.status ? { status: params.status } : {}),
      // Both keys or neither — `sortDir` alone orders nothing.
      ...(params.sortBy
        ? { sortBy: params.sortBy, sortDir: params.sortDir ?? "asc" }
        : {}),
    },
  })
  return data
}

/**
 * The org's jobs as a flat list for the "All jobs" dropdowns (Candidates'
 * filter + upload target, Overview's job overlay). Both pages fetch the same
 * request, so they must also share this key — two keys over one endpoint means
 * two cache entries drifting apart, and two shapes under one key means
 * whichever page mounts second reads the other's data as the wrong type.
 *
 * `limit: 100` is the backend's max page size: an org with more jobs than that
 * gets a truncated dropdown, which is why callers label an unresolvable jobId
 * rather than pretending the job doesn't exist.
 */
export const JOB_OPTIONS_QUERY_KEY = ["jobs", { limit: 100 }] as const

export async function listJobOptions(): Promise<JobListItem[]> {
  const page = await listJobs({ limit: 100 })
  return page.data
}

/** Job detail — questions enriched with the bank's current state + drift flags. */
export async function getJob(id: string) {
  const { data } = await api.get<Job>(`/admin/jobs/${id}`)
  return data
}

/**
 * Create a job. The result is ALWAYS `status: "draft"` with no questions,
 * whatever the payload says — publish via `setJobStatus`, attach questions
 * via `setJobQuestions`.
 */
export async function createJob(payload: CreateJobPayload) {
  const { data } = await api.post<Job>("/admin/jobs", payload)
  return data
}

/**
 * Patch the job's own fields. `status` / `questions` are absent from
 * `UpdateJobPayload` by design: they have dedicated endpoints and this
 * DTO's whitelist drops them silently.
 */
export async function updateJob(id: string, payload: UpdateJobPayload) {
  const { data } = await api.patch<Job>(`/admin/jobs/${id}`, payload)
  return data
}

/** Guarded lifecycle transition — 409 on anything off the state machine. */
export async function setJobStatus(id: string, status: JobStatus) {
  const { data } = await api.patch<Job>(`/admin/jobs/${id}/status`, { status })
  return data
}

/**
 * REPLACE the job's whole question list: attach, detach, reorder and
 * reweight are all "send the desired end state" (`items: []` detaches
 * everything).
 *
 * No wording is sent or stored — only which questions, in what order, worth
 * what percent. `weightPct` must total exactly 100 across `items`, so the
 * caller cannot save one row in isolation: rebalance, then send the lot.
 */
export async function setJobQuestions(
  id: string,
  items: JobQuestionItemPayload[]
) {
  const { data } = await api.put<Job>(`/admin/jobs/${id}/questions`, { items })
  return data
}

/** Hard delete — 409 unless the job is draft|archived AND has no candidates. */
export async function deleteJob(id: string) {
  const { data } = await api.delete<{ deleted: boolean; jobId: string }>(
    `/admin/jobs/${id}`
  )
  return data
}

// ── Share link + email invites ──────────────────────────────────────────

export interface JobShareLink {
  url: string
  jobId: string
  jobTitle: string
  status: string
}

export interface JobInvite {
  id: string
  email: string
  used: boolean
  invitedAt: string | null
  lastSentAt: string | null
  sendCount: number
  url: string
}

export async function getJobShareLink(jobId: string) {
  const { data } = await api.get<JobShareLink>(`/admin/jobs/${jobId}/share-link`)
  return data
}

export async function listJobInvites(jobId: string) {
  const { data } = await api.get<{ invites: JobInvite[] }>(
    `/admin/jobs/${jobId}/invites`
  )
  return data.invites
}

export async function sendJobInvites(jobId: string, emails: string[]) {
  const { data } = await api.post<{
    message: string
    invites: JobInvite[]
  }>(`/admin/jobs/${jobId}/invites`, { emails })
  return data
}

export async function deleteJobInvite(jobId: string, inviteId: string) {
  await api.delete(`/admin/jobs/${jobId}/invites/${inviteId}`)
}

// ── Post to LinkedIn ────────────────────────────────────────────────────
//
// Per-user OAuth: publishing a job posts a share on the connecting user's
// personal feed linking to the public apply page. The CONNECTION itself
// (connect/status/disconnect) lives in `@/features/integrations/integrationsApi`
// — these two are the job-scoped post/remove actions only.

/** `POST /admin/jobs/:id/linkedin` result. */
export interface LinkedInPublishResult {
  status: JobLinkedInStatus
  postUrl: string
  postUrn: string
  postedAt: string
}

/** Publish the job as a share on the connected user's LinkedIn feed. */
export async function postJobToLinkedIn(jobId: string) {
  const { data } = await api.post<LinkedInPublishResult>(
    `/admin/jobs/${jobId}/linkedin`
  )
  return data
}

/** Remove the job's LinkedIn post. */
export async function removeJobFromLinkedIn(jobId: string) {
  const { data } = await api.delete<{
    status: JobLinkedInStatus
    postUrl: string | null
  }>(`/admin/jobs/${jobId}/linkedin`)
  return data
}

// The question bank is NOT read from here. `/admin/questions` has exactly one
// reader — `listScreeningQuestions` in the screening-questions slice — and the
// attach picker uses it. A second fetcher here drifts from it silently.
