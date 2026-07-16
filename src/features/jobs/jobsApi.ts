import api from "@/lib/api"
import type {
  BankQuestion,
  CreateJobPayload,
  DifficultyLevel,
  Job,
  JobListItem,
  JobQuestionItemPayload,
  JobStatus,
  Paginated,
  UpdateJobPayload,
} from "@/features/jobs/types"

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
  } = {}
) {
  const { data } = await api.get<Paginated<JobListItem>>("/admin/jobs", {
    params: {
      page: params.page ?? 1,
      limit: params.limit ?? 25,
      ...(params.search ? { search: params.search } : {}),
      ...(params.status ? { status: params.status } : {}),
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
 * Every save re-freezes each slot's `textSnapshot` from the CURRENT bank
 * text (unless the slot has a `textOverride`) — so any edit here, even a
 * pure reorder, silently re-syncs drifted wording. The UI says so.
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

/**
 * The question bank, for the attach picker. Lives here rather than in a
 * `questions` slice because that slice doesn't exist yet — move this when
 * it lands so there's one reader of `/admin/questions`.
 */
export async function listBankQuestions(
  params: {
    page?: number
    limit?: number
    search?: string
    difficultyLevel?: DifficultyLevel
  } = {}
) {
  const { data } = await api.get<Paginated<BankQuestion>>("/admin/questions", {
    params: {
      page: params.page ?? 1,
      limit: params.limit ?? 25,
      ...(params.search ? { search: params.search } : {}),
      ...(params.difficultyLevel
        ? { difficultyLevel: params.difficultyLevel }
        : {}),
    },
  })
  return data
}
