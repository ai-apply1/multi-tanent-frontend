import { useEffect } from "react"
import { useOrganization } from "@/features/organization/useOrganization"
import { useTenantBranding } from "@/features/tenant/TenantBrandingContext"
import { applyTenantTheme } from "@/features/tenant/applyTenantTheme"
import { useTheme } from "@/features/theme/ThemeContext"
import { PLATFORM_FAVICON, PLATFORM_NAME } from "@/lib/platform"

/**
 * Swap the tab's favicon.
 *
 * Rewrites the EXISTING `<link rel="icon">` from `index.html` rather than
 * appending a second one: browsers are inconsistent about which of several
 * icons they pick, so appending gives a coin flip between the platform's icon
 * and the tenant's. Falls back to creating the link only if the static one has
 * been removed.
 */
const applyFavicon = (href: string): void => {
  const link =
    document.querySelector<HTMLLinkElement>("link[rel~='icon']") ??
    document.head.appendChild(
      Object.assign(document.createElement("link"), { rel: "icon" }),
    )
  link.href = href
  // An org's icon may be a .png, .svg or .ico, and the platform default is an
  // .ico — we can't tell the type from the URL. A wrong `type` is a rendering
  // coin flip, so assert nothing and let the server's Content-Type decide.
  // (`index.html` omits it for the same reason.)
  link.removeAttribute("type")
}

/**
 * The single writer of the browser tab's identity: its title, its favicon and
 * the accent theme. Renders nothing.
 *
 * Mounted INSIDE the auth boundary so it can see both signals at once:
 *
 *  - the AUTHENTICATED org (`useOrganization`), which is who you are logged in
 *    as, resolved from the session's JWT, and
 *  - the host-resolved PUBLIC branding (`useTenantBranding`), which is whose
 *    domain this is.
 *
 * The authenticated org WINS once it loads. The tab must name the org whose
 * data you are actually looking at, not whatever the URL's `?tenant=` says: a
 * user logged into Ragzon with `?tenant=softmind` in the address bar is looking
 * at Ragzon, and the tab has to agree with the sidebar. On the login page there
 * is no session, so the public branding drives it, which is how the employer's
 * name and icon are already on the tab before anyone signs in. With neither, the
 * platform's own name and icon are the fallback.
 *
 * `queryClient.clear()` on logout / auth failure wipes the `organization` query,
 * so the moment a session ends this falls back to the public branding on its
 * own, with no teardown code here.
 */
export function DocumentBranding() {
  const branding = useTenantBranding()
  const { data: org } = useOrganization()
  const { setOrgMode } = useTheme()

  // Authenticated org first, then the host's public branding, then the
  // platform. Each rung is only used when the one above it has nothing.
  const name = org?.name || branding?.name || PLATFORM_NAME
  const faviconUrl = org?.faviconUrl || branding?.faviconUrl || ""
  // Same precedence as the two above, and it matters more here than it looks:
  // the settings page writes the saved profile straight into the `organization`
  // query cache, so saving a new primary repaints the dashboard's accent on the
  // spot instead of on the next full reload. Falling back to the host-resolved
  // branding keeps the login page (no session, no profile) branded.
  //
  // `applyTenantTheme` takes only `primary` — see its header for why the other
  // eight colours are deliberately ignored — and a `null` removes the override
  // so the stylesheet's own light/dark colours resume.
  const primary = org?.theme.primary ?? branding?.theme.primary ?? null

  useEffect(() => {
    document.title = name
  }, [name])

  useEffect(() => {
    // Empty -> the org has no favicon of its own; restore the platform icon
    // rather than leaving the previous tenant's behind.
    applyFavicon(faviconUrl || PLATFORM_FAVICON)
  }, [faviconUrl])

  useEffect(() => {
    applyTenantTheme(primary)
  }, [primary])

  /*
   * The org's saved light/dark mode drives this dashboard too, not just the
   * candidate portals — an org that picks Light should get a light dashboard
   * without every user flipping a switch.
   *
   * Same precedence as the name and icon above: the authenticated org wins, and
   * the host-resolved branding covers the login screen where there is no
   * session yet. `setOrgMode` only acts when the mode CHANGES, so a viewer's
   * own toggle survives until the org changes its mind.
   */
  const orgMode = org?.theme.mode ?? branding?.theme.mode
  useEffect(() => {
    setOrgMode(orgMode)
  }, [orgMode, setOrgMode])

  return null
}
