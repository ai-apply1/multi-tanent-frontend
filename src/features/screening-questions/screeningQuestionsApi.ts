import api from "@/lib/api"
import type {
  CreateScreeningQuestionPayload,
  DeleteScreeningQuestionResponse,
  ListScreeningQuestionsParams,
  ScreeningQuestion,
  ScreeningQuestionListResponse,
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
