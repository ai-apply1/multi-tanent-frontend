import axios from "axios"
import api from "@/lib/api"
import type {
  InterviewQuestion,
  InterviewQuestionListResponse,
  InterviewQuestionPresignedPutResponse,
  QuestionEnvironment,
  InterviewQuestionDifficulty,
  QuestionEnumOption
} from "@/features/interview-questions/types"

/**
 * Shape sent on create / update. Files are NOT sent here — they are
 * attached to a saved question via the presigned upload flow below.
 * `metaData` maps each file's name to a short note on what it's for
 * (sending it on update REPLACES the whole map).
 *
 * `environment` (closed enum) is the behaviour driver, required on create.
 * `type` is a free-form topic label the form always sends as a string.
 */
export interface InterviewQuestionPayload {
  environment: QuestionEnvironment
  type: string
  name: string
  description?: string
  difficultyLevel: InterviewQuestionDifficulty
  timeLimit: number
  /** How many AI follow-up questions to ask after this task (1-10). */
  followupCount: number
  /** Scoring rubric: % of Technical Depth from the submitted code/design
   *  (0-100); the rest comes from the spoken follow-up answers. */
  codeWeightPct: number
  metaData?: Record<string, string>
}

// ---------------------------------------------------------------------
// Dropdown enums (served by the backend so new values appear automatically)
// ---------------------------------------------------------------------

/**
 * Autocomplete suggestions for the free-form `type` topic label — the
 * DISTINCT topic labels already used in the catalog (NOT a fixed enum).
 */
export async function listQuestionTypeOptions() {
  const { data } = await api.get<QuestionEnumOption[]>(
    "/admin/questions/enums/types"
  )
  return data
}

/**
 * The fixed closed `environment` enum (code-editor / canvas / notebook) —
 * the behaviour driver for the create/edit form and the list filter.
 */
export async function listQuestionEnvironmentOptions() {
  const { data } = await api.get<QuestionEnumOption[]>(
    "/admin/questions/enums/environments"
  )
  return data
}

export async function listQuestionDifficultyOptions() {
  const { data } = await api.get<QuestionEnumOption[]>(
    "/admin/questions/enums/difficulty-levels"
  )
  return data
}

export async function listInterviewQuestions(
  params: {
    page?: number
    limit?: number
    search?: string
    environment?: QuestionEnvironment
    type?: string
    difficultyLevel?: InterviewQuestionDifficulty
  } = {}
) {
  const { data } = await api.get<InterviewQuestionListResponse>(
    "/admin/questions",
    {
      params: {
        page: params.page ?? 1,
        limit: params.limit ?? 25,
        ...(params.search ? { search: params.search } : {}),
        ...(params.environment ? { environment: params.environment } : {}),
        ...(params.type ? { type: params.type } : {}),
        ...(params.difficultyLevel
          ? { difficultyLevel: params.difficultyLevel }
          : {})
      }
    }
  )
  return data
}

export async function getInterviewQuestion(id: string) {
  const { data } = await api.get<InterviewQuestion>(`/admin/questions/${id}`)
  return data
}

export async function createInterviewQuestion(payload: InterviewQuestionPayload) {
  const { data } = await api.post<InterviewQuestion>("/admin/questions", payload)
  return data
}

export async function updateInterviewQuestion(
  id: string,
  payload: Partial<InterviewQuestionPayload>
) {
  const { data } = await api.patch<InterviewQuestion>(
    `/admin/questions/${id}`,
    payload
  )
  return data
}

export async function deleteInterviewQuestion(id: string) {
  const { data } = await api.delete<{ success: boolean; id: string }>(
    `/admin/questions/${id}`
  )
  return data
}

// ---------------------------------------------------------------------
// File attachments (per-question presigned-PUT flow)
// ---------------------------------------------------------------------

export async function initInterviewQuestionUpload(
  id: string,
  payload: { mimeType: string; filename: string }
) {
  const { data } = await api.post<InterviewQuestionPresignedPutResponse>(
    `/admin/questions/${id}/files/upload-init`,
    payload
  )
  return data
}

/**
 * Direct browser PUT to S3 with the presigned URL. Uses a fresh axios
 * instance so the global crypto + cookie interceptors on `@/lib/api`
 * don't tamper with the request (S3 rejects any header it didn't sign
 * for). `x-amz-server-side-encryption: AES256` is sent explicitly to
 * satisfy the bucket's `DenyUnencryptedObjectUploads` policy — see the
 * matching note in `demoVideoApi.ts`.
 */
export async function uploadToPresignedUrl(
  uploadUrl: string,
  file: File,
  contentType: string,
  onProgress?: (pct: number) => void
) {
  await axios.put(uploadUrl, file, {
    headers: {
      "Content-Type": contentType,
      "x-amz-server-side-encryption": "AES256"
    },
    withCredentials: false,
    onUploadProgress: (event) => {
      if (event.total && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100))
      }
    }
  })
}

/**
 * Finalize an attachment after the browser PUT to S3 finishes. Returns
 * the refreshed question detail (with the new file's presigned URL).
 */
export async function completeInterviewQuestionUpload(
  id: string,
  payload: {
    key: string
    mimeType: string
    sizeBytes?: number
    filename?: string
    purpose?: string
  }
) {
  const { data } = await api.post<InterviewQuestion>(
    `/admin/questions/${id}/files/upload-complete`,
    payload
  )
  return data
}

/** Remove one attachment from a question. Returns the refreshed detail. */
export async function removeInterviewQuestionFile(id: string, key: string) {
  const { data } = await api.delete<InterviewQuestion>(
    `/admin/questions/${id}/files`,
    { data: { key } }
  )
  return data
}
