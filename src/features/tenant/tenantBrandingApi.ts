import api from "@/lib/api"

/**
 * The org that owns the domain this dashboard is being served from.
 *
 * `GET /org/branding` is PUBLIC and resolved from the request's own host, which
 * is why this dashboard can paint an employer's name and logo on the LOGIN
 * page, before any JWT exists. The authenticated `/admin/organization` cannot:
 * it takes the org from the session, so it has nothing to say until someone has
 * already signed in.
 *
 * In dev the host is `localhost`, which names no tenant — the axios layer
 * appends `?tenant=` for exactly this (see `lib/devTenant.ts`).
 *
 * Same shape the apply portal and the screening SPA read, from the same
 * endpoint. Kept in step with the backend's `getBrandingBySlug`.
 */
export interface TenantBranding {
  name: string
  slug: string
  /** '' when the org never uploaded one. Render the name instead. */
  logoUrl: string
  /**
   * The variant for DARK backgrounds. '' means "use `logoUrl` on both
   * themes", NOT "no logo" — most orgs upload a single mark.
   */
  logoDarkUrl: string
  /** '' when unset. Keep the platform icon rather than inventing a fallback. */
  faviconUrl: string
  status: "active" | "inactive"
  theme: {
    /**
     * The org's stated light/dark choice for its CANDIDATE pages. Not this
     * dashboard's theme, which is a per-viewer toggle in `ThemeContext`.
     */
    mode: "light" | "dark"
    primary: string
    secondary: string
    /** A MODE, not a colour: how primary and secondary combine. */
    accent: "gradient" | "solid"
    background: string
    surface: string
    foreground: string
    success: string
    warning: string
    danger: string
  }
}

/**
 * Resolve this host's org, or `null` when the host names no tenant.
 *
 * ── 404 is an answer; everything else is a failure ────────────────────
 *
 * A 404 means there genuinely is no org for this host: localhost without
 * `?tenant=`, a preview URL, a domain pointed here before we have a tenant for
 * it. `null` is the right answer, the caller keeps the platform's branding, and
 * caching it is correct.
 *
 * Anything else — a network blip, a 5xx, a crypto failure — is NOT an answer,
 * and this used to `catch { return null }` over all of it. That was a real bug:
 * React Query sees `null` as SUCCESS, and with `staleTime: Infinity` it caches
 * that "answer" for the whole page session. One transient failure on first load
 * left the dashboard permanently unbranded, with no error anywhere and no
 * retry — indistinguishable, from the outside, from a tenant that has no logo.
 *
 * So a real failure THROWS. React Query then knows it failed, retries it, and
 * never caches it as truth.
 */
export const fetchTenantBranding = async (): Promise<TenantBranding | null> => {
  try {
    const { data } = await api.get<TenantBranding>("/org/branding")
    return data
  } catch (error) {
    const status = (error as { response?: { status?: number } })?.response
      ?.status
    if (status === 404) return null

    // Loud in dev, because the failure is otherwise invisible: the page simply
    // renders unbranded, which looks exactly like a tenant with no logo.
    if (import.meta.env.DEV) {
      console.warn(
        "[tenant] branding lookup failed — falling back to platform branding. " +
          "This is NOT the same as 'no tenant'.",
        error,
      )
    }
    throw error
  }
}
