import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import {
  fetchTenantBranding,
  type TenantBranding,
} from "@/features/tenant/tenantBrandingApi"

/**
 * The org that owns this dashboard's DOMAIN, resolved once from the public,
 * host-resolved `GET /org/branding` and exposed to the tree.
 *
 * This is a pure DATA provider: it fetches the branding and holds it, and
 * touches the document itself for nothing. `DocumentBranding` (mounted inside
 * the auth boundary) is the single writer of the tab title, favicon and theme,
 * because once someone is logged in the AUTHENTICATED org outranks the host for
 * those, and only a component below `AuthProvider` can see both signals at once.
 *
 * This provider sits ABOVE the auth boundary on purpose: the LOGIN page has no
 * session, so the host-resolved branding is the only thing that can put the
 * employer's name and icon on the tab before anyone signs in.
 *
 * `null` is a normal state, not an error: localhost without `?tenant=`, a
 * preview URL, or a domain whose DNS points here before we have an org for it.
 *
 * ── Why this holds its own state instead of using React Query ─────────
 *
 * It used to use React Query, and the branding vanished on every page load
 * while the request itself returned a perfectly good 200. Worth knowing about,
 * because the cause is not obvious from here.
 *
 * `AuthContext` calls `queryClient.clear()` on auth failure, and on the LOGIN
 * page auth failure is GUARANTEED: `refreshMe()` probes `/admin/auth/me`, that
 * 401s because there is no session yet, the interceptor tries `/refresh`, that
 * 401s too, and `notifyAuthFailure()` fires. `clear()` wipes EVERY query, so
 * the branding was destroyed microseconds after it arrived, and with
 * `staleTime: Infinity` nothing ever went back for it. `login()` clears again
 * on each attempt.
 *
 * That clearing is right for what it was written for: org-scoped ROWS from one
 * session must not survive into the next admin's. But branding is not session
 * data. It belongs to the HOST, is identical for every user who loads this
 * domain, and is public, so there is nothing in it to leak between sessions.
 *
 * Rather than teach three `clear()` call sites to spare one query key (a rule
 * the fourth would silently break), this owns its state. It is fetched once per
 * page load and never changes, so it needs no cache, no invalidation and no
 * refetch, which is most of what React Query is for.
 */
const TenantBrandingContext = createContext<TenantBranding | null>(null)

export const TenantBrandingProvider = ({
  children,
}: {
  children: ReactNode
}) => {
  const [branding, setBranding] = useState<TenantBranding | null>(null)

  useEffect(() => {
    let cancelled = false

    // One attempt, one retry. A 404 is NOT an error here — it resolves to null
    // — so this can only ever retry a genuine failure, and never spins on "no
    // tenant". See `fetchTenantBranding`.
    const load = async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const data = await fetchTenantBranding()
          if (!cancelled) setBranding(data)
          return
        } catch {
          if (attempt === 1 && import.meta.env.DEV) {
            console.warn(
              "[tenant] branding lookup failed twice — falling back to platform branding.",
            )
          }
        }
      }
    }
    void load()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <TenantBrandingContext.Provider value={branding}>
      {children}
    </TenantBrandingContext.Provider>
  )
}

/**
 * This host's org, or `null`.
 *
 * Returns null rather than throwing outside a provider's resolved state,
 * because "we don't know whose dashboard this is" is a state every consumer
 * must render around anyway — on localhost it is the normal one.
 */
export const useTenantBranding = (): TenantBranding | null =>
  useContext(TenantBrandingContext)
