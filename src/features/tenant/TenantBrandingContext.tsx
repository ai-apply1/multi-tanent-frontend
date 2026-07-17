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
import { applyTenantTheme } from "@/features/tenant/applyTenantTheme"

/**
 * The org that owns this dashboard's domain, resolved once and applied to the
 * document.
 *
 * Runs OUTSIDE the auth boundary, deliberately: it reads the public
 * `GET /org/branding`, which the backend answers from the request's host. So
 * the login page already says "Ragzon" in the tab and shows Ragzon's logo,
 * before anyone has typed a password. The authenticated `/admin/organization`
 * could never do that — it takes the org from a session that does not exist
 * yet.
 *
 * `null` is a normal state, not an error: localhost without `?tenant=`, a
 * preview URL, or a domain whose DNS points here before we have an org for it.
 * The platform's own title and favicon stay, which is the correct fallback.
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
 * the branding was destroyed microseconds after it arrived — and with
 * `staleTime: Infinity` nothing ever went back for it. `login()` clears again
 * on each attempt.
 *
 * That clearing is right for what it was written for: org-scoped ROWS from one
 * session must not survive into the next admin's. But branding is not session
 * data. It belongs to the HOST, is identical for every user who loads this
 * domain, and is public — there is nothing in it to leak between sessions.
 *
 * Rather than teach three `clear()` call sites to spare one query key (a rule
 * the fourth would silently break), this owns its state. It is fetched once per
 * page load and never changes, so it needs no cache, no invalidation and no
 * refetch — which is most of what React Query is for.
 */
const TenantBrandingContext = createContext<TenantBranding | null>(null)

/**
 * Swap the tab's favicon.
 *
 * Rewrites the EXISTING `<link rel="icon">` from `index.html` rather than
 * appending a second one: browsers are inconsistent about which of several
 * icons they pick, so appending gives you a coin flip between the platform's
 * icon and the tenant's. Falls back to creating the link only if the static one
 * has been removed.
 */
const applyFavicon = (href: string): void => {
  const link =
    document.querySelector<HTMLLinkElement>("link[rel~='icon']") ??
    document.head.appendChild(
      Object.assign(document.createElement("link"), { rel: "icon" }),
    )
  link.href = href
  // The static icon is `type="image/svg+xml"`; an org's may be a .png or .ico.
  // A stale type attribute is a rendering coin flip, so let the server's
  // Content-Type decide instead of asserting the wrong one.
  link.removeAttribute("type")
}

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

  useEffect(() => {
    // No tenant: drop any override so the stylesheet's own colours resume.
    // Not an else-branch on the block below — this must run when a tenant goes
    // away, not only when one arrives.
    applyTenantTheme(branding?.theme.primary ?? null)
    if (!branding) return

    // The employer's name, not the platform's. An HR user lives in this tab all
    // day beside a dozen others; a vendor's name tells them nothing about which
    // one it is, and if they administer two orgs it is actively wrong.
    document.title = branding.name

    if (branding.faviconUrl) applyFavicon(branding.faviconUrl)
  }, [branding])

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
