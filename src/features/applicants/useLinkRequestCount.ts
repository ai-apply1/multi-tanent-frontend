import { useQuery } from "@tanstack/react-query"
import { getLinkRequestCount } from "@/features/applicants/applicantsApi"

/**
 * Live count of pending "request a new link" entries, shared by the
 * sidebar + mobile-drawer badges. React Query dedupes by `queryKey`, so
 * both consumers share a single in-flight request. The Link Requests
 * page invalidates `["link-request-count"]` after a resend so the badge
 * drops in step with the queue.
 */
export function useLinkRequestCount() {
  return useQuery({
    queryKey: ["link-request-count"],
    queryFn: getLinkRequestCount,
    staleTime: 30_000,
    // Poll so a request that lands while an admin is on another tab still
    // surfaces without a manual refresh.
    refetchInterval: 60_000
  })
}
