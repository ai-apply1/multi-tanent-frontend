/**
 * Types for the org's job postings — mirrors the backend `job` module
 * (`/admin/jobs/*`). Job documents come back straight off `toObject()`, so
 * they are keyed by `_id`, NOT `id`.
 */

export type JobStatus = "draft" | "open" | "closed" | "archived"

export type EmploymentType =
  | "full_time"
  | "part_time"
  | "contract"
  | "internship"
  | "temporary"

export type WorkMode = "onsite" | "remote" | "hybrid"

export type SeniorityLevel =
  | "intern"
  | "junior"
  | "mid"
  | "senior"
  | "lead"
  | "manager"
  | "director"

export type DifficultyLevel = "easy" | "medium" | "hard"

/** The universal list envelope (`page` min 1, `limit` max 100). */
export interface Paginated<T> {
  data: T[]
  count: number
  page: number
  limit: number
  totalPage: number
  nextPage: number | null
}

// ── the job document ──────────────────────────────────────────────────

/** One weighted CV metric the pre-screen engine scores 0–100. */
export interface VettingMetric {
  name: string
  /** The natural-language rule the engine evaluates against the parsed CV. */
  rule: string
  weight: number
}

/**
 * `eligibility.custom`, as persisted. The backend stores this as a Mixed
 * prop and normalizes omitted values, so thresholds read back as `null`
 * (= fall back to the engine's own defaults) rather than absent.
 */
export interface VettingConfig {
  metrics: VettingMetric[]
  acceptThreshold: number | null
  rejectThreshold: number | null
  requiredSkills: string[]
}

export interface JobEligibility {
  city: string | null
  minYearsExperience: number | null
  custom: VettingConfig | null
}

/** Fold weights for `scores.overall`. Always sum to exactly 100. */
export interface JobScoringWeights {
  technical: number
  communication: number
}

/** Everything a job carries except its questions. */
export interface JobBase {
  _id: string
  organizationId: string
  title: string
  description: string
  status: JobStatus
  employmentType: EmploymentType | null
  workMode: WorkMode | null
  seniorityLevel: SeniorityLevel | null
  eligibility: JobEligibility
  scoringWeights: JobScoringWeights
  rejectionThreshold: number
  /** `null` = inherit `organization.settings.maxInterviewAttempts`. */
  maxAttempts: number | null
  createdBy: string | null
  updatedBy: string | null
  createdAt: string
  updatedAt: string
}

/** A row from `GET /admin/jobs` — questions folded down to a count. */
export interface JobListItem extends JobBase {
  questionCount: number
}

/**
 * One attached question as the detail route presents it: the FROZEN slot
 * enriched with the bank row's current state, so drift is visible.
 */
export interface JobQuestionView {
  questionId: string
  orderIndex: number
  weight: number
  textOverride: string | null
  /** Frozen at attach time — what the interview paraphraser receives. */
  textSnapshot: string
  /** `textOverride ?? textSnapshot`. */
  effectiveText: string
  /** The bank row's CURRENT wording; `null` iff the bank row is gone. */
  currentBankText: string | null
  /**
   * The bank's wording changed since this job froze its snapshot. `null`
   * when the job uses an override (the bank wording is then irrelevant).
   */
  bankTextChanged: boolean | null
  difficultyLevel: DifficultyLevel | null
  tags: string[]
}

/** `GET /admin/jobs/:id` — the job with its questions enriched. */
export interface Job extends JobBase {
  questions: JobQuestionView[]
}

// ── request payloads ──────────────────────────────────────────────────

export interface VettingConfigPayload {
  metrics?: VettingMetric[]
  acceptThreshold?: number
  rejectThreshold?: number
  requiredSkills?: string[]
}

export interface JobEligibilityPayload {
  city?: string
  minYearsExperience?: number
  custom?: VettingConfigPayload
}

/**
 * The nullable fields below are `T | null`, not just optional, because the
 * update path reads `undefined` as "leave unchanged" (`if (dto.x !== undefined)`).
 * Clearing a value therefore REQUIRES an explicit `null` — omitting it would
 * silently keep the old one. `@IsOptional()` accepts null, and create folds
 * it with `?? null`, so null is correct on both paths.
 */
export interface CreateJobPayload {
  title: string
  description?: string
  employmentType?: EmploymentType | null
  workMode?: WorkMode | null
  seniorityLevel?: SeniorityLevel | null
  /**
   * REPLACE semantics on PATCH: sending this swaps the WHOLE eligibility
   * block and every omitted sub-field resets to null. Always build it from
   * a read of the current job, never from a partial diff — and always SEND
   * it, or clearing the last gate would be a silent no-op.
   */
  eligibility?: JobEligibilityPayload
  /** `technical + communication` must equal 100 (422 otherwise). */
  scoringWeights?: JobScoringWeights
  rejectionThreshold?: number
  /** `null` = inherit the org default. */
  maxAttempts?: number | null
}

/**
 * `PATCH /admin/jobs/:id`. Deliberately has NO `status` and NO `questions`:
 * both have their own endpoints, and the backend's DTO whitelist strips
 * them silently — sending them would look like a no-op bug.
 */
export type UpdateJobPayload = Partial<CreateJobPayload>

/** One slot in `PUT /admin/jobs/:id/questions`. */
export interface JobQuestionItemPayload {
  questionId: string
  /** 0-based; must be UNIQUE across the payload (422 otherwise). */
  orderIndex: number
  /** Required — there is no server-side default here. 1 = neutral. */
  weight: number
  textOverride?: string
}

// ── the question bank, as the attach picker needs it ───────────────────

/**
 * A row from `GET /admin/questions`. Declared here (rather than imported
 * from a `questions` slice) only because the attach picker needs it and
 * that slice doesn't exist yet — fold this into it when it lands.
 */
export interface BankQuestion {
  _id: string
  text: string
  difficultyLevel: DifficultyLevel
  tags: string[]
  createdAt: string
  updatedAt: string
}

// ── display helpers ───────────────────────────────────────────────────

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  draft: "Draft",
  open: "Open",
  closed: "Closed",
  archived: "Archived",
}

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  internship: "Internship",
  temporary: "Temporary",
}

export const WORK_MODE_LABELS: Record<WorkMode, string> = {
  onsite: "On-site",
  remote: "Remote",
  hybrid: "Hybrid",
}

export const SENIORITY_LABELS: Record<SeniorityLevel, string> = {
  intern: "Intern",
  junior: "Junior",
  mid: "Mid",
  senior: "Senior",
  lead: "Lead",
  manager: "Manager",
  director: "Director",
}

export const DIFFICULTY_LABELS: Record<DifficultyLevel, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
}

/**
 * The job-status state machine, mirrored from `JobService`. Offering a
 * transition that isn't listed here earns a 409, so menus must be built
 * from the CURRENT status's entry — `archived` is terminal (empty list).
 */
export const STATUS_TRANSITIONS: Record<
  JobStatus,
  readonly { status: JobStatus; label: string }[]
> = {
  draft: [
    { status: "open", label: "Publish" },
    { status: "archived", label: "Archive" },
  ],
  open: [
    { status: "closed", label: "Close" },
    { status: "archived", label: "Archive" },
  ],
  closed: [
    { status: "open", label: "Reopen" },
    { status: "archived", label: "Archive" },
  ],
  archived: [],
}
