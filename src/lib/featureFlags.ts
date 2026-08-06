/**
 * Client-side feature flags, read from Vite env vars (`VITE_`-prefixed, so they
 * reach the browser as strings). Flags are resolved ONCE at module load; a
 * change to `.env` needs a dev-server restart (Vite only reads env at startup).
 */

/**
 * Parse a boolean-ish env string. Unset/empty falls back to `fallback` so a var
 * nobody set keeps whatever default the feature ships with. Mirrors the
 * backend's `parseBool` truthy set.
 */
function envBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return fallback
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase())
}

/**
 * Show or hide the LinkedIn integration everywhere in the dashboard — the
 * Settings → Integrations tab (and its card) and the "Post to LinkedIn" controls
 * on a job's detail page.
 *
 *   VITE_LINKEDIN_ENABLED=false → hidden
 *   VITE_LINKEDIN_ENABLED=true / unset → shown (the feature ships enabled)
 */
export const LINKEDIN_ENABLED = envBool(
  import.meta.env.VITE_LINKEDIN_ENABLED,
  true,
)
