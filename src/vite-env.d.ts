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
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module "*.css"
declare module "*.svg"
