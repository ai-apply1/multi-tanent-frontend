import api from "@/lib/api"
import type {
  CreateVariablePayload,
  TemplateVariableEntry,
  UpdateVariablePayload
} from "@/features/templates/types"

export async function listVariables() {
  const { data } = await api.get<TemplateVariableEntry[]>(
    "/admin/template-variables"
  )
  return data
}

export async function createVariable(payload: CreateVariablePayload) {
  const { data } = await api.post<TemplateVariableEntry>(
    "/admin/template-variables",
    payload
  )
  return data
}

export async function updateVariable(
  id: string,
  payload: UpdateVariablePayload
) {
  const { data } = await api.patch<TemplateVariableEntry>(
    `/admin/template-variables/${id}`,
    payload
  )
  return data
}

export async function deleteVariable(id: string) {
  const { data } = await api.delete<{ success: boolean; id: string }>(
    `/admin/template-variables/${id}`
  )
  return data
}
