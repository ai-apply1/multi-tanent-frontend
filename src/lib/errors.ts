/**
 * The one place that reads a backend error body.
 *
 * The API returns TWO different envelopes depending on the server's
 * NODE_ENV, and both may arrive at the same client (a dev build pointed
 * at prod, a prod build pointed at the dev backend):
 *
 *   development : { timestamp, message: string | string[], status, data: { path, method }, code? }
 *   otherwise   : { statusCode, message: string | string[], code? }
 *
 * `message` is a `string[]` whenever class-validator rejects a DTO — one
 * entry per failed constraint. Reading `.message` blind renders
 * "[object Object]"-grade noise, which is why every caller must come
 * through here instead of hand-rolling the check.
 *
 * Both helpers run AFTER the crypto response interceptor in `@/lib/api`,
 * so `err.response.data` is already the decrypted plaintext body.
 */

import axios from "axios"

/** The union of both env shapes; every field optional because we can't trust either. */
interface ApiErrorBody {
  message?: string | string[]
  code?: string
}

function errorBody(err: unknown): ApiErrorBody | null {
  if (!axios.isAxiosError(err)) return null
  const data = err.response?.data
  if (!data || typeof data !== "object") return null
  return data as ApiErrorBody
}

/**
 * Human-readable message for a toast or an inline error.
 *
 * Order: the backend's own message (array joined so no constraint is
 * silently dropped) → the JS error's message (network failures, thrown
 * `Error`s from non-axios code) → `fallback`.
 */
export function errorMessage(err: unknown, fallback: string): string {
  const message = errorBody(err)?.message
  if (Array.isArray(message)) {
    const joined = message.filter((m) => typeof m === "string" && m).join("; ")
    if (joined) return joined
  } else if (typeof message === "string" && message) {
    return message
  }
  if (err instanceof Error && err.message) return err.message
  return fallback
}

/**
 * Machine-readable code (`MAX_ATTEMPTS`, `INVALID_STATUS`, `ORG_SUSPENDED`, …)
 * for the paths where the UI branches on the reason rather than just
 * showing the message. `null` when the error carries no code — including
 * every non-axios error.
 */
export function errorCode(err: unknown): string | null {
  const code = errorBody(err)?.code
  return typeof code === "string" && code ? code : null
}
