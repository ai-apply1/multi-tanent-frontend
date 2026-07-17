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
 * One attached question as the detail route presents it: the slot enriched
 * with the bank row it points at.
 *
 * There is no wording here and no drift to report — the job stores only a
 * reference, so the bank IS the wording and a bank edit is simply live.
 */
export interface JobQuestionView {
  questionId: string
  orderIndex: number
  /** This slot's share of the interview score. Totals 100 across the array. */
  weightPct: number
  /**
   * The wording that LABELS this slot — the bank's original (or the first
   * still-askable one). NOT what any given candidate is asked: that is
   * picked per candidate at prep time. `null` iff the bank row is gone.
   */
  text: string | null
  /**
   * How many wordings a candidate could draw. `1` means every candidate
   * hears identical words. `null` iff the bank row is gone.
   */
  variantCount: number | null
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

/**
 * One slot in `PUT /admin/jobs/:id/questions`.
 *
 * No wording: a job says WHICH question, in WHAT order, worth WHAT percent.
 * A job-specific rewording is a new bank question, not a field here.
 */
export interface JobQuestionItemPayload {
  questionId: string
  /** 0-based; must be UNIQUE across the payload (422 otherwise). */
  orderIndex: number
  /**
   * Percent of the interview score. Integer, and must total EXACTLY 100
   * across the payload (422 otherwise) — so a single row can never be saved
   * on its own; send the whole rebalanced list.
   */
  weightPct: number
}

// A bank row's type belongs to the bank: import `ScreeningQuestion` from
// `@/features/screening-questions/types`. Re-declaring a narrower copy here
// is how the two silently drift apart when the bank's shape changes.

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
