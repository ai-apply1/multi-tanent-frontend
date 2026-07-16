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

export interface LoginResponse {
  success: boolean
  user: SessionUser
}

export interface MeResponse {
  success: boolean
  user: SessionUser
}
