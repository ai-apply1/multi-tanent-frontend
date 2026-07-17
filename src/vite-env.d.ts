/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Absolute origin of jobjen-backend (no trailing slash, no `/api`). The
   * app calls the backend directly via this in every environment (no dev
   * proxy, no Vercel rewrite). Defaults to http://localhost:3001 when
   * unset; set it to https://api.jobjen.com in production and to the dev
   * backend origin for a dev-branch deployment.
   */
  readonly VITE_API_BASE_URL?: string
  /**
   * Pre-encoded `base64(user:pass:client_marker)` value for the
   * backend's perimeter Basic Auth gate. When set, every backend
   * request (axios + the crypto bootstrap fetch + the admin video
   * stream) ships an `Authorization: Basic <value>` header. Leave
   * unset to disable.
   */
  readonly VITE_API_BASIC_AUTH?: string
  /** Fallback: plaintext basic-auth username. Used when VITE_API_BASIC_AUTH is empty. */
  readonly VITE_API_BASIC_AUTH_USER?: string
  /** Fallback: plaintext basic-auth password. Used when VITE_API_BASIC_AUTH is empty. */
  readonly VITE_API_BASIC_AUTH_PASS?: string
  /** Fallback: plaintext basic-auth client marker (the third attribute). */
  readonly VITE_API_BASIC_AUTH_MARKER?: string
  /**
   * The platform's own display name, shown only when no tenant resolves.
   * See `src/lib/platform.ts`. Defaults to "Talent Portal" when unset.
   */
  readonly VITE_PLATFORM_NAME?: string
  /**
   * DEV ONLY. Lets `?tenant=<domain>` pick which org this build renders as.
   * Default OFF. A hint, never a grant: the backend has its own
   * `DEV_TENANT_QUERY_ENABLED` switch and ignores the param in production
   * entirely, so this alone does nothing. See `src/lib/devTenant.ts`.
   */
  readonly VITE_DEV_TENANT_QUERY_ENABLED?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module "*.css"
declare module "*.svg"
