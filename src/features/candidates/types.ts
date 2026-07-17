/**
 * Types for the candidate funnel — mirrors the backend `candidate` module
 * (`/admin/candidates/*`, `/admin/jobs/:jobId/candidates/*`, `/admin/statuses`).
 *
 * Documents come back straight off `toObject()`, so they are keyed by `_id`,
 * NOT `id` (unlike the overview cards, which are mapped).
 */

import type { Paginated } from "@/features/jobs/types"

/**
 * The 8 builtin status keys seeded per org. Every org may ALSO add custom
 * columns, whose keys are free-form — which is why `CandidateStatus.key` is a
 * plain `string` and every filter/menu is built from `GET /admin/statuses`
 * rather than from this union. It exists only for the handful of places that
 * legitimately hard-code a builtin (the invite gate needs `prescreened`).
 */
export type BuiltinCandidateStatusKey =
  | "applied"
  | "prescreened"
  | "invited"
  | "interviewing"
  | "scored"
  | "shortlisted"
  | "rejected"
  | "hired"

/** Only pre-screened candidates can be manually invited (409 INVALID_STATUS otherwise). */
export const INVITABLE_STATUS_KEY: BuiltinCandidateStatusKey = "prescreened"

export type InterviewStatus = "pending" | "in_progress" | "submitted" | "expired"

export type ScoringStatus =
  | "idle"
  | "queued"
  | "processing"
  | "done"
  | "failed"
  | "needs_review"

export type Recommendation = "strong_yes" | "yes" | "no"

/**
 * One kanban column from the org's catalog. `key` is immutable and is what
 * every funnel automation (and every write on this page) addresses a column
 * by — `_id` is never sent. `color` is a hex the org owns; the UI tints
 * badges/triggers from it rather than from a theme token, so a custom column
 * gets its colour with no code change.
 */
export interface CandidateStatus {
  _id: string
  organizationId: string
  key: string
  label: string
  /** Hex (e.g. "#0ea5e9"), or null when the org cleared it. */
  color: string | null
  stageOrder: number
  isTerminal: boolean
  builtin: boolean
  isProtected: boolean
  createdAt: string
  updatedAt: string
}

/** Weighted scoring fold of a submitted interview. */
export interface InterviewScores {
  overall: number
  technical: number
  communication: number
  recommendation: Recommendation | string
  summary: string
}

/**
 * The slim latest-interview pointer, populated ONLY on
 * `GET /admin/candidates/:id`. `publicSessionId` is the UUID every
 * `/admin/interviews/*` route (and the detail drawer) is keyed by — the Mongo
 * `_id` is useless there, which is why opening the drawer from a table row
 * costs a detail read first.
 */
export interface CandidateLatestInterview {
  _id: string
  publicSessionId: string
  status: InterviewStatus
  scoringStatus: ScoringStatus
  scores: InterviewScores | null
  attemptNumber: number
  startedAt: string | null
  submittedAt: string | null
  expiresAt: string | null
  createdAt: string
}

// ── the candidate document ────────────────────────────────────────────

/** Everything a candidate row carries except the parsed-CV blob. */
export interface CandidateBase {
  _id: string
  organizationId: string
  /** Raw ObjectId — the list does NOT populate the job (see `CandidateListItem`). */
  jobId: string
  fullName: string
  email: string
  /** Required at every write path — never empty on a row created since. */
  phone: string
  /** Required at every write path. Stored lowercased; re-case for display. */
  city: string
  /** S3 key, never a URL. `null` ⇒ no CV on file ⇒ the Open-CV action is hidden. */
  cvKey: string | null
  /** Computed from the parsed CV's work history; `null` until the parse lands. */
  yearsOfExperience: number | null
  /** The kanban column, always populated on both the list and the detail. */
  currentStatusId: CandidateStatus
  statusUpdatedAt: string
  /** Interview attempts STARTED (not invited) — the max-attempts guard's counter. */
  attemptCount: number
  /** Latched when the CV-parse/pre-screen pipeline hard-failed for this row. */
  prescreenError: string | null
  prescreenFailedAt: string | null
  createdAt: string
  updatedAt: string
}

/**
 * A row from `GET /admin/candidates`.
 *
 * Two projection facts the UI has to live with:
 *   - `profile` is EXCLUDED (the table never needs the parsed-CV blob) —
 *     only the detail route returns it;
 *   - `latestInterviewId` is a raw ObjectId, NOT populated. So a row can say
 *     WHETHER an interview exists, never its status/score, and cannot open
 *     the drawer without a detail read to resolve `publicSessionId`.
 */
export interface CandidateListItem extends CandidateBase {
  latestInterviewId: string | null
}

/**
 * `GET /admin/candidates/:id` — adds the parsed-CV cache and populates the
 * latest interview pointer.
 */
export interface CandidateDetail extends CandidateBase {
  latestInterviewId: CandidateLatestInterview | null
  /** The parsed-CV cache. `null` until the cv-parse worker finishes. */
  profile: CandidateProfile | null
}

/**
 * The parsed-CV cache. Deliberately loose: the backend persists the
 * extractor's response as a Mixed prop so its schema can evolve without a
 * migration, and the drawer renders the fields it recognises.
 */
export interface CandidateProfile {
  primaryRole?: string
  primaryRoleEvidence?: string
  seniority?: "junior" | "mid" | "senior" | "lead" | "unknown"
  yearsOfExperience?: number
  summary?: string
  technologies?: Array<{ name: string; category: string; isCoreProgramming: boolean }>
  workHistory?: Array<{
    title: string
    company: string
    start: string
    end: string
    isTechRole?: boolean
  }>
}

