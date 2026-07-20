/**
 * Pipeline data layer — the org's candidate-status catalog CRUD.
 *
 * Every call here is a real endpoint on `/admin/statuses`:
 *
 *   GET    /admin/statuses      → `listCandidateStatuses` (candidatesApi —
 *                                 shared with the Candidates page's filter
 *                                 and the kanban headers, so it is NOT
 *                                 duplicated here; re-exported for symmetry)
 *   POST   /admin/statuses      → createStatusColumn
 *   PATCH  /admin/statuses/:id  → updateStatusColumn
 *   DELETE /admin/statuses/:id  → deleteStatusColumn
 *
 * The mutations are named `*StatusColumn` rather than `*CandidateStatus` to
 * keep them distinct from `updateCandidateStatus` in `candidatesApi`, which
 * moves ONE CANDIDATE between columns. These edit the columns themselves.
 */

import api from "@/lib/api"
import type { CandidateStatus } from "@/features/candidates/types"
import { listCandidateStatuses } from "@/features/candidates/candidatesApi"
import type { CreateStatusPayload, UpdateStatusPayload } from "./types"

export { listCandidateStatuses }

/**
 * Create a CUSTOM column. `key` is validated server-side as a slug and is
 * immutable afterwards; a duplicate key in this org is a 409. The
 * `builtin` / `isProtected` flags are server-owned and always false here,
 * whatever the client sends.
 */
export async function createStatusColumn(payload: CreateStatusPayload) {
  const { data } = await api.post<CandidateStatus>("/admin/statuses", payload)
  return data
}

/**
 * Edit a column's DISPLAY fields — label / color / stageOrder. Works on
 * protected builtins too: an org may rename "Pre-screened" to "CV review"
 * without breaking anything, because automations address columns by `key`
 * and `key` cannot be edited.
 */
export async function updateStatusColumn(
  statusId: string,
  payload: UpdateStatusPayload,
) {
  const { data } = await api.patch<CandidateStatus>(
    `/admin/statuses/${statusId}`,
    payload,
  )
  return data
}

/**
 * Delete a CUSTOM column. Two server guards the UI surfaces verbatim:
 * 403 for a protected builtin (the funnel automations must always find
 * them) and 409 while any candidate still sits in the column.
 */
export async function deleteStatusColumn(statusId: string) {
  const { data } = await api.delete<{ deleted: true; statusId: string }>(
    `/admin/statuses/${statusId}`,
  )
  return data
}

/**
 * Persist a drag-and-drop reorder in ONE atomic request.
 *
 * Send the COMPLETE catalog in its new order — not just the rows that
 * moved, and no `stageOrder` values. The server derives the numbering
 * (10, 20, 30 …) and applies the whole board in a single transaction, so
 * the catalog is never observable in a half-renumbered state.
 *
 * Sending the whole list is also the concurrency check: a 409 means a
 * column was added or deleted since the drag began, and the correct
 * response is to refetch rather than to retry.
 *
 * Returns the reordered catalog, so the caller can drop it straight into
 * the query cache without a follow-up read.
 */
export async function reorderStatusColumns(statusIds: string[]) {
  const { data } = await api.patch<CandidateStatus[]>(
    "/admin/statuses/reorder",
    { statusIds },
  )
  return data
}
