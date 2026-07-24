/** Wire values, not display labels — `org_admin` unlocks Team + the org-settings write path. */
export type UserRole = "org_admin" | "hr"

/**
 * The signed-in user. Login, refresh AND `/admin/auth/me` all return this
 * exact shape, so there is only ever one user type on the client — `/me`
 * used to return the bare JWT claims (no display name), which meant a page
 * refresh silently downgraded the session to an anonymous-looking one.
 */
export interface SessionUser {
  id: string
  organizationId: string
  fullName: string
  userName: string
  email: string
  role: UserRole
  lastLoginAt: string | null
}

/**
 * `POST /admin/auth/login` (and `/login/mfa`).
 *
 * Two outcomes share this shape: a normal login carries `user`; a login for an
 * MFA-enrolled account carries `mfaRequired: true` + a short-lived
 * `challengeToken` and NO session (the second factor is collected at
 * `/login/mfa`, which then returns `user`).
 */
export interface LoginResponse {
  success: boolean
  user?: SessionUser
  mfaRequired?: boolean
  challengeToken?: string
}

/**
 * Present ONLY when a platform super-admin is acting AS this user
 * (impersonation). `superAdminEmail` is who to attribute actions to, shown in
 * the impersonation banner. Absent on a normal HR session.
 */
export interface Impersonation {
  superAdminEmail: string
}

export interface MeResponse {
  success: boolean
  user: SessionUser
  impersonation?: Impersonation
}
