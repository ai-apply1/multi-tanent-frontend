import { useEffect } from "react"
import { useOrganization } from "@/features/organization/useOrganization"
import { useTenantBranding } from "@/features/tenant/TenantBrandingContext"
import { applyTenantTheme } from "@/features/tenant/applyTenantTheme"
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

  // Authenticated org first, then the host's public branding, then the
  // platform. Each rung is only used when the one above it has nothing.
  const name = org?.name || branding?.name || PLATFORM_NAME
  const faviconUrl = org?.faviconUrl || branding?.faviconUrl || ""
  // The org profile carries no theme, so the accent still comes from the
  // host-resolved branding. `applyTenantTheme` takes only `primary` (see its
  // header for why the other eight colours are deliberately ignored), and a
  // `null` there removes the override so the stylesheet's own colours resume.
  const primary = branding?.theme.primary ?? null

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

  return null
}
