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

/**
 * The job's hard gates, as persisted. Every field is pass/fail against the
 * parsed CV — clears them all → auto-invited, fails any → auto-rejected.
 * There is no scoring layer, so there is nothing else to configure here.
 */
export interface JobEligibility {
  city: string | null
  minYearsExperience: number | null
  requiredSkills: string[]
  customFields: JobCustomField[]
}

/** The value type of a custom field. Picked once and immutable after that. */
export type CustomFieldType = "text" | "number" | "boolean" | "select"

/**
 * Where a custom field's answer comes from. HR never picks this directly: the
 * backend classifies it from the label, shows the answer, and stores whatever
 * HR accepted or flipped to.
 */
export type CustomFieldSource = "applicant" | "resume"

/**
 * Every operator names the BREACH, not the pass, so a rule reads as the
 * sentence in the editor: "Reject if [is more than] [150000]".
 */
export type CustomFieldOperator =
  | "gt"
  | "lt"
  | "not_between"
  | "is_true"
  | "is_false"
  | "not_in"

/** What a breached gate does. Absent = collect only, decides nothing. */
export type CustomFieldFailAction = "reject" | "review"

export interface JobCustomFieldRule {
  operator: CustomFieldOperator
  /** Bound for gt/lt, LOW bound for not_between. */
  number: number | null
  /** HIGH bound for not_between only. */
  numberMax: number | null
  /** Accepted answers for not_in only. */
  options: string[]
}

export interface JobCustomField {
  /** Immutable storage key, derived server-side from the first label. */
  key: string
  label: string
  type: CustomFieldType
  options: string[]
  source: CustomFieldSource
  /** True once HR overrode the suggestion; the classifier then leaves it alone. */
  sourcePinned: boolean
  required: boolean
  helpText: string
  rule: JobCustomFieldRule | null
  onFail: CustomFieldFailAction | null
}

/** `POST /admin/jobs/custom-fields/classify` — advice, nothing is stored. */
export interface CustomFieldClassification {
  label: string
  source: CustomFieldSource
  /** One sentence for the recruiter, rendered under the field. */
  reason: string
  basis: "lexicon" | "ai" | "fallback"
}

/**
 * Fold weights for `scores.overall`. The three ALWAYS sum to exactly 100
 * (backend-validated, 422 otherwise).
 *
 * The axes are non-overlapping by design, so a job weights what the ROLE
 * needs. Any single axis may be 0 — 0/0/100 is a legitimate "can they hold a
 * conversation" screen — only an all-zero triple is rejected.
 */
export interface JobScoringWeights {
  /** Did they answer the question asked and land the expected point? */
  correctness: number
  /** Have they lived it — trade-offs, specifics, judgment? */
  depth: number
  /** Could a listener follow them — substance + spoken fluency? */
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
  /**
   * Soft screening length in minutes. `null` = inherit
   * `organization.settings.interviewDurationMinutes`.
   *
   * Only affects invites sent from now on: each interview freezes its own
   * value at invite time, so changing this never shortens a screen a
   * candidate has already been emailed about.
   */
  interviewDurationMinutes: number | null
  createdBy: string | null
  updatedBy: string | null
  createdAt: string
  updatedAt: string
}

/**
 * A row from `GET /admin/jobs` — questions folded down to a count, plus how
 * many candidates the job has.
 *
 * `applicantCount` is EVERY candidate on the job, whatever column they sit
 * in: the table asks how many people applied, and a rejected applicant still
 * applied. The backend counts them in one aggregation for the whole page.
 */
