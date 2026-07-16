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
    staleTime: 5 * 60_000
  })
}