export type PaginatedCandidates = Paginated<CandidateListItem>

// ── the kanban board ──────────────────────────────────────────────────

/**
 * A card on the board. The aggregation pushes a slim projection — notably
 * WITHOUT `currentStatusId` (the column it sits in already says that) and
 * without the CV key.
 */
export interface KanbanCard {
  _id: string
  fullName: string
  email: string
  /** Required at every write path — never empty on a row created since. */
  phone: string
  /** Required at every write path. Stored lowercased; re-case for display. */
  city: string
  yearsOfExperience: number | null
  attemptCount: number
  latestInterviewId: string | null
  statusUpdatedAt: string
  createdAt: string
}

/**
 * One column of the board.
 *
 * ⚠️ `count` is the column's TRUE total; `candidates` is capped at the
 * backend's `KANBAN_TOP_N` (25), newest first. When `count >
 * candidates.length` the board is showing a WINDOW — say so in the UI rather
 * than letting it read as complete.
 */
export interface KanbanColumn {
  statusId: string
  key: string
  label: string
  color: string | null
  stageOrder: number
  isTerminal: boolean
  builtin: boolean
  count: number
  candidates: KanbanCard[]
}

/** `GET /admin/jobs/:jobId/candidates/kanban` — the board is always per-job. */
export interface KanbanBoard {
  jobId: string
  jobTitle: string
  columns: KanbanColumn[]
}

// ── bulk CV import ────────────────────────────────────────────────────

/**
 * The only three CV mime types the funnel accepts. Enforced by the presign
 * DTO (`@IsIn`), by what `S3Service` can build an extension for, and by what
 * the CV parser can extract text from — so filtering client-side is a
 * courtesy, not the gate.
 */
export const ALLOWED_CV_CONTENT_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const

export type AllowedCvContentType = (typeof ALLOWED_CV_CONTENT_TYPES)[number]

/** One dialog's worth of CVs — the presign DTO's `@ArrayMaxSize`. */
export const MAX_CV_UPLOAD_FILES = 50

export interface BulkPresignFile {
  fileName: string
  contentType: AllowedCvContentType
  email?: string
  fullName?: string
}

export interface PresignedCvUpload {
  fileName: string
  uploadUrl: string
  /** Echo this back verbatim at bulk-confirm — it's the only linkage. */
  key: string
  contentType: string
  expiresIn: number
}

export interface BulkConfirmRow {
  fullName: string
  email: string
  /** Required server-side (`@IsNotEmpty`) — an empty string is a 400. */
  phone: string
  /** Required server-side: the job's city gate compares against it. */
  city: string
  cvKey: string
}

/**
 * `POST /admin/jobs/:jobId/candidates/bulk-extract` — reads name/email/
 * phone/city off CVs already in S3, so the review table starts pre-filled
 * instead of asking a human to type 50 emails.
 *
 * Max keys PER CALL. The server caps this too (`BULK_EXTRACT_MAX_KEYS`);
 * keep the two in step. It's small on purpose — one LLM call per CV runs
 * while the admin watches, so a 50-CV ZIP goes out as ~10 short requests
 * that report progress, rather than one that flirts with the proxy timeout.
 */
export const BULK_EXTRACT_BATCH = 5

/** Why one CV couldn't be read. `null` = read fine. */
export type BulkExtractError = "invalid_cv_key" | "unreadable"

export const EXTRACT_ERROR_LABELS: Record<BulkExtractError, string> = {
  invalid_cv_key: "Upload didn't complete",
  unreadable: "Couldn't read this file",
}

/**
 * One extracted row. Every field can be `""` — that is NOT a failure, it
 * means the CV didn't state it (or the extractor wasn't confident enough
 * to guess, which is deliberate: a wrong email reaches a real stranger).
 * An empty `email` is what the dialog blocks the import on.
 */
export interface BulkExtractRow {
  cvKey: string
  fullName: string
  email: string
  phone: string
  city: string
  error: BulkExtractError | string | null
}

/** Why one row of a bulk-confirm didn't become a candidate. */
export type BulkConfirmSkipReason = "duplicate" | "invalid_cv_key" | "create_failed"

export const SKIP_REASON_LABELS: Record<BulkConfirmSkipReason, string> = {
  duplicate: "Already applied to this job",
  invalid_cv_key: "Upload didn't complete",
  create_failed: "Could not be saved",
}

/**
 * `POST /admin/jobs/:jobId/candidates/bulk-confirm`.
 *
 * ⚠️ PER-ROW, not atomic: a duplicate email or a bad key skips ONE row and
 * the rest of the batch still lands. Render both halves — reporting only
 * `created` would silently drop candidates the user thinks they imported.
 */
export interface BulkConfirmResult {
  created: Array<{ candidateId: string; fullName: string; email: string }>
  skipped: Array<{ fullName: string; email: string; reason: BulkConfirmSkipReason | string }>
}

// ── request params ────────────────────────────────────────────────────

/**
 * `GET /admin/candidates`. Only three filter dimensions exist — an unknown
 * `statusKey` (e.g. a column deleted since the filter was set) resolves to an
 * EMPTY PAGE, not an error, so a stale filter simply reads as "no results".
 */
export interface ListCandidatesParams {
  jobId?: string
  statusKey?: string
  /** Case-insensitive PREFIX match on fullName / email / phone. */
  search?: string
  page?: number
  limit?: number
}

export interface InviteResult {
  success: true
  candidateId: string
  attemptNumber: number
  expiresAt: string
}