export interface JobListItem extends JobBase {
  questionCount: number
  applicantCount: number
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

/**
 * REPLACE semantics: sending `eligibility` swaps the whole block, so an
 * omitted field clears that gate rather than leaving it unchanged.
 */
export interface JobEligibilityPayload {
  city?: string
  minYearsExperience?: number
  requiredSkills?: string[]
  customFields?: JobCustomFieldPayload[]
}

/**
 * One custom field on the way to the server. `source` is deliberately absent:
 * the backend owns it. `sourceOverride` is sent ONLY when HR flipped the
 * suggestion, and sending it pins the field against future re-classification.
 *
 * `key` is echoed back for a field that already exists so a renamed label
 * keeps its stored answers; it is omitted for a newly added one.
 */
export interface JobCustomFieldPayload {
  key?: string
  label: string
  type: CustomFieldType
  options?: string[]
  sourceOverride?: CustomFieldSource
  required?: boolean
  helpText?: string
  rule?: JobCustomFieldRule
  onFail?: CustomFieldFailAction
}

/**
 * `maxAttempts` is `number | null`, not just optional, because the update path
 * reads `undefined` as "leave unchanged" (`if (dto.x !== undefined)`). Clearing
 * it therefore REQUIRES an explicit `null` — omitting it would silently keep
 * the old value.
 *
 * The three classification fields are required and NOT nullable: they feed the
 * `JOB CONTEXT` block of the CV pre-screen prompt, so an unset one silently
 * weakens every fit judgment made against the posting. The backend rejects a
 * missing one on create and a null one on update.
 */
export interface CreateJobPayload {
  title: string
  description?: string
  employmentType: EmploymentType
  workMode: WorkMode
  seniorityLevel: SeniorityLevel
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
  /** Soft screening length in minutes. `null` = inherit the org default. */
  interviewDurationMinutes?: number | null
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

/**
 * The experience band each seniority level implies, inclusive both ends, in
 * MONTHS; `maxMonths: null` means "and above". Months because the bottom of the
 * ladder is sub-annual (intern 0–3, junior from 6) — in years those are 0.25
 * and 0.5, which print badly and invite rounding drift.
 *
 * Mirrors `SENIORITY_EXPERIENCE` in the backend's `utils/seniority-experience.ts`
 * — the numbers there are what the CV pre-screen prompt actually rates against,
 * so if you change one, change both. This copy exists only to SHOW the admin
 * what picking a level commits them to; nothing here is sent to the API, and
 * the band is never stored on the job (it's derived from `seniorityLevel`).
 *
 * Not to be confused with `eligibility.minYearsExperience`, which is a hard
 * auto-reject gate the admin sets by hand.
 */
export const SENIORITY_EXPERIENCE: Record<
  SeniorityLevel,
  { minMonths: number; maxMonths: number | null }
> = {
  intern: { minMonths: 0, maxMonths: 3 },
  junior: { minMonths: 6, maxMonths: 18 },
  mid: { minMonths: 24, maxMonths: 36 },
  senior: { minMonths: 36, maxMonths: 60 },
  lead: { minMonths: 60, maxMonths: 96 },
  manager: { minMonths: 108, maxMonths: 144 },
  director: { minMonths: 144, maxMonths: null },
}

const MONTHS_PER_YEAR = 12

/** Below this the band reads in months; at or above it, in years. */
const YEARS_THRESHOLD_MONTHS = 24

/**
 * `"0–3 mos"` / `"6–18 mos"` / `"3–5 yrs"` / `"12+ yrs"` — the band as it reads
 * in the dropdown. The unit comes from the TOP of the band so both bounds share
 * one; "6–18 mos" beats "6 mos–1.5 yrs" in a narrow trigger.
 */
export const seniorityExperienceLabel = (level: SeniorityLevel): string => {
  const { minMonths, maxMonths } = SENIORITY_EXPERIENCE[level]
  const inMonths = maxMonths !== null && maxMonths < YEARS_THRESHOLD_MONTHS
  const unit = inMonths ? "mos" : "yrs"
  const value = (months: number) =>
    String(Number((inMonths ? months : months / MONTHS_PER_YEAR).toFixed(1)))
  return maxMonths === null
    ? `${value(minMonths)}+ ${unit}`
    : `${value(minMonths)}–${value(maxMonths)} ${unit}`
}

export const DIFFICULTY_LABELS: Record<DifficultyLevel, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
}

/**
 * The job-status state machine, mirrored from `JobService`. Offering a
 * transition that isn't listed here earns a 409, so menus must be built from
 * the CURRENT status's entry.
 *
 * No status is terminal. `archived` used to be, and an empty list here meant
 * the whole status menu vanished on an archived job — leaving a finished
 * posting with no route back. It now offers Unarchive (→ draft only).
 *
 * Keep this in step with the backend's `ALLOWED_STATUS_TRANSITIONS`: a
 * transition offered here but rejected there is a 409 the user can trigger
 * from the UI.
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
  // Archive is reversible, but only back to `draft` — mirroring the backend's
  // state machine, which refuses archived → open. A job returns for review
  // rather than straight back in front of candidates, so republishing is
  // always a deliberate second step (and re-runs the "needs questions" check).
  // This list was empty, which hid the status dropdown entirely and left a
  // fully-configured job with no way back.
  archived: [{ status: "draft", label: "Unarchive" }],
}
