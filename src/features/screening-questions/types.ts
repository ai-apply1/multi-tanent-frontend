/**
 * Difficulty band of a screening question. Lowercase to match the backend
 * enum (`DifficultyLevel`); use `capitalize` at the render site.
 */
export type DifficultyLevel = "easy" | "medium" | "hard"

export const DIFFICULTY_LEVELS: DifficultyLevel[] = ["easy", "medium", "hard"]

/** Fixed display labels for the closed difficulty enum. */
export const DIFFICULTY_LABELS: Record<DifficultyLevel, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard"
}

/** Badge variant per band — the bank table and the job's attached list share it. */
export const difficultyVariant: Record<
  DifficultyLevel,
  "success" | "warning" | "destructive"
> = {
  easy: "success",
  medium: "warning",
  hard: "destructive"
}

/** Mirrors `@MaxLength(2000)` on the backend's variant text. */
export const QUESTION_TEXT_MAX_LENGTH = 2000

/** Mirrors `@MaxLength(100, { each: true })` on the DTO's `tags`. */
export const TAG_MAX_LENGTH = 100

/** Mirrors `QUESTION_VARIANTS_MAX` — the ceiling on saved wordings. */
export const QUESTION_VARIANTS_MAX = 10

/** Mirrors `VARIANT_SUGGEST_MIN` / `VARIANT_SUGGEST_MAX` on the suggest DTO. */
export const VARIANT_SUGGEST_MIN = 1
export const VARIANT_SUGGEST_MAX = 8

/**
 * One approved wording of a bank question — a SYNONYM, not a different
 * question. A candidate is served exactly one of these.
 *
 * `retired` withdraws a wording from the pool without deleting it. Deletion
 * is impossible by design: interviews reference the wording they asked by
 * `_id`, and that reference must resolve forever.
 */
export interface QuestionVariant {
  _id: string
  text: string
  retired: boolean
}

/**
 * One row of the org's screening-question bank (`GET /admin/questions`).
 *
 * The bank holds EVERY approved wording (`variants`, `[0]` = the original).
 * Jobs store no wording at all — they pick which question, in what order,
 * worth what percent. At interview-prep time each candidate is served ONE
 * variant, picked from a hash of their id, so two candidates for the same
 * job hear different words in the same order.
 *
 * Editing a wording here changes what FUTURE interviews ask; it can never
 * rewrite what a past interview actually asked (that text is frozen on the
 * interview itself).
 *
 * `_id` (not `id`): the backend serialises the mongoose document as-is.
 */
export interface ScreeningQuestion {
  _id: string
  organizationId: string
  variants: QuestionVariant[]
  difficultyLevel: DifficultyLevel
  tags: string[]
  createdBy: string | null
  updatedBy: string | null
  createdAt: string
  updatedAt: string
}

/**
 * The wording that represents a question in a list: the original, or the
 * first still-askable one if the original was retired. NOT what any given
 * candidate is asked — that is decided per candidate at prep time.
 */
export const questionLabel = (q: {
  variants: QuestionVariant[]
}): string =>
  q.variants.find((v) => !v.retired)?.text ?? q.variants[0]?.text ?? ""

/** How many wordings a candidate could actually draw. */
export const askableCount = (q: { variants: QuestionVariant[] }): number =>
  q.variants.filter((v) => !v.retired).length

/**
 * Body for create.
 *
 * `variants` is a plain string list here — the server mints each wording's
 * `_id`. `variants[0]` is the original; at least one is required.
 *
 * `difficultyLevel` is REQUIRED even though the schema has a `medium`
 * default — the DTO doesn't, so an omitted value is a 400, not a default.
 * The form must not pre-select one on the user's behalf.
 */
export interface CreateScreeningQuestionPayload {
  variants: string[]
  difficultyLevel: DifficultyLevel
  tags?: string[]
}

/**
 * One wording in a PATCH body. `_id` decides the operation: present edits
 * that variant in place, absent APPENDS a new one.
 */
export interface UpdateQuestionVariantPayload {
  _id?: string
  text?: string
  retired?: boolean
}

/**
 * PATCH sends only what changed; `tags` REPLACES the whole array.
 *
 * `variants` is NOT a replace: every existing `_id` must be sent, in its
 * current order, or the backend 422s. Append new wordings at the end; retire
 * (never remove) unwanted ones.
 */
export interface UpdateScreeningQuestionPayload {
  variants?: UpdateQuestionVariantPayload[]
  difficultyLevel?: DifficultyLevel
  tags?: string[]
}

/** Body for `POST /admin/questions/suggest-variants` — drafts only, saves nothing. */
export interface SuggestVariantsPayload {
  sourceText: string
  difficultyLevel?: DifficultyLevel
  /** FEWER may come back: drafts that drift in meaning or length are dropped. */
  count?: number
}

export interface ListScreeningQuestionsParams {
  /** Case-insensitive substring match on ANY of a question's wordings. */
  search?: string
  difficultyLevel?: DifficultyLevel
  /** NARROWING ($all): a question must carry ALL of these tags, not any. */
  tags?: string[]
  page?: number
  limit?: number
}

export interface ScreeningQuestionListResponse {
  data: ScreeningQuestion[]
  count: number
  page: number
  limit: number
  totalPage: number
  nextPage: number | null
}

export interface DeleteScreeningQuestionResponse {
  deleted: boolean
  questionId: string
}
