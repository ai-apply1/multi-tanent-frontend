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
 */

import { BASIC_AUTH_HEADER } from "@/lib/basicAuth"

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

let bootstrapPromise: Promise<PublicKeyBundle> | null = null
let cached: PublicKeyBundle | null = null

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

async function importPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", jwk, RSA_OAEP_PARAMS, false, ["encrypt"])
}

async function fetchPublicKey(): Promise<PublicKeyBundle> {
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
  // `@/lib/api` does. We inline the one-liner instead of importing
  // `apiUrl` from there because `@/lib/api` imports THIS module, and a
  // back-import would create a load-time cycle.
  const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001").replace(
    /\/+$/,
    ""
  )

  const res = await fetch(`${apiBaseUrl}/api/v1/crypto/public-key`, {
    credentials: "include",
    cache: "no-store",
    headers
  })
  if (!res.ok) {
    throw new Error(`Failed to bootstrap crypto key (HTTP ${res.status})`)
  }
  const json = (await res.json()) as { kid: string; jwk: JsonWebKey }
  if (!json?.kid || !json?.jwk) {
    throw new Error("Crypto bootstrap returned an invalid payload.")
  }
  const key = await importPublicKey(json.jwk)
  return { kid: json.kid, jwk: json.jwk, key }
}

/**
 * Idempotent. Concurrent callers share a single in-flight bootstrap so
 * we never hit /crypto/public-key more than once at a time.
 */
export async function ensureCryptoReady(): Promise<PublicKeyBundle> {
  if (cached) return cached
  if (!bootstrapPromise) {
    bootstrapPromise = fetchPublicKey()
      .then((b) => {
        cached = b
        return b
      })
      .finally(() => {
        bootstrapPromise = null
      })
  }
  return bootstrapPromise
}

/**
 * Drops the cached public key so the next request re-bootstraps.
 * Also clears any in-flight bootstrap promise — that promise might
 * have been kicked off BEFORE the server rotated keys, in which case
 * its eventual result is also stale and we want a fresh fetch.
 */
export function invalidateCryptoBootstrap() {
  cached = null
  bootstrapPromise = null
}

export async function makeRequestCrypto(): Promise<RequestCrypto> {
  const bundle = await ensureCryptoReady()

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
