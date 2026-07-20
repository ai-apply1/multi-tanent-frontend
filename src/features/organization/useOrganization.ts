import { useQuery } from "@tanstack/react-query"
import { getOrganization } from "@/features/organization/organizationApi"
import { useAuth } from "@/features/auth/AuthContext"

/**
 * The org identity behind the shell (TopBar logo + name, Sidebar brand) and
 * the settings page. React Query dedupes by key, so every consumer shares one
 * request.
 *
 * `enabled` is gated on a session because the shell isn't the only caller:
 * without it the query would fire on the login screen and 401, which the api
 * interceptor answers with a refresh attempt on a session that doesn't exist.
 */
export function useOrganization() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ["organization"],
    queryFn: getOrganization,
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
    /**
     * Poll ONLY while a logo derivation is in flight.
     *
     * The worker finishes in a second or two, but it is a different process
     * with no channel back to this tab, so without this the new variant only
     * appears on a manual refresh — and the admin is looking straight at the
     * spinner it would have replaced. A predicate rather than a fixed interval
     * keeps the shell's own poll rate at zero the rest of the time; this query
     * backs the sidebar on every screen, not just settings.
     */
    refetchInterval: (query) =>
      query.state.data?.logoVariant?.status === "processing" ? 2_000 : false
  })
}
