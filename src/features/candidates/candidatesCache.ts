import type { QueryClient } from "@tanstack/react-query"

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
}
