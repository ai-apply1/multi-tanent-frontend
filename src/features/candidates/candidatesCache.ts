import type { QueryClient } from "@tanstack/react-query"

/**
 * One candidate's REMARKS thread — the drawer's Remarks tab.
 *
 * Lives here, beside the fan-out that invalidates it, rather than in the
 * component that renders it: three surfaces write rows into this thread (the
 * table's status menu, the drawer, the board's drag) and a key spelled by hand
 * at each is a key that goes stale at one of them.
 */
export const remarksQueryKey = (candidateId: string) =>
  ["candidateRemarks", candidateId] as const

/**
 * Invalidate every query whose data is derived from candidate state.
 *
 * A single candidate mutation — a status decision, a delete, a manual invite,
 * a CV import, a kanban drag — can change all of these at once, and they don't
 * live together: the list and the board are on the Candidates page (`candidates`
 * + `candidateKanban`), while the "Awaiting your decision" panel and the KPI
 * cards are on Overview (`awaiting-decision` + `overviewStats`). The drawer that
 * makes most decisions is opened from all three pages, so no single call site
 * can see which surfaces are mounted.
 *
 * Fan out here instead of hand-listing a subset at each call site — that's how
 * the awaiting-decision panel ended up never refreshing after a decision. Every
 * key is a PREFIX: `["candidateKanban"]` matches every per-job board and
 * `["overviewStats"]` matches every job-filtered stats variant. Invalidating a
 * query nothing is observing is free — it's just marked stale and refetches the
 * next time its page mounts — so calling this from anywhere is safe.
 */
export function invalidateCandidateData(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ["candidates"] })
  queryClient.invalidateQueries({ queryKey: ["candidateKanban"] })
  queryClient.invalidateQueries({ queryKey: ["awaiting-decision"] })
  queryClient.invalidateQueries({ queryKey: ["overviewStats"] })
  // The job overview's "Top ranked candidates" leaderboard. It ranks by the
  // interview's `scores.overall`, so a rescore re-orders it and a delete drops
  // a row — and its rows OPEN THE DRAWER, so those mutations are launched from
  // the card itself. Without this the deleted candidate stayed sitting at #1
  // behind the closing drawer.
  queryClient.invalidateQueries({ queryKey: ["jobTopCandidates"] })
  // The drawer's Activity timeline — every mutation above also appends an
  // audit row, so the feed must refetch with the rest or the admin's own
  // action won't appear until reopen.
  queryClient.invalidateQueries({ queryKey: ["candidateActivities"] })
  // The drawer's Remarks thread, for the same reason and one more: a MANUAL
  // STATUS MOVE is itself a row in that thread (it is what makes a run of
  // remarks read as eras), so a move refreshes it even when no remark was
  // attached to it.
  queryClient.invalidateQueries({ queryKey: ["candidateRemarks"] })
}

/**
 * The candidate fan-out PLUS the Jobs list — for the mutations that change a
 * job's TOTAL candidate count: a delete or a CV import.
 *
 * `["jobs"]` is deliberately NOT part of `invalidateCandidateData`. The Jobs
 * list's "Applicants" column is a live COUNT of every candidate for the job
 * regardless of column, so a status decision, a manual invite, or a kanban drag
 * — which keep the same candidate doc — leave that number unchanged, and
 * refetching the whole jobs list on every such mutation would be wasteful. Only
 * creating or deleting a candidate moves the count, so only those call sites
 * reach for this variant. The JobDetailPage KPI reads `candidateKanban` (already
 * fanned out above), so it's the Jobs LIST that would otherwise replay a stale
 * count off the 30s cache.
 */
export function invalidateCandidateDataAndJobCounts(queryClient: QueryClient) {
  invalidateCandidateData(queryClient)
  queryClient.invalidateQueries({ queryKey: ["jobs"] })
}
