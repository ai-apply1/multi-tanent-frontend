import api from "@/lib/api"
import type {
  CreateManualOverviewStatPayload,
  CreateOverviewStatPayload,
  OverviewFilterOption,
  OverviewStat
} from "@/features/overview/types"

/** Filter dimensions an admin can build a stat card from. */
export async function fetchOverviewFilterOptions() {
  const { data } = await api.get<{ data: OverviewFilterOption[] }>(
    "/admin/overview/filter-options"
  )
  return data.data
}

/**
 * Saved stat cards in board order, each with a LIVE count. The backend
 * recomputes counts on every call, so refetching this query is how a card
 * "fetches new counts".
 *
 * `jobId` is the page-level overlay: pass a job to scope every card to it, or
 * omit it (the "All jobs" default) to count across the whole org. It ANDs on
 * top of each card's own criteria — including the empty-criteria card.
 */
export async function fetchOverviewStats(jobId?: string) {
  const { data } = await api.get<{ data: OverviewStat[] }>(
    "/admin/overview/stats",
    jobId ? { params: { jobId } } : undefined
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

/**
 * Update a filter metric card (title and/or its filter criteria). `criteria`
 * REPLACES the stored list, so always send the complete end state.
 */
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
  const { data } = await api.delete<{ deleted: true; statId: string }>(
    `/admin/overview/stats/${id}`
  )
  return data
}

/** Delete several cards in one call (the dashboard's multi-select). */
export async function bulkDeleteOverviewStats(ids: string[]) {
  const { data } = await api.post<{ deleted: number }>(
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
  const { data } = await api.patch<{ data: OverviewStat[] }>(
    "/admin/overview/stats/reorder",
    { ids }
  )
  return data.data
}
