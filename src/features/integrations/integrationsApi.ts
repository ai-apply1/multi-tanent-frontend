import api from "@/lib/api"

/**
 * Third-party platform connections (LinkedIn today; more to come). Per-user:
 * each dashboard user connects their OWN account, so nothing here is org-scoped
 * and the JWT identifies the user — no ids are sent.
 */

export interface LinkedInStatus {
  /** A token exists on the user (or the backend is in dry-run mode). */
  connected: boolean
  /** Connected AND within the TTL window — the only state that can post. */
  active: boolean
  /** Connected but past the TTL window — the user must reconnect. */
  expired: boolean
  /** True when the backend has no LinkedIn app configured (flow is simulated). */
  dryRun: boolean
  name: string | null
  connectedAt: string | null
  /** When the connection lapses (connectedAt + 30 days by default). */
  expiresAt: string | null
}

/** Is the current user's LinkedIn account connected + active? */
export async function getLinkedInStatus() {
  const { data } = await api.get<LinkedInStatus>("/admin/linkedin/status")
  return data
}

/**
 * Start the OAuth connect flow. `returnUrl` is the absolute SPA page to land
 * back on; the backend bakes it into a signed state and 302s there with
 * `?linkedin=connected|error` after the callback.
 */
export async function startLinkedInConnect(returnUrl: string) {
  const { data } = await api.get<{ url: string; configured: boolean }>(
    "/admin/linkedin/connect",
    { params: { returnUrl } }
  )
  return data
}

/** Disconnect the current user's LinkedIn account (clears the token). */
export async function disconnectLinkedIn() {
  const { data } = await api.delete<{ disconnected: boolean }>(
    "/admin/linkedin"
  )
  return data
}
