import api from "@/lib/api"
import type {
  CreateScreeningQuestionPayload,
  DeleteScreeningQuestionResponse,
  ListScreeningQuestionsParams,
  ScreeningQuestion,
  ScreeningQuestionListResponse,
  SuggestVariantsPayload,
  UpdateScreeningQuestionPayload
} from "@/features/screening-questions/types"

/**
 * The org's question bank. `organizationId` is never sent — the backend
 * scopes every query to the caller's JWT.
 */
export async function listScreeningQuestions(
  params: ListScreeningQuestionsParams = {}
) {
  const { data } = await api.get<ScreeningQuestionListResponse>(
    "/admin/questions",
    {
      params: {
        page: params.page ?? 1,
        limit: params.limit ?? 25,
        ...(params.search ? { search: params.search } : {}),
        ...(params.difficultyLevel
          ? { difficultyLevel: params.difficultyLevel }
          : {}),
        ...(params.tags?.length ? { tags: params.tags } : {})
      },
      // `tags` must go out as REPEATED params (`tags=a&tags=b`). Axios's
      // default serializer emits `tags[]=a&tags[]=b`; both happen to survive
      // Express's `qs` parser today, but repeated params are what the DTO
      // documents, so don't rely on the bracket form being stripped.
      paramsSerializer: { indexes: null }
    }
  )
  return data
}

export async function getScreeningQuestion(id: string) {
  const { data } = await api.get<ScreeningQuestion>(`/admin/questions/${id}`)
  return data
}

export async function createScreeningQuestion(
  payload: CreateScreeningQuestionPayload
) {
  const { data } = await api.post<ScreeningQuestion>(
    "/admin/questions",
    payload
  )
  return data
}

/**
 * PATCH. `variants` must carry every existing `_id` in its current order —
 * the backend 422s on a delete or a reorder, because interviews reference
 * the wording they asked by `_id`. Append at the end; retire, never remove.
 */
export async function updateScreeningQuestion(
  id: string,
  payload: UpdateScreeningQuestionPayload
) {
  const { data } = await api.patch<ScreeningQuestion>(
    `/admin/questions/${id}`,
    payload
  )
  return data
}

/**
 * AI-draft alternative wordings for review. Persists NOTHING — the caller
 * saves the keepers through create/update, which is what gives a wording the
 * `_id` an interview can reference.
 *
 * Takes free text, not a question id, so it works while the user is still
 * typing a question that doesn't exist yet. May return FEWER than `count`
 * (drafts that drift are dropped); 502 when the model is unreachable.
 */
export async function suggestQuestionVariants(payload: SuggestVariantsPayload) {
  const { data } = await api.post<string[]>(
    "/admin/questions/suggest-variants",
    payload
  )
  return data
}

/**
 * (Re)generate the spoken audio for a question's wordings.
 *
 * Pass `variantIds` for one wording (the per-row retry) or omit it for every
 * un-retired wording that still needs audio ("Generate all"). Omitting is NOT
 * "regenerate everything" — wordings that already have a clip are skipped, so
 * pressing it twice costs nothing.
 *
 * The work is queued: the response is the question already stamped as
 * generating, which callers should write straight into the query cache to
 * re-arm their poll rather than waiting for a refetch.
 */
export async function generateQuestionAudio(id: string, variantIds?: string[]) {
  const { data } = await api.post<ScreeningQuestion>(
    `/admin/questions/${id}/audio/generate`,
    variantIds?.length ? { variantIds } : {}
  )
  return data
}

/**
 * A short-lived presigned URL for one wording's generated clip, for the bank
 * play button. Fetched lazily (only when the operator presses play) so the
 * list never mints URLs for clips nobody plays. 404 when the wording is
 * retired or has no clip yet — the caller reads that as "nothing to play".
 */
export async function getQuestionVariantAudioUrl(id: string, variantId: string) {
  const { data } = await api.get<{ url: string; expiresIn: number }>(
    `/admin/questions/${id}/audio/${variantId}`
  )
  return data
}

/**
 * Hard-delete a bank row. 409 while ANY job still embeds the question — the
 * error message names the jobs, so callers must surface it rather than
 * replacing it with a generic failure line.
 */
export async function deleteScreeningQuestion(id: string) {
  const { data } = await api.delete<DeleteScreeningQuestionResponse>(
    `/admin/questions/${id}`
  )
  return data
}
