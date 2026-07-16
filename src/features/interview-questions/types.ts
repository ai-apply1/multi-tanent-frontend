/**
 * The candidate's editor/answer MODALITY and the behaviour driver: it
 * decides which editor the candidate gets AND which attachment rules
 * apply (see `attachmentRules.ts`). Closed enum — required on create.
 *
 * Values are lowercase to match the backend (`/admin/questions`); use
 * `QUESTION_ENVIRONMENT_LABELS` for display.
 */
export type QuestionEnvironment = "code-editor" | "canvas" | "notebook"

export type InterviewQuestionDifficulty = "easy" | "medium" | "hard"

/**
 * One uploaded file attached to a question, as persisted. `key` is the
 * S3 object key minted by the presign endpoint; `name` / `mimeType` /
 * `size` are echoed back so the table and form can describe the file
 * without an extra HEAD request.
 */
export interface InterviewQuestionFile {
  key: string
  name: string
  mimeType: string
  size: number
}

/**
 * A file as returned on the question detail view — the persisted shape
 * plus a short-lived presigned download `url` and the `purpose` note
 * (pulled from the question's `metaData`, keyed by file name).
 */
export interface InterviewQuestionFileView extends InterviewQuestionFile {
  url: string
  purpose: string
}

/**
 * Lean list row — the backend list endpoint returns a `fileCount`
 * rather than the full file array (no presigned URLs minted for lists).
 */
export interface InterviewQuestionListItem {
  id: string
  /** Behaviour driver — decides the candidate's editor + attachment rules. */
  environment: QuestionEnvironment
  /** Free-form topic label (mern, ai/ml, devops…). Display/filter only. */
  type: string
  name: string
  description: string
  difficultyLevel: InterviewQuestionDifficulty
  /** Per-question time budget, in minutes. */
  timeLimit: number
  /** How many AI follow-up questions this task asks after submission. */
  followupCount: number
  /** Scoring rubric: % of Technical Depth from the submitted code/design;
   *  the rest (100 − pct) comes from the spoken follow-up answers. */
  codeWeightPct: number
  fileCount: number
  createdAt: string | null
  updatedAt: string | null
}

/**
 * Full question detail (create / update / get-one responses). Carries
 * the file array with presigned URLs and the free-form `metaData` map
 * of file name → what that file is for (keyed by the `name` of an entry
 * in `files`, e.g. `{ "schema.sql": "Seed database" }`).
 */
export interface InterviewQuestion {
  id: string
  /** Behaviour driver — decides the candidate's editor + attachment rules. */
  environment: QuestionEnvironment
  /** Free-form topic label (mern, ai/ml, devops…). Display/filter only. */
  type: string
  name: string
  description: string
  difficultyLevel: InterviewQuestionDifficulty
  timeLimit: number
  /** How many AI follow-up questions this task asks after submission. */
  followupCount: number
  /** Scoring rubric: % of Technical Depth from the submitted code/design;
   *  the rest (100 − pct) comes from the spoken follow-up answers. */
  codeWeightPct: number
  files: InterviewQuestionFileView[]
  metaData: Record<string, string>
  createdAt: string | null
  updatedAt: string | null
}

export interface InterviewQuestionListResponse {
  data: InterviewQuestionListItem[]
  count: number
  page: number
  limit: number
  totalPage: number
  nextPage: number | null
}

/**
 * Result of `POST /admin/questions/:id/files/upload-init`. Matches the
 * shared `PresignedPutResult` shape used by the lesson / demo-video
 * upload flows.
 */
export interface InterviewQuestionPresignedPutResponse {
  uploadUrl: string
  key: string
  publicUrl: string
  contentType: string
  expiresIn: number
}

/**
 * Dropdown option lists — single source of truth for the form + table.
 * `QUESTION_ENVIRONMENTS` is the closed enum that drives behaviour; the
 * `type` topic label is free-form, so it has no fixed array here (its
 * autocomplete suggestions come from `/enums/types`).
 */
export const QUESTION_ENVIRONMENTS: QuestionEnvironment[] = [
  "code-editor",
  "canvas",
  "notebook",
]
export const QUESTION_DIFFICULTIES: InterviewQuestionDifficulty[] = [
  "easy",
  "medium",
  "hard"
]

/**
 * Allowed range + default for the per-question AI follow-up count. Mirrors the
 * backend bounds (technical/types/followup.types.ts) so the form validates the
 * same way the API does.
 */
export const FOLLOWUP_COUNT_MIN = 1
export const FOLLOWUP_COUNT_MAX = 10
export const FOLLOWUP_COUNT_DEFAULT = 5

/**
 * Allowed range + defaults for the per-question scoring rubric — the % of
 * Technical Depth taken from the submitted code/design (the rest comes from
 * the spoken follow-up answers). Mirrors the backend bounds + per-environment
 * defaults (technical/types/scoring.types.ts) so the form validates and
 * prefills the same way the API does. Canvas defaults to 50/50 (a hand-drawn
 * design diagram carries as much signal as the discussion); code-editor and
 * notebook default to 20/80 (largely AI-assisted, so the unrehearsed
 * follow-up is the trustworthy signal).
 */
export const CODE_WEIGHT_PCT_MIN = 0
export const CODE_WEIGHT_PCT_MAX = 100
export const CODE_WEIGHT_PCT_DEFAULTS: Record<QuestionEnvironment, number> = {
  "code-editor": 20,
  canvas: 50,
  notebook: 20
}

/** Quick-pick rubric presets for the form's selector (code% values). */
export const CODE_WEIGHT_PCT_PRESETS = [20, 50, 80] as const

/** Fixed display labels for the closed `environment` enum. */
export const QUESTION_ENVIRONMENT_LABELS: Record<QuestionEnvironment, string> = {
  "code-editor": "Code Editor",
  canvas: "Canvas",
  notebook: "Notebook"
}

/**
 * Best-effort display label for a free-form `type` topic string. A few
 * well-known values keep their canonical casing (acronyms); anything else
 * is title-cased so an unknown/free-form value renders cleanly instead of
 * crashing a Record lookup. Empty input renders as an em dash.
 */
const KNOWN_TYPE_LABELS: Record<string, string> = {
  "ai/ml": "AI/ML",
  "system-design": "System Design",
  mern: "MERN Stack",
  devops: "DevOps"
}

export const formatTypeLabel = (value?: string | null): string => {
  const raw = (value ?? "").trim()
  if (!raw) return "—"
  const known = KNOWN_TYPE_LABELS[raw.toLowerCase()]
  if (known) return known
  return raw
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

/**
 * A selectable dropdown option as served by the backend enum endpoints
 * (`/admin/questions/enums/*`). `value` is the persisted enum value;
 * `label` is the human-friendly text for the dropdown.
 */
export interface QuestionEnumOption {
  value: string
  label: string
}
