/**
 * Build-time HTTP Basic Auth credential shared by every backend request
 * this SPA sends. The backend wraps a `BasicAuthMiddleware` around the
 * entire NestJS surface in production — if these credentials are absent
 * the admin app will see a wall of 401s as soon as it tries to bootstrap
 * the crypto layer.
 *
 * Wire format — THREE PARTS:
 *   Authorization: Basic <base64(USERNAME:PASSWORD:CLIENT_MARKER)>
 *
 * The CLIENT_MARKER is the "third attribute" smuggled into the
 * standard Basic Auth password slot. It's an opaque value (e.g.
 * `PUBLIC_USER=<random>`) that's shared between this SPA and the
 * backend but never exposed in API docs. Credential-stuffing scanners
 * that only guess `user:pass` get 401'd because they don't know to
 * append the marker.
 *
 * Configuration (read from Vite's `import.meta.env` — i.e., baked into
 * the bundle at build time, not read at runtime):
 *
 *   VITE_API_BASIC_AUTH        Pre-encoded `base64(user:pass:marker)`.
 *                              This is exactly what's sent on the wire
 *                              after `Basic `. Preferred for Vercel
 *                              because there's just ONE variable.
 *
 *   VITE_API_BASIC_AUTH_USER     Plaintext fallback — used when the
 *   VITE_API_BASIC_AUTH_PASS     pre-encoded value is missing. The
 *   VITE_API_BASIC_AUTH_MARKER   SPA combines them as
 *                                `user:pass:marker` and base64-encodes
 *                                at module load. Plaintext is never
 *                                retained after encoding.
 *
 * Security note: ANYTHING baked into a browser bundle is readable by
 * anyone who visits the site. The backend's Basic Auth is a PERIMETER —
 * it stops random probes and credential-stuffing scanners, not
 * authenticated users inspecting their own bundle. Real authn lives on
 * top (httpOnly admin cookies). Don't treat this header as a secret.
 */

const encoded = (() => {
  const direct = import.meta.env.VITE_API_BASIC_AUTH?.trim()
  if (direct) return direct

  const user = import.meta.env.VITE_API_BASIC_AUTH_USER?.trim()
  const pass = import.meta.env.VITE_API_BASIC_AUTH_PASS?.trim()
  const marker = import.meta.env.VITE_API_BASIC_AUTH_MARKER?.trim()
  if (user && pass) {
    try {
      const combined = marker ? `${user}:${pass}:${marker}` : `${user}:${pass}`
      return btoa(combined)
    } catch {
      // `btoa` throws on non-Latin1 input. Fall through to "disabled".
      return ""
    }
  }
  return ""
})()

/** Full `Authorization` header value, or `null` when basic auth is off. */
export const BASIC_AUTH_HEADER: string | null = encoded ? `Basic ${encoded}` : null

/** True when this build is configured to send Basic Auth on every request. */
export const BASIC_AUTH_ENABLED: boolean = BASIC_AUTH_HEADER !== null
