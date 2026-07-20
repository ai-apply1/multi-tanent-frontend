import axios, { AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from "axios"
import {
  decryptBody,
  encryptBody,
  invalidateCryptoBootstrap,
  makeRequestCrypto,
  type EncryptedEnvelope,
  type RequestCrypto
} from "@/lib/crypto"
import { BASIC_AUTH_HEADER } from "@/lib/basicAuth"
import { devTenant } from "@/lib/devTenant"

/**
 * Default request headers sent on every backend call.
 *
 * `Authorization: Basic <…>` is added when the build was configured
 * with `VITE_API_BASIC_AUTH(_USER/_PASS)`. The backend's perimeter
 * `BasicAuthMiddleware` runs in front of every route — including the
 * crypto bootstrap and the admin login — so this header has to be on
 * the request the very first time the SPA touches the API, before the
 * cookie-based admin session even exists.
 */
const defaultHeaders: Record<string, string> = {
  "X-Requested-With": "XMLHttpRequest"
}
if (BASIC_AUTH_HEADER) defaultHeaders.Authorization = BASIC_AUTH_HEADER

/**
 * Absolute origin of jobjen-backend (no trailing slash, no `/api`).
 *
 * The app talks to the backend DIRECTLY in every environment — there's no
 * Vite dev proxy and no Vercel `/api` rewrite. Set `VITE_API_BASE_URL`
 * per deployment:
 *   - local dev   → http://localhost:3001 (the default below)
 *   - production  → https://api.jobjen.com
 *   - dev branch  → the dev backend origin (e.g. the Railway dev URL)
 *
 * Calls are therefore cross-origin, so the target backend must allow this
 * app's origin via CORS. `admin.jobjen.com` ↔ `api.jobjen.com` (and
 * `localhost:5174` ↔ `localhost:3001`) are same-SITE, so `SameSite=Lax`
 * cookies ride along. Only a cross-SITE pair (e.g. `*.vercel.app` ↔
 * `*.up.railway.app`) needs `SameSite=None; Secure` on the backend.
 */
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001").replace(
  /\/+$/,
  ""
)

/**
 * Resolve a backend path (e.g. `/api/v1/admin/interviews/:id/video`) to an
 * absolute URL against `API_BASE_URL`.
 *
 * Use this for the handful of requests that DON'T go through the axios
 * instance below — the crypto bootstrap fetch and the media elements
 * (`<video>`, hls.js) whose URLs the browser would otherwise resolve
 * against the page origin, not the axios `baseURL`.
 */
