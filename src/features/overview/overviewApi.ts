import api from "@/lib/api"
import type {
  CreateManualOverviewStatPayload,
  CreateOverviewStatPayload,
  OverviewFilterOption,
  OverviewStat
} from "@/features/overview/types"
import type { ApplicantSource } from "@/features/applicants/types"

/** Filter dimensions an admin can build a stat card from. */
export async function fetchOverviewFilterOptions() {
  const { data } = await api.get<{ options: OverviewFilterOption[] }>(
    "/admin/overview/filter-options"
  )
  return data.options
}

/**
 * Saved stat cards, each with a LIVE count. The backend recomputes counts on
 * every call, so refetching this query is how a card "fetches new counts".
 *
 * `source` is the page-level marketing-channel overlay: pass a bucket to scope
 * every card to that channel, or omit it (the "All sources" default) to count
 * across every source.
 */
export async function fetchOverviewStats(source?: ApplicantSource) {
  const { data } = await api.get<{ data: OverviewStat[] }>(
    "/admin/overview/stats",
    source ? { params: { source } } : undefined
  )
  return data.data
}

export async function createOverviewStat(payload: CreateOverviewStatPayload) {
  const { data } = await api.post<OverviewStat>("/admin/overview/stats", {
    kind: "filter",
    ...payload
  })
  return data
}

/**
 * Create a manual card: a title plus a fixed number the admin typed. Unlike a
 * filter metric its count never recomputes, it always shows `value`.
 */
export async function createManualOverviewStat(
  payload: CreateManualOverviewStatPayload
) {
  const { data } = await api.post<OverviewStat>("/admin/overview/stats", {
    kind: "manual",
    ...payload
  })
  return data
}

/** Update a filter metric card (title and/or its filter criteria). */
export async function updateOverviewStat(
  id: string,
  payload: CreateOverviewStatPayload
) {
  const { data } = await api.patch<OverviewStat>(
    `/admin/overview/stats/${id}`,
    payload
  )
  return data
}

/** Update a manual card (title and/or its fixed number). */
export async function updateManualOverviewStat(
  id: string,
  payload: CreateManualOverviewStatPayload
) {
  const { data } = await api.patch<OverviewStat>(
    `/admin/overview/stats/${id}`,
    payload
  )
  return data
}

export async function deleteOverviewStat(id: string) {
  const { data } = await api.delete<{ success: boolean; id: string }>(
    `/admin/overview/stats/${id}`
  )
  return data
}

/** Delete several metrics in one call (the dashboard's multi-select). */
export async function bulkDeleteOverviewStats(ids: string[]) {
  const { data } = await api.post<{ requested: number; deleted: number }>(
    "/admin/overview/stats/bulk-delete",
    { ids }
  )
  return data
}

/**
 * Persist a new card order. Send the COMPLETE ordered id list (after a drag);
 * the backend rewrites each card's position to its index, so the order sticks.
 */
export async function reorderOverviewStats(ids: string[]) {
  const { data } = await api.patch<{ requested: number; updated: number }>(
    "/admin/overview/stats/reorder",
    { ids }
  )
  return data
}
