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
  /**
   * READ-ONLY, and not what you send back to change the logo — see
   * `UpdateOrganizationPayload.logoKey`.
   *
   * A permanent public URL the backend resolves from the org's stored S3
   * key, safe to drop straight into an `<img src>`. Empty when the org
   * hasn't uploaded one — the shell falls back to `<BrandLogo>`.
   */
  logoUrl: string
  name: string
  slug: string
  status: "active" | "inactive"
  industry: string
  seats: number
  settings: OrganizationSettings
  createdAt: string
  updatedAt: string
}

/**
 * Everything an `org_admin` may change; `hr` gets the same form read-only.
 *
 * Note the asymmetry with `OrgProfile`: you READ `logoUrl` but WRITE
 * `logoKey`. The key is the one handed back by `presignLogo()` after the
 * file is in S3 — the backend re-checks it against this org's own prefix and
 * rejects anything else. `""` removes the logo.
 */
export interface UpdateOrganizationPayload {
  name?: string
  logoKey?: string
  settings?: Partial<OrganizationSettings>
}

/** Body of `POST /admin/organization/logo/presign`. */
export interface LogoPresignPayload {
  contentType: string
  sizeBytes: number
  fileName: string
}

/**
 * Its response. `uploadUrl` is a short-lived S3 PUT — send the bytes with
 * the SAME `Content-Type` that was presigned or S3 rejects the request.
 * `key` is what goes back on the profile PATCH as `logoKey`.
 */
export interface LogoPresignResult {
  fileName: string
  uploadUrl: string
  key: string
  contentType: string
  expiresIn: number
}
