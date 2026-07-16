import api from "@/lib/api"
import type {
  CreatePipelineGroupPayload,
  CreatePipelineStatusPayload,
  PipelineCatalog,
  PipelineGroup,
  PipelineStatus,
  UpdatePipelineGroupPayload,
  UpdatePipelineStatusPayload,
} from "@/features/pipeline/types"

/** The full pipeline catalog (groups + statuses) for chips, actions, filters. */
export async function fetchPipelineCatalog() {
  const { data } = await api.get<PipelineCatalog>("/admin/pipeline")
  return data
}

export async function createPipelineGroup(payload: CreatePipelineGroupPayload) {
  const { data } = await api.post<PipelineGroup>(
    "/admin/pipeline/groups",
    payload,
  )
  return data
}

export async function updatePipelineGroup(
  key: string,
  payload: UpdatePipelineGroupPayload,
) {
  const { data } = await api.patch<PipelineGroup>(
    `/admin/pipeline/groups/${encodeURIComponent(key)}`,
    payload,
  )
  return data
}

export async function deletePipelineGroup(key: string, force = false) {
  const { data } = await api.delete<{
    success: boolean
    key: string
    removedStatuses: number
  }>(
    `/admin/pipeline/groups/${encodeURIComponent(key)}${force ? "?force=1" : ""}`,
  )
  return data
}

export async function createPipelineStatus(
  payload: CreatePipelineStatusPayload,
) {
  const { data } = await api.post<PipelineStatus>(
    "/admin/pipeline/statuses",
    payload,
  )
  return data
}

export async function updatePipelineStatus(
  key: string,
  payload: UpdatePipelineStatusPayload,
) {
  const { data } = await api.patch<PipelineStatus>(
    `/admin/pipeline/statuses/${encodeURIComponent(key)}`,
    payload,
  )
  return data
}

export async function deletePipelineStatus(key: string, force = false) {
  const { data } = await api.delete<{
    success: boolean
    key: string
    removedAssignments: number
  }>(
    `/admin/pipeline/statuses/${encodeURIComponent(key)}${force ? "?force=1" : ""}`,
  )
  return data
}
