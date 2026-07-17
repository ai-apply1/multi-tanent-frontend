/**
 * The PLATFORM's own identity: the fallback shown when a tenant has none.
 *
 * One home, deliberately. The name used to be the literal string "Jobjen"
 * hardcoded in six places (a page title, two `alt`s, two `aria-label`s, a
 * settings hint) plus two logo files, which is how a white-label product ends
 * up shipping its vendor's name to a customer's own domain. Every one of those
 * now reads from here.
 *
 * This is a FALLBACK, and it should be rare. Almost every page here is served
 * from a customer's domain and paints that customer's name and logo, resolved
 * from `GET /org/branding`. This is what shows when there is genuinely no
 * tenant to name: localhost without `?tenant=`, a preview URL, or an org that
 * has not uploaded a logo.
 *
 * `VITE_PLATFORM_NAME` overrides it at build time, so a deployment can be
 * rebranded without a code change. The default is deliberately generic rather
 * than a real product name: a placeholder that is obviously a placeholder gets
 * replaced, whereas someone else's brand sitting in the fallback slot looks
 * intentional and survives for years.
 */
export const PLATFORM_NAME: string =
  (import.meta.env.VITE_PLATFORM_NAME ?? "").trim() || "Talent Portal"

/**
 * The platform mark, in two variants because the dashboard has a light and a
 * dark theme and a single mark is illegible in one of them.
 *
 * Placeholders. Both are neutral wordmarks that render the name above; swap the
 * files (or point these at new ones) to rebrand. They live in `public/` rather
 * than being inlined so they can be replaced without a rebuild.
 */
export const PLATFORM_LOGO = {
  /** Dark ink, for the light theme. */
  light: "/platform-logo-dark.svg",
  /** White ink, for the dark theme. */
  dark: "/platform-logo.svg",
} as const

/**
 * The browser-tab icon shown when no tenant resolves. Matches the static
 * `<link rel="icon">` in `index.html`; `DocumentBranding` swaps back to this
 * when an org has no favicon of its own. A file in `public/` rather than an
 * inlined data URI so it can be replaced without a rebuild.
 */
export const PLATFORM_FAVICON = "/favicon.ico"
