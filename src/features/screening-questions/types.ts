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

/** Mirrors `@MaxLength(2000)` on the backend's create/update DTO. */
export const QUESTION_TEXT_MAX_LENGTH = 2000

/** Mirrors `@MaxLength(100, { each: true })` on the DTO's `tags`. */
export const TAG_MAX_LENGTH = 100

/**
 * One row of the org's screening-question bank (`GET /admin/questions`).
 *
 * The bank holds the CANONICAL wording only. Attaching a question to a job
 * freezes a `textSnapshot` on that job, and each interview asks an
 * AI-paraphrased variant — so editing a row here never rewrites a job's
 * attached copy or what a past interview actually asked.
 *
 * `_id` (not `id`): the backend serialises the mongoose document as-is.
 */
export interface ScreeningQuestion {
  _id: string
  organizationId: string
  text: string
  difficultyLevel: DifficultyLevel
  tags: string[]
  createdBy: string | null
  updatedBy: string | null
  createdAt: string
  updatedAt: string
}

/**
 * Body for create; also the (partial) body for update.
 *
 * `difficultyLevel` is REQUIRED even though the schema has a `medium`
 * default — the DTO doesn't, so an omitted value is a 400, not a default.
 * The form must not pre-select one on the user's behalf.
 */
export interface CreateScreeningQuestionPayload {
  text: string
  difficultyLevel: DifficultyLevel
  tags?: string[]
}

/** PATCH sends only what changed; `tags` REPLACES the whole array. */
export type UpdateScreeningQuestionPayload =
  Partial<CreateScreeningQuestionPayload>

export interface ListScreeningQuestionsParams {
  /** Case-insensitive substring match on the question text. */
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
