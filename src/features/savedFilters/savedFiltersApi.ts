import api from "@/lib/api"
import type {
  CreateSavedFilterPayload,
  SavedFilter,
  UpdateSavedFilterPayload,
} from "@/features/savedFilters/types"

/** All saved filter views, in display order. */
export async function fetchSavedFilters() {
  const { data } = await api.get<{ data: SavedFilter[] }>(
    "/admin/saved-filters",
  )
  return data.data
}

export async function createSavedFilter(payload: CreateSavedFilterPayload) {
  const { data } = await api.post<SavedFilter>("/admin/saved-filters", payload)
  return data
}

export async function updateSavedFilter(
  id: string,
  payload: UpdateSavedFilterPayload,
) {
  const { data } = await api.patch<SavedFilter>(
    `/admin/saved-filters/${id}`,
    payload,
  )
  return data
}

export async function deleteSavedFilter(id: string) {
  const { data } = await api.delete<{ success: boolean; id: string }>(
    `/admin/saved-filters/${id}`,
  )
  return data
}

/** Persist a new view order (send the COMPLETE ordered id list). */
export async function reorderSavedFilters(ids: string[]) {
  const { data } = await api.patch<{ requested: number; updated: number }>(
    "/admin/saved-filters/reorder",
    { ids },
  )
  return data
}
