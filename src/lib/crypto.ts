/**
 * Browser-side half of the encrypted-traffic layer for the admin app.
 *
 * Mirrors `jobjen-ai-interview-frontend/src/lib/crypto.ts`. The two
 * deliberately stay in sync (no shared package in this monorepo) — if
 * you change the wire format here, change it there too. The only
 * difference is the bootstrap URL, which this app resolves against
 * `VITE_API_BASE_URL` (there is no Vite dev proxy — see `@/lib/api`).
 *
 *  - Bootstraps the server's RSA-OAEP-256 public key once on app start
 *    via `GET /api/v1/crypto/public-key` and re-bootstraps automatically
 *    whenever the server says the key has rotated.
 *  - For every encrypted request we generate a fresh AES-256-GCM key,
 *    wrap it with the server's public key (`X-Crypto-Key` header), and
 *    AES-encrypt the JSON body if any.
 *  - For every encrypted response we look at `X-Crypto-Encrypted: 1`
 *    and decrypt the `{ iv, ciphertext }` envelope with the SAME AES
 *    key we used outbound on this request.
 *  - Degrades to plaintext, loudly and once, when the browser withholds
 *    `crypto.subtle` because the page isn't a secure context — see
 *    `warnEnvelopeDisabled` below.
 */

import { BASIC_AUTH_HEADER } from "@/lib/basicAuth"
import { API_PREFIX } from "@/lib/apiPrefix"

export interface EncryptedEnvelope {
  iv: string
  ciphertext: string
}

interface PublicKeyBundle {
  kid: string
  jwk: JsonWebKey
  /** Imported CryptoKey (RSA-OAEP-256). */
  key: CryptoKey
}

export interface RequestCrypto {
  aesKey: CryptoKey
  wrappedKeyB64: string
  kid: string
}

const RSA_OAEP_PARAMS: RsaHashedImportParams = {
  name: "RSA-OAEP",
  hash: "SHA-256"
}

/**
 * Ceiling for the bootstrap fetch below. Mirrors `JSON_TIMEOUT_MS` in
 * `@/lib/api` rather than importing it — that module imports THIS one, and a
 * back-import would create a load-time cycle (same reason `fetchPublicKey`
 * re-derives the API base URL instead of importing `apiUrl`).
 */
const BOOTSTRAP_TIMEOUT_MS = 30_000

let bootstrapPromise: Promise<PublicKeyBundle> | null = null
let cached: PublicKeyBundle | null = null
/**
 * Generation counter for the cached bundle. Every bootstrap captures the
 * value it started under and refuses to publish its result if it no longer
 * matches — see `invalidateCryptoBootstrap`.
 */
let bootstrapEpoch = 0

