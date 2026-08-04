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
  /**
   * IGNORED ENTIRELY when `workMode` is `remote`, and the value is kept rather
   * than cleared so switching back to onsite restores it. Read it through
   * `cityGateApplies(job)`, never bare, or a remote job looks like it filters
   * on location when the server has already decided it does not.
   */
  city: string | null
  /**
   * Does a wrong-city candidate who says they would MOVE still get looked at?
   * On (the default) turns that mismatch into an HR review instead of an
   * auto-reject. Never an auto-pass: willingness is an unverifiable claim.
   */
  considerRelocators: boolean
  minYearsExperience: number | null
  requiredSkills: string[]
  /** Requirements over the custom form answers. Empty = collect-only form. */
  customRules: JobCustomRule[]
  /** Accepted-list eligibility checks, CV-read or form-asked. */
  customChecks: JobCustomCheck[]
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

// ── custom application form + screening rules ────────────────────────

/**
 * Input types HR can add to a job's application form. Mirrors the backend's
 * `ApplicationFieldType`. A field is an INPUT and nothing else — screening
 * over the answers is a separate config (`JobCustomRule`), which is what
 * keeps this from being the entangled per-field builder the platform
 * removed once already.
 */
export type ApplicationFieldType =
  | "text"
  | "textarea"
  | "number"
  | "select"
  | "multiselect"
  | "checkbox"
  | "date"
  | "url"

/**
 * One custom field on the job's public application form.
 *
 * `id` is the field's PERMANENT identity (opaque, client-minted, never
 * derived from the label): stored answers and rule conditions key on it, so
 * relabeling a field never orphans either. Array order is display order —
 * there is no order field to drift from it.
 */
export interface JobFormField {
  id: string
  type: ApplicationFieldType
  label: string
  help: string
  required: boolean
  /**
   * Choice types only; the strings ARE the canonical answer values.
   *
   * Deliberately NO min/max on number fields: a bound with a consequence is
   * a screening rule (the Eligibility step's Custom requirements), and a
   * form-level bound would ride the public payload, telling every candidate
   * the threshold. A field collects; rules judge.
   */
  options: string[]
}

/**
 * Operators a screening-rule condition can apply, by the field's type. A
 * client copy of the backend's `RULE_OPERATORS_BY_FIELD_TYPE` — the server
 * re-validates, this one just keeps the editor from offering a combination
 * the save would 422. Types absent here (text, textarea, date, url) are
 * collect-only: shown to HR on the candidate, never auto-gated.
 */
export type CustomRuleOperator =
  | "eq"
  | "gte"
  | "lte"
  | "between"
  | "is_one_of"
  | "includes_any"
  | "includes_all"

export type CustomRuleOnFail = "reject" | "review"

export interface JobCustomRuleCondition {
  fieldId: string
  op: CustomRuleOperator
  /**
   * Shape depends on `op`: number (gte/lte, eq on number), string (eq on
   * select), boolean (eq on checkbox), [min, max] pair (between), or
   * string[] (is_one_of / includes_*).
   */
  value: unknown
}

/**
 * One screening requirement over the form answers: ALL conditions must hold,
 * else `onFail` decides reject-vs-review. A candidate whose answer is
 * MISSING always parks for HR review, whatever `onFail` says. Rules are
 * server-only: the apply page receives the fields, never these.
 */
export interface JobCustomRule {
  id: string
  label: string
  conditions: JobCustomRuleCondition[]
  onFail: CustomRuleOnFail
}

/**
 * Where a custom eligibility check's answer comes from. `cv` = the AI judges
 * the CV at parse time (the accepted list stays server-side); `form` = the
 * apply form gains a dropdown of the accepted values plus an automatic
 * "None of the above", the only answer that fails it.
 */
export type CustomCheckSource = "cv" | "form"

/**
 * One accepted-list eligibility check: any ONE accepted value clears it.
 * Lives in `eligibility.customChecks` server-side; a form-sourced check also
 * synthesizes a question onto the apply form under this same `id`, which is
 * why check ids and form-field ids share one namespace (backend-enforced).
 */
export interface JobCustomCheck {
  id: string
  label: string
  acceptedValues: string[]
  source: CustomCheckSource
  onFail: CustomRuleOnFail
}

/**
 * The fixed escape-hatch option the backend appends to every form-sourced
 * check's dropdown. Mirrored here only to refuse an accepted value that
 * collides with it (the backend 422s the same collision).
 */
export const CHECK_NONE_OPTION = "None of the above"

export const RULE_OPERATORS_BY_FIELD_TYPE: Partial<
  Record<ApplicationFieldType, readonly CustomRuleOperator[]>
> = {
  number: ["eq", "gte", "lte", "between"],
  select: ["eq", "is_one_of"],
  multiselect: ["includes_any", "includes_all"],
  checkbox: ["eq"],
}

export const FIELD_TYPE_LABELS: Record<ApplicationFieldType, string> = {
  text: "Short text",
  textarea: "Paragraph",
  number: "Number",
  select: "Dropdown",
  multiselect: "Multiple choice",
  checkbox: "Checkbox",
  date: "Date",
  url: "Link",
}

/** Editor copy: what each operator reads as, in a requirement sentence. */
export const OPERATOR_LABELS: Record<CustomRuleOperator, string> = {
  eq: "is exactly",
  gte: "is at least",
  lte: "is at most",
  between: "is between",
  is_one_of: "is one of",
  includes_any: "includes any of",
  includes_all: "includes all of",
}

export type JobLinkedInStatus = "none" | "published" | "removed" | "failed"

/**
 * The job's LinkedIn share state, mirrored from `job.linkedin` on the backend.
 * `none` = never posted; `published` carries a live `postUrl`; `failed` carries
 * `lastError`. Present on the detail route; absent from the list rows.
 */
export interface JobLinkedIn {
  status: JobLinkedInStatus
  postUrl: string | null
  postUrn: string | null
  postedAt: string | null
  removedAt: string | null
  lastError: string | null
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
  /** Custom application-form fields, in display order. */
  formFields: JobFormField[]
  /**
   * LinkedIn share state. Optional because the list route projects it away —
   * only `GET /admin/jobs/:id` (the detail) carries it.
   */
  linkedin?: JobLinkedIn
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
  considerRelocators?: boolean
  minYearsExperience?: number
  requiredSkills?: string[]
  /**
   * REPLACE semantics with the rest of the block. Every condition must
   * reference a field present in the job's (possibly simultaneously updated)
   * `formFields`, or the backend 422s the save.
   */
  customRules?: JobCustomRule[]
  /** REPLACE semantics with the rest of the block, like customRules. */
  customChecks?: JobCustomCheck[]
}

/**
 * One form field as the API accepts it — optional where the backend
 * defaults.
 */
export interface JobFormFieldPayload {
  id: string
  type: ApplicationFieldType
  label: string
  help?: string
  required?: boolean
  options?: string[]
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
  /**
   * REPLACE semantics on PATCH, like eligibility: sending it swaps the whole
   * list. Always send it, or deleting the last field would silently no-op.
   */
  formFields?: JobFormFieldPayload[]
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