export function apiUrl(path: string): string {
  // Already an absolute URL (e.g. a direct S3 link) — leave it alone.
  if (/^https?:\/\//i.test(path)) return path
  return `${API_BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`
}

/**
 * Request ceilings. Without one axios waits forever, and against a host that
 * BLACKHOLES packets (wrong `VITE_API_BASE_URL`, firewall DROP) rather than
 * refusing them, the boot `/admin/auth/me` never settles — so
 * `setIsInitializing(false)` never runs and the app sits on FullScreenLoader
 * with no error and no way out. A refused connection fails fast, so this only
 * bites a hanging host: exactly the case a human can't diagnose from the UI.
 *
 * Two budgets, because one can't honestly serve both shapes of request:
 *
 *  - JSON calls carry kBs and every one is on a user's critical path. 30s is
 *    far beyond the slowest legitimate one (a cold backend plus a heavy
 *    interview detail) while still failing visibly rather than hanging.
 *
 *  - Raw-byte downloads are unbounded: `/admin/candidates/export` streams up
 *    to 50k CSV rows and `/admin/interviews/:id/video/download` can be
 *    hundreds of MB. axios's `timeout` covers the WHOLE exchange including
 *    the response body, so the JSON budget would sever a healthy download on
 *    a slow link. 10 minutes is unreachable in practice but still a bound.
 */
const JSON_TIMEOUT_MS = 30_000
const BLOB_TIMEOUT_MS = 10 * 60_000

/**
 * The admin app uses cookie-auth (httpOnly access + refresh tokens).
 * `withCredentials: true` is required so the browser sends cookies on every
 * (cross-origin) request to the backend. Keep the SPA and the API on the
 * same parent domain (e.g. *.jobjen.com) so SameSite=Lax cookies work; for
 * a cross-site pair set SAME_SITE=none + SECURE=true on the backend.
 */
export const api = axios.create({
  baseURL: `${API_BASE_URL}/api/v1`,
  withCredentials: true,
  timeout: JSON_TIMEOUT_MS,
  headers: defaultHeaders
})

/**
 * URLs that must NEVER trigger the refresh-and-retry flow:
 *   - login    → 401 here means "wrong password", not "expired session".
 *   - refresh  → 401 here means the refresh token itself is invalid; recursing
 *                would loop forever.
 *   - logout   → 401 here means we were already logged out. No retry needed.
 *   - forgot-password / reset-password
 *              → anonymous endpoints reached from the login screen. There is
 *                no session behind them by definition, so a non-2xx (a 400 for
 *                a bad reset code, most often) has nothing to refresh — the
 *                round-trip would only delay the error the form wants to show.
 *
 * Crucially, `/admin/auth/me` is NOT in this list. A 401 from /me is
 * exactly the case we want to recover from: the access cookie has expired
 * but the refresh cookie is still valid. Refresh once, retry /me, the user
 * stays signed in. (Treating /me like the other auth endpoints was the
 * bug that made sessions feel like they expired after 15 minutes.)
 */
const AUTH_ENDPOINTS_NO_REFRESH = [
  "/admin/auth/login",
  "/admin/auth/refresh",
  "/admin/auth/logout",
  "/admin/auth/forgot-password",
  "/admin/auth/reset-password"
]

function shouldSkipRefresh(url: string | undefined): boolean {
  if (!url) return false
  return AUTH_ENDPOINTS_NO_REFRESH.some((ep) => url === ep || url.startsWith(`${ep}?`))
}

interface RetryConfig extends InternalAxiosRequestConfig {
  _retry?: boolean
  /**
   * Separate from `_retry` on purpose: a REFRESH_IN_FLIGHT replay must not
   * consume the refresh-and-retry budget (the replay can still 401 for a
   * genuinely expired session and deserve a real refresh), and a refresh
   * retry must not consume this one. Two flags, each capping its own path
   * at exactly one extra attempt, so the two can't ping-pong.
   */
  _retriedAfterRefreshInFlight?: boolean
}

/**
 * Single-flight refresh: if multiple requests 401 at once we only call /refresh
 * one time and replay them all once the rotation completes (or all fail if it
 * doesn't).
 */
let refreshInFlight: Promise<void> | null = null

async function refreshSession(): Promise<void> {
  if (!refreshInFlight) {
    refreshInFlight = api
      .post("/admin/auth/refresh")
      .then(() => undefined)
      .finally(() => {
        refreshInFlight = null
      })
  }
  return refreshInFlight
}

const onAuthFailureSubscribers = new Set<() => void>()

export function subscribeToAuthFailure(cb: () => void) {
  onAuthFailureSubscribers.add(cb)
  return () => {
    onAuthFailureSubscribers.delete(cb)
  }
}

function notifyAuthFailure() {
  onAuthFailureSubscribers.forEach((cb) => {
    try {
      cb()
    } catch {
      // ignore
    }
  })
}

// ---------------------------------------------------------------------------
// Encrypted-traffic layer
//
// Each outgoing request gets a fresh AES-256-GCM key, wrapped with the
// server's RSA-OAEP-256 public key. We attach the wrapped key as
// `X-Crypto-Key`, AES-encrypt the JSON body if any, and decrypt the
// response with the same key when the server signals
// `X-Crypto-Encrypted: 1`.
//
// The 401-refresh interceptor below then runs on top — by the time it
// inspects `error.response.data`, the encryption response interceptor
// has already decrypted the body, so the existing refresh-and-retry
// flow keeps working unchanged. On retry the request re-enters the
// request interceptor and gets a brand-new AES key.
// ---------------------------------------------------------------------------

interface CryptoRequestMeta {
  __crypto?: RequestCrypto
  /**
   * Snapshot of `config.data` taken BEFORE encryption so a kid-mismatch
   * retry can replay the ORIGINAL payload — without it the retry would
   * re-encrypt the already-encrypted envelope from the failed first
   * attempt and fail server-side validation, forcing the user to
   * manually refresh after every backend restart.
   */
  __originalData?: unknown
  _retriedAfterKidMismatch?: boolean
}

const SKIP_HEADER = "x-skip-crypto"

function shouldSkipEntirely(config: InternalAxiosRequestConfig): boolean {
  const skipHeader = config.headers?.[SKIP_HEADER]
  if (skipHeader === "1" || skipHeader === 1 || skipHeader === true) return true
  const url = config.url ?? ""
  if (url.includes("/crypto/public-key")) return true
  return false
}

function isBinaryBody(data: unknown): boolean {
  if (typeof FormData !== "undefined" && data instanceof FormData) return true
  if (typeof Blob !== "undefined" && data instanceof Blob) return true
  if (data instanceof ArrayBuffer) return true
  if (ArrayBuffer.isView(data as ArrayBufferView)) return true
  return false
}

api.interceptors.request.use(async (config) => {
  /**
   * DEV ONLY: name the tenant this dashboard is standing in for.
   *
   * Applied to EVERY request, not just the branding lookup, because the host is
   * what the backend reads for three different things — branding, which org's
   * password table a login checks, and the JWT-vs-host cross-check on guarded
   * routes. Attaching it to one call and not the others would give a page that
   * paints Acme's logo and then logs you into whoever `DEV_LOGIN_ORG_SLUG`
   * happens to name.
   *
   * `""` outside dev (see `devTenant`), so this is a no-op in production and
   * the request goes out exactly as it does today.
   *
   * Sent as a HEADER, not `?tenant=`: a query param lands in every `@Query()`
   * DTO, where the backend's `forbidNonWhitelisted` ValidationPipe 400s it as an
   * unknown property (e.g. `GET /admin/jobs` rejected `tenant`). A header is
   * invisible to that pipe. `X-Dev-Tenant` is in the backend CORS allow-list.
   */
  const tenant = devTenant()
  if (tenant) {
    config.headers =
      config.headers ?? ({} as InternalAxiosRequestConfig["headers"])
    config.headers["X-Dev-Tenant"] = tenant
  }

  // Lift the instance's JSON ceiling for raw-byte downloads. `responseType`
  // is the discriminator rather than a URL list because it IS the property
  // that matters — a non-JSON response is bytes of unbounded size — and a
  // future download then gets the right budget by construction. Callers only
  // set an explicit `responseType` for exactly these; note the crypto path
  // below forces it back to "json", so this can only widen a request that
  // also skips the envelope.
  if (config.responseType && config.responseType !== "json") {
    config.timeout = BLOB_TIMEOUT_MS
  }

  if (shouldSkipEntirely(config)) {
    if (config.headers) delete config.headers[SKIP_HEADER]
    return config
  }

  const meta = config as InternalAxiosRequestConfig & CryptoRequestMeta

  const reqCrypto = await makeRequestCrypto()
  // `null` when the browser withholds WebCrypto (insecure context — see
  // `makeRequestCrypto`, which has already warned). Send in the clear: with
  // no `X-Crypto-Key` the backend treats this as plain JSON, which it accepts
  // by design, and its reply then carries no `X-Crypto-Encrypted` so the
  // response interceptors pass it through untouched. Leaving `responseType`
  // alone here is deliberate — there's no envelope to force it to "json" for.
  if (!reqCrypto) return config
  meta.__crypto = reqCrypto

  config.headers = config.headers ?? ({} as InternalAxiosRequestConfig["headers"])
  config.headers["X-Crypto-Key"] = reqCrypto.wrappedKeyB64
  config.headers["X-Crypto-Kid"] = reqCrypto.kid

  const isGetLike = config.method?.toLowerCase() === "get"
  const hasBody = config.data !== undefined && config.data !== null && !isGetLike
  if (hasBody && !isBinaryBody(config.data)) {
    if (meta.__originalData === undefined) {
      meta.__originalData = config.data
    }
    const env = await encryptBody(meta.__originalData, reqCrypto.aesKey)
    config.data = env
    config.headers["Content-Type"] = "application/json"
  }

  config.responseType = "json"
  return config
})

// Decrypt successful responses + decrypt + (maybe) recover on errors.
api.interceptors.response.use(
  async (response) => {
    if (response.headers["x-crypto-encrypted"] !== "1") return response
    const reqCrypto = (response.config as CryptoRequestMeta).__crypto
    if (!reqCrypto) {
      throw new Error("Server returned an encrypted response but no AES key was available.")
    }
    const env = response.data as EncryptedEnvelope
    if (env && typeof env.iv === "string" && typeof env.ciphertext === "string") {
      response.data = await decryptBody(env, reqCrypto.aesKey)
    }
    return response
  },
  async (error: AxiosError) => {
    const response = error.response
    const config = error.config as
      | (InternalAxiosRequestConfig & CryptoRequestMeta)
      | undefined

    // Decrypt error bodies first so all downstream handlers (including
    // the 401-refresh logic below) can see the real payload.
    if (
      response?.headers?.["x-crypto-encrypted"] === "1" &&
      config?.__crypto &&
      response.data &&
      typeof (response.data as EncryptedEnvelope).iv === "string"
    ) {
      try {
        response.data = await decryptBody(
          response.data as EncryptedEnvelope,
          config.__crypto.aesKey
        )
      } catch {
        // Leave it as-is.
      }
    }

    // Key rotation: if the server tells us the kid is stale, drop the
    // cached public key and retry once with a fresh handshake. Must
    // succeed transparently — admins should never see the encryption
    // layer recover from a backend restart.
    if (response?.status === 400 && config) {
      const data = response.data as
        | { code?: string; message?: string }
        | undefined
      const code = typeof data?.code === "string" ? data.code : undefined
      const message = typeof data?.message === "string" ? data.message : undefined

      // Defense-in-depth: older deployments don't echo `code` on the
      // wire. Fall back to a message-keyword check so the experience
      // stays smooth on a mixed-version cluster.
      const messageLooksLikeKidMismatch =
        typeof message === "string" &&
        /encryption key id|public key|crypto[_-]?(kid|unwrap)/i.test(message)

      const isCryptoRotation =
        code === "CRYPTO_KID_MISMATCH" ||
        code === "CRYPTO_UNWRAP_FAILED" ||
        code === "CRYPTO_BODY_DECRYPT_FAILED" ||
        messageLooksLikeKidMismatch

      if (isCryptoRotation) {
        invalidateCryptoBootstrap()
        if (!config._retriedAfterKidMismatch) {
          config._retriedAfterKidMismatch = true
          delete config.__crypto
          // Restore the plaintext body — `config.data` currently holds
          // the encrypted envelope from the failed first attempt.
          if (config.__originalData !== undefined) {
            config.data = config.__originalData
          }
          return api(config as AxiosRequestConfig)
        }
      }
    }

    return Promise.reject(error)
  }
)

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as RetryConfig | undefined
    const status = error.response?.status

    // Racing tabs. The backend keeps a ~30s grace window while a refresh
    // rotation is in flight and answers concurrent requests with
    // REFRESH_IN_FLIGHT rather than a real "you're logged out" 401. By the
    // time we read this the winning tab has (or is about to have) set the
    // new cookie, so replay once and let the request succeed. Calling
    // notifyAuthFailure here would sign the user out of every tab for what
    // is really just a lost race.
    //
    // `error.response.data` is already decrypted: the crypto response
    // interceptor is registered before this one, so it runs first.
    if (status === 401 && original && !original._retriedAfterRefreshInFlight) {
      const code = (error.response?.data as { code?: string } | undefined)?.code
      if (code === "REFRESH_IN_FLIGHT") {
        original._retriedAfterRefreshInFlight = true
        return api(original as AxiosRequestConfig)
      }
    }

    if (
      status !== 401 ||
      !original ||
      original._retry ||
      shouldSkipRefresh(original.url)
    ) {
      return Promise.reject(error)
    }

    original._retry = true
    try {
      await refreshSession()
      return api(original as AxiosRequestConfig)
    } catch (refreshError) {
      notifyAuthFailure()
      return Promise.reject(refreshError)
    }
  }
)

export default api
