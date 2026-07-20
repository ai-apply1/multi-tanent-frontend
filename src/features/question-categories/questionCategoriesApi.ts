import api from "@/lib/api"
import type { QuestionCategory } from "@/features/question-categories/types"

export const QUESTION_CATEGORIES_QUERY_KEY = ["questionCategories"] as const

export async function listQuestionCategories(): Promise<QuestionCategory[]> {
  const { data } = await api.get<QuestionCategory[]>(
    "/admin/question-categories",
  )
  return data
}

export async function createQuestionCategory(
  label: string,
): Promise<QuestionCategory> {
  const { data } = await api.post<QuestionCategory>(
    "/admin/question-categories",
    { label },
  )
  return data
}

export async function deleteQuestionCategory(id: string): Promise<void> {
  await api.delete(`/admin/question-categories/${id}`)
}
