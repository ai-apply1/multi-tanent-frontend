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

  /**
   * S3 key of this wording's pre-generated spoken clip, or `""`. Not a URL —
   * candidates reach the audio through the interview's own streaming
   * endpoint, never a direct link, so the key is only useful as a presence
   * signal here.
   */
  audioKey: string
  /** True once the clip is confirmed in S3. Drives the retry button. */
  isAudioGenerated: boolean
  /** Why the last generation attempt failed, if it did. */
  audioError: string
  /** When generation was last queued; null once it settles either way. */
  audioQueuedAt: string | null
}

/** What the bank UI shows for one wording's audio. */
export type VariantAudioState = "ready" | "generating" | "failed" | "none"

/**
 * Resolve a wording's audio state for display.
 *
 * The order matters. `isAudioGenerated` wins outright — a wording with a clip
 * is ready even if a previous attempt left an error behind. `audioQueuedAt`
 * is checked next because it is the ONLY thing distinguishing "generating
 * right now" from "never started" after a page reload; without it a fresh
 * question and an in-flight one would look identical and the UI would offer
 * a retry for work already underway.
 */
export const variantAudioState = (v: {
  isAudioGenerated?: boolean
  audioError?: string
  audioQueuedAt?: string | null
}): VariantAudioState => {
  if (v.isAudioGenerated) return "ready"
  if (v.audioQueuedAt) return "generating"
  if (v.audioError) return "failed"
  return "none"
}

/**
 * Wordings whose audio is still in flight. Non-empty means keep polling.
 *
 * Retired wordings are excluded: the worker skips them, so their state never
 * changes and including them would poll forever.
 */
export const generatingVariants = (q: {
  variants: QuestionVariant[]
}): QuestionVariant[] =>
  q.variants.filter(
    (v) => !v.retired && variantAudioState(v) === "generating"
  )

/**
 * True when NOT ONE un-retired wording has audio — the case "Generate all"
 * exists for. A question with some clips shows per-wording retries instead,
 * so the bulk action never re-queues work that already succeeded.
 */
export const needsAllAudio = (q: { variants: QuestionVariant[] }): boolean => {
  const askable = q.variants.filter((v) => !v.retired)
  return askable.length > 0 && askable.every((v) => !v.isAudioGenerated)
}

/**
 * True when EVERY askable wording has a ready clip — the job-attach gate.
 *
 * A candidate is served one wording at RANDOM, so a question is only safe to
 * attach when none of them can be silent. This is stricter than "the base
 * question has audio": a missing synonym would still strand whichever
 * candidate happens to draw it. A wording still generating is not ready
 * either, so it blocks too. Retired wordings are ignored — they are never
 * served.
 */
export const allAudioReady = (q: { variants: QuestionVariant[] }): boolean => {
  const askable = q.variants.filter((v) => !v.retired)
  return askable.length > 0 && askable.every((v) => v.isAudioGenerated)
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
  /** Primary category id (from `/admin/question-categories`). Null on legacy rows. */
  categoryId: string | null
  tags: string[]
  createdBy: string | null
  updatedBy: string | null
  createdAt: string
  updatedAt: string
  /**
   * How many jobs currently embed this question — the exact set the
   * delete-guard checks (any status, archived included), so 0 means Delete
   * would succeed. LIST rows only; detail/update/audio responses omit it,
   * hence optional. May be stale until the next refetch — the backend's 409
   * remains the authority.
   */
  usedByJobCount?: number
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
  /** Primary category id — sourced from `/admin/question-categories`. */
  categoryId?: string
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
  /** Send `null` to clear the category. Absent leaves it unchanged. */
  categoryId?: string | null
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
  /** Filter to one category id (from `/admin/question-categories`). */
  categoryId?: string
  /**
   * NARROWING ($all): a question must carry ALL of these tags, not any.
   * Matched case-insensitively by the backend.
   */
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
