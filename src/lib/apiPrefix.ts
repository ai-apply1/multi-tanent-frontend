/**
 * The backend's global route prefix, spelled ONCE for the whole app.
 *
 * It lives in its own zero-import module (not in `@/lib/api`) so `crypto.ts` can
 * use it for the bootstrap fetch without importing `@/lib/api` — which imports
 * `crypto.ts` back and would create a load-time cycle. `@/lib/api` re-exports
 * this, so existing `import { API_PREFIX } from "@/lib/api"` keeps working.
 */
export const API_PREFIX = "/api/v1"
