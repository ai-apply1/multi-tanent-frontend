import { useEffect } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { devTenant, shouldPinTenantParam } from "@/lib/devTenant"

/**
 * DEV ONLY. Keeps `?tenant=` in the address bar across every navigation.
 *
 * Why this exists rather than a fix at each link: the app navigates from 15
 * places (`navigate()` x13, `<Link>` x2), none of which carry a query string,
 * so clicking "Jobs" would strip the param. `devTenant()` would still resolve
 * the right org — it is captured at page load — so nothing would BREAK. The URL
 * would just stop saying which tenant you are looking at, and a URL you cannot
 * trust is worse than no URL: you would copy it to a colleague and they would
 * open a different org's dashboard without either of you noticing.
 *
 * It re-adds the param ONLY when the page was loaded with one
 * (`shouldPinTenantParam`). Re-adding it unconditionally is what made the param
 * undeletable: from inside a location change, a user clearing the address bar
 * and a `navigate()` dropping it are the same event.
 *
 * Sitting at the router root also means a link added tomorrow is covered by
 * construction. Threading a helper through 15 call sites is a standing
 * invitation to miss the sixteenth.
 *
 * `replace`, not `push`: re-adding the param is not a place the user navigated
 * to, and pushing would make Back bounce between the same page with and without
 * a query string.
 *
 * A hard no-op in production. `devTenant()` returns "" when the switch is off,
 * so this renders nothing and never touches history.
 */
export const DevTenantSync = () => {
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    // Only when THIS page load asked for a tenant in its URL. A page loaded
    // without the param keeps its clean URL: re-adding one there is what made
    // the param impossible to delete, because the app could not tell a user
    // removing it from a `navigate()` dropping it.
    if (!shouldPinTenantParam()) return

    const tenant = devTenant()
    if (!tenant) return

    const params = new URLSearchParams(location.search)
    // Already correct — including the case where the URL is the source of
    // truth. Bailing here is what stops an infinite navigate loop.
    if (params.get("tenant") === tenant) return

    params.set("tenant", tenant)
    navigate(
      { pathname: location.pathname, search: `?${params.toString()}`, hash: location.hash },
      { replace: true },
    )
  }, [location.pathname, location.search, location.hash, navigate])

  return null
}
