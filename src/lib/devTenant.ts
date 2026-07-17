/**
 * DEV ONLY. Which tenant is `localhost`?
 *
 * This dashboard is served per-org in production (`admin.acme.com`), and the
 * backend reads that host to answer three questions:
 *
 *   - whose branding is this? (`GET /org/branding` — the name in the tab, the
 *     favicon, the logo, the accent colour, and it is PUBLIC, so the login page
 *     has it too)
 *   - which org's password table does this login check? (`resolveLoginOrg`)
 *   - does this session's JWT belong to the org this host names? (`JwtAuthGuard`)
 *
 * On `localhost:5174` no custom domain resolves, so none of that works. This
 * lets the URL say which tenant to be:
 *
 *   localhost:5174/?tenant=ragzon.com
 *   localhost:5174/login?tenant=softmind.example
 *   localhost:5174/login                 <- no param, no tenant
 *
 * A HINT, never a grant. The backend has its own `DEV_TENANT_QUERY_ENABLED`
 * switch, ignores the param outright when `NODE_ENV=production`, and only
 * consults it when the request's own host resolved to NO tenant — so it can
 * never displace a real one. Both sides must opt in; this flag alone does
 * nothing.
 *
 * ── The URL at PAGE LOAD is the source of truth ───────────────────────
 *
 * Read ONCE, at module init, and that single decision is the whole design.
 *
 * The param has to survive an in-app navigation: this app calls `navigate()`
 * from 13 places and renders `<Link>`s, none of which carry a query string, so
 * clicking "Jobs" strips it. The obvious fix — remember the value and re-add it
 * whenever the URL lacks it — is what shipped first, and it was wrong: it made
 * the param IMPOSSIBLE TO REMOVE. Delete it from the address bar, press Enter,
 * and it came straight back, because "the user removed it" and "a navigation
 * dropped it" look identical from inside a location change.
 *
 * Capturing at LOAD tells them apart, because a page load is exactly the moment
 * the user's URL is authoritative:
 *
 *   loaded WITH `?tenant=x`  -> x, and `DevTenantSync` keeps it in the address
 *                               bar across navigations
 *   loaded WITHOUT the param -> no tenant, and NOTHING is written to the URL —
 *                               a clean URL stays clean, and the app behaves
 *                               exactly as it does on an unknown host
 *
 * The URL is the ONLY input. There is deliberately no env-var default: one
 * existed, and it was the thing that made "no tenant" unreachable — with it
 * set, clearing the param still resolved an org, so the state every visitor to
 * an unclaimed domain sees could not be reproduced locally. It also needed a
 * rebuild to change, which is precisely what a query param is for.
 *
 * There is deliberately no `sessionStorage`. An earlier version mirrored the
 * value there to survive navigations; capturing at load does that already
 * (module state outlives client-side routing), and the storage only added the
 * bug above. Two tabs can still be two tenants: each page load reads its own
 * URL.
 */

/** `1` / `true` / `yes` / `on`, case-insensitive. Anything else is off. */
const truthy = (raw: string | undefined): boolean =>
  ["1", "true", "yes", "on"].includes((raw ?? "").trim().toLowerCase())

/**
 * The switch. Default OFF, so a build that never sets it behaves exactly like
 * production and cannot be steered by a query param at all.
 */
export const DEV_TENANT_QUERY_ENABLED = truthy(
  import.meta.env.VITE_DEV_TENANT_QUERY_ENABLED,
)

/**
 * A domain is all this accepts. Anything with a slash or a space is a paste
 * accident, not a hostname, and is dropped here rather than sent on.
 *
 * Deliberately loose about shape and strict about nothing else: the backend's
 * directory decides what is a real tenant, and duplicating that judgement here
 * would let the two disagree.
 */
const DOMAIN_PATTERN = /^[a-z0-9.-]+(:\d+)?$/i

const normalise = (value: string): string => {
  // Tolerate a pasted URL: `https://admin.acme.com/login` -> `admin.acme.com`.
  const host = value
    .replace(/^[a-z]+:\/\//i, "")
    .split("/")[0]
    .split("?")[0]
    .trim()
  return DOMAIN_PATTERN.test(host) ? host : ""
}

/** The `tenant` param as it stood when this page loaded. `""` when absent. */
const INITIAL_PARAM: string =
  typeof window === "undefined"
    ? ""
    : (new URLSearchParams(window.location.search).get("tenant") ?? "").trim()

/**
 * The tenant this page load is for, or `""`.
 *
 * Constant for the lifetime of the page: a client-side navigation cannot change
 * it, which is what stops a dropped param from silently switching orgs.
 */
export const devTenant = (): string =>
  DEV_TENANT_QUERY_ENABLED ? normalise(INITIAL_PARAM) : ""

/**
 * Should `DevTenantSync` keep `?tenant=` in the address bar?
 *
 * Only when this page load resolved a tenant, which now happens only when the
 * URL carried one. Nothing else can put a param there.
 */
export const shouldPinTenantParam = (): boolean => Boolean(devTenant())
