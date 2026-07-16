import api from "@/lib/api"
import type {
  CreateTemplatePayload,
  ListTemplatesParams,
  ListTemplatesResponse,
  MessageTemplate,
  UpdateTemplatePayload
} from "@/features/templates/types"

export async function listTemplates(params: ListTemplatesParams = {}) {
  const { data } = await api.get<ListTemplatesResponse>("/admin/templates", {
    params: {
      ...(params.channel ? { channel: params.channel } : {}),
      ...(params.purpose ? { purpose: params.purpose } : {}),
      ...(params.activeOnly ? { activeOnly: "true" } : {})
    }
  })
  return data
}

export async function createTemplate(payload: CreateTemplatePayload) {
  const { data } = await api.post<MessageTemplate>("/admin/templates", payload)
  return data
}

export async function updateTemplate(
  id: string,
  payload: UpdateTemplatePayload
) {
  const { data } = await api.patch<MessageTemplate>(
    `/admin/templates/${id}`,
    payload
  )
  return data
}

export async function deleteTemplate(id: string) {
  const { data } = await api.delete<{ success: boolean; id: string }>(
    `/admin/templates/${id}`
  )
  return data
}