const toB64 = (bytes: ArrayBuffer | ArrayBufferView): string => {
  const view =
    bytes instanceof ArrayBuffer
      ? new Uint8Array(bytes)
      : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let bin = ""
  const CHUNK = 0x8000
  for (let i = 0; i < view.length; i += CHUNK) {
    bin += String.fromCharCode(...view.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

// Return `Uint8Array<ArrayBuffer>` (not the broader `ArrayBufferLike`)
// so the resulting view satisfies `BufferSource` when handed to
// `crypto.subtle.{encrypt,decrypt}`. TS 5.5+ tightened these signatures
// to exclude `SharedArrayBuffer`-backed views.
const fromB64 = (s: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * WebCrypto lives behind `crypto.subtle`, which browsers expose ONLY in a
 * secure context: https, or the localhost family. Serve the dev build over
 * the LAN so a phone can reach it (`vite --host` → `http://192.168.x.x:5174`)
 * and `crypto.subtle` is `undefined` — every helper in this file would throw,
 * and because they run inside the axios REQUEST interceptor that means every
 * API call dies before it is sent, with the app stuck on /login.
 */
function hasWebCrypto(): boolean {
  return Boolean(globalThis.crypto?.subtle)
}

let envelopeDisabledWarned = false

/**
 * Say the quiet part out loud, exactly once. Without this the failure has no
 * diagnostic surface at all: the app just never authenticates.
 *
 * Plaintext is a legitimate wire state, not a hack — the backend's
 * `CryptoInterceptor` passes any request that arrives without an
 * `X-Crypto-Key` header straight through, so the envelope is opt-in per
 * request. Skipping it costs confidentiality-in-depth on the LAN, which beats
 * an app that cannot make a single call.
 */
function warnEnvelopeDisabled(): void {
  if (envelopeDisabledWarned) return
  envelopeDisabledWarned = true
  console.warn(
    "[crypto] Request encryption DISABLED — API traffic is going out as PLAINTEXT.\n" +
      `  Why:   isSecureContext === ${isSecureContext}, so this browser does not expose ` +
      "WebCrypto (crypto.subtle) and the encrypted envelope cannot be built.\n" +
      `  Cause: the page is served from ${location.origin}. Only https:// and the ` +
      "localhost family are secure contexts — testing over the LAN (`vite --host`, " +
      "a phone on http://192.168.x.x) lands here.\n" +
      "  Fix:   open the app on http://localhost, or serve it over https.\n" +
      "  Note:  the backend accepts plaintext (the envelope is opt-in per request), " +
      "so the app keeps working — it is just not encrypted."
  )
}

async function importPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", jwk, RSA_OAEP_PARAMS, false, ["encrypt"])
}

const BOOTSTRAP_RETRY_DELAYS_MS = [400, 1200]

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

async function attemptPublicKeyFetch(): Promise<PublicKeyBundle> {
  // Native fetch — we can't use the axios instance because that's where
  // this very layer is plugged into. The endpoint is marked
  // `@SkipCrypto()` on the server.
  //
  // `cache: "no-store"` is critical: after a `CRYPTO_KID_MISMATCH` we
  // re-bootstrap to pick up the server's NEW kid. If we let the
  // browser serve a cached response we'd silently rebuild with the
  // SAME old kid and the retry would loop on the same error.
  //
  // We also have to send the perimeter Basic Auth header here — by
  // design the backend gates `/crypto/public-key` behind the same
  // middleware as the rest of the API, so without it the SPA can't
  // even bootstrap.
  const headers: Record<string, string> = {}
  if (BASIC_AUTH_HEADER) headers["Authorization"] = BASIC_AUTH_HEADER

  // Resolve the bootstrap URL against VITE_API_BASE_URL the same way
  // `@/lib/api` does. We inline the base-URL one-liner instead of importing
  // `apiUrl` from there because `@/lib/api` imports THIS module, and a
  // back-import would create a load-time cycle. `API_PREFIX` is safe to import
  // because it lives in its own zero-import module (no cycle).
  const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001").replace(
    /\/+$/,
    ""
  )

  let res: Response
  try {
    res = await fetch(`${apiBaseUrl}${API_PREFIX}/crypto/public-key`, {
      credentials: "include",
      cache: "no-store",
      headers,
      // Native fetch has NO timeout of its own. Against a host that blackholes
      // packets rather than refusing them (wrong IP, firewall DROP) this never
      // settles — and since every encrypted request awaits this bootstrap, the
      // boot `/admin/auth/me` never settles either and the app sits on
      // FullScreenLoader forever with nothing in the console. Same budget as
      // the axios instance's JSON timeout; this is a tiny JSON GET.
      signal: AbortSignal.timeout(BOOTSTRAP_TIMEOUT_MS)
    })
  } catch (err) {
    // Network failure, DNS, an aborted (timed-out) connection, or a CORS
    // rejection — the browser withholds which. Retryable: a transient blip is
    // the commonest member of that set.
    throw Object.assign(
      new Error(
        `Could not reach the crypto bootstrap: ${
          err instanceof Error ? err.message : "network error"
        }`
      ),
      { retryable: true }
    )
  }
  if (!res.ok) {
    throw Object.assign(
      new Error(`Failed to bootstrap crypto key (HTTP ${res.status})`),
      { retryable: res.status >= 500 || res.status === 429 }
    )
  }
  const json = (await res.json()) as { kid: string; jwk: JsonWebKey }
  if (!json?.kid || !json?.jwk) {
    throw new Error("Crypto bootstrap returned an invalid payload.")
  }
  const key = await importPublicKey(json.jwk)
  return { kid: json.kid, jwk: json.jwk, key }
}

/**
 * The bootstrap, with a short retry on transient failure (5xx/429, a network
 * blip, or the timeout). A 4xx is a verdict, not a blip — a wrong perimeter
 * credential — so it is NOT retried and fails fast. Every encrypted request
 * awaits this, so one dropped packet or a routine backend redeploy would
 * otherwise take the app down for that admin.
 */
async function fetchPublicKey(): Promise<PublicKeyBundle> {
  let lastError: unknown
  for (let attempt = 0; ; attempt++) {
    try {
      return await attemptPublicKeyFetch()
    } catch (err) {
      lastError = err
      const retryable = Boolean((err as { retryable?: boolean })?.retryable)
      const delay = BOOTSTRAP_RETRY_DELAYS_MS[attempt]
      if (!retryable || delay === undefined) break
      await sleep(delay)
    }
  }
  throw lastError
}

/**
 * Idempotent. Concurrent callers share a single in-flight bootstrap so
 * we never hit /crypto/public-key more than once at a time.
 *
 * `null` means the browser has no WebCrypto and the envelope is off for this
 * page — see `hasWebCrypto`. The check lives HERE, not only in
 * `makeRequestCrypto`, because `main.tsx` also calls this directly to warm the
 * key up at boot: without it that call burns a pointless round-trip and then
 * dies inside `importPublicKey`, whose "bootstrap failed: TypeError … reading
 * 'importKey'" reads like a network fault and buries the real cause.
 */
export async function ensureCryptoReady(): Promise<PublicKeyBundle | null> {
  if (!hasWebCrypto()) {
    warnEnvelopeDisabled()
    return null
  }
  if (cached) return cached
  if (!bootstrapPromise) {
    // Pin the generation this fetch belongs to. An invalidate that lands
    // while it's in flight bumps the counter, which is what stops the stale
    // bundle below from being published.
    const epoch = bootstrapEpoch
    const promise: Promise<PublicKeyBundle> = fetchPublicKey()
      .then((b) => {
        if (epoch === bootstrapEpoch) cached = b
        return b
      })
      .finally(() => {
        // Only vacate the slot if it still holds THIS promise. An invalidate
        // mid-flight already nulled it and a later caller may have installed
        // a fresh bootstrap — clearing that one would send the next caller
        // off to fetch a third key of its own.
        if (bootstrapPromise === promise) bootstrapPromise = null
      })
    bootstrapPromise = promise
  }
  return bootstrapPromise
}

/**
 * Drops the cached public key so the next request re-bootstraps.
 * Also clears any in-flight bootstrap promise — that promise might
 * have been kicked off BEFORE the server rotated keys, in which case
 * its eventual result is also stale and we want a fresh fetch.
 *
 * Nulling `bootstrapPromise` alone does NOT achieve that: the in-flight
 * chain's own `.then` would still land and repopulate `cached` with the
 * pre-rotation bundle, so the retry would sign against the dead kid and
 * fail all over again. Bumping the epoch is what actually disowns it.
 */
export function invalidateCryptoBootstrap() {
  cached = null
  bootstrapPromise = null
  bootstrapEpoch += 1
}

/**
 * The per-request handshake. Returns `null` when there is no WebCrypto to do
 * it with, which tells the axios request interceptor to send this request in
 * the clear (`ensureCryptoReady` has already warned).
 */
export async function makeRequestCrypto(): Promise<RequestCrypto | null> {
  const bundle = await ensureCryptoReady()
  if (!bundle) return null

  const aesKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  )
  const rawKey = await crypto.subtle.exportKey("raw", aesKey)
  const wrapped = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, bundle.key, rawKey)

  return {
    aesKey,
    wrappedKeyB64: toB64(wrapped),
    kid: bundle.kid
  }
}

export async function encryptBody(
  payload: unknown,
  aesKey: CryptoKey
): Promise<EncryptedEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(JSON.stringify(payload ?? null))
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, plaintext)
  return { iv: toB64(iv), ciphertext: toB64(ct) }
}

export async function decryptBody<T = unknown>(
  env: EncryptedEnvelope,
  aesKey: CryptoKey
): Promise<T> {
  const iv = fromB64(env.iv)
  const ct = fromB64(env.ciphertext)
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, ct)
  const text = new TextDecoder().decode(plain)
  return text.length > 0 ? (JSON.parse(text) as T) : (undefined as unknown as T)
}
