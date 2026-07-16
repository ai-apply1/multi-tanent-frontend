/**
 * The signed-in user's own organization, read from `/admin/organization`.
 * The org is resolved server-side from the JWT — there is deliberately no
 * org id anywhere in the request, and no org selector in this app.
 */

/** Org-wide defaults a job may override per-job (`maxAttempts`). */
export interface OrganizationSettings {
  maxInterviewAttempts: number
  interviewExpiryDays: number
  /** IANA zone (`@IsTimeZone` on the backend), e.g. "Asia/Karachi". */
  timezone: string
}

/**
 * `slug`, `status`, `seats` and `industry` are super-admin owned: they come
 * back on the profile but the org-settings PATCH ignores them.
 */
export interface OrgProfile {
  _id: string
  name: string
  slug: string
  /** Empty when the org hasn't uploaded one — the shell falls back to `<BrandLogo>`. */
  logoUrl: string
  status: "active" | "inactive"
  industry: string
  seats: number
  settings: OrganizationSettings
  createdAt: string
  updatedAt: string
}

/** Everything an `org_admin` may change; `hr` gets the same form read-only. */
export interface UpdateOrganizationPayload {
  name?: string
  logoUrl?: string
  settings?: Partial<OrganizationSettings>
}
