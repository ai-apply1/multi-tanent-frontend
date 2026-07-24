import api from "@/lib/api"
import type {
  LoginResponse,
  MeResponse,
  SessionUser
} from "@/features/auth/types"

/**
 * The two-outcome result of the password step: a full session, or "password
 * OK, now complete MFA" carrying the short-lived challenge token to replay to
 * `loginMfaRequest`.
 */
export type LoginOutcome =
  | { status: "ok"; user: SessionUser }
  | { status: "mfa_required"; challengeToken: string }

/**
 * `identifier` is an email or a userName — the backend resolves which.
 *
 * It does NOT resolve WHO on its own, and that's worth knowing before you
 * debug a 401 here: HR identifiers are unique per-org, not globally, so the
 * backend first works out which org this request belongs to FROM THE PAGE'S
 * OWN HOSTNAME (`admin.acme.com` → Acme, via the Origin header the browser
 * sets) and only then looks the user up inside it. There is no org field in
 * this body and there must not be one — the domain is the selector.
 *
 * So a correct email + correct password still 401s ("Invalid credentials",
 * deliberately indistinguishable) when the page is served from a host the
 * backend doesn't recognise: any org whose custom domain isn't live yet, a
 * Vercel preview URL, or localhost. For localhost the backend has a dev-only
 * fallback — it needs `DEV_LOGIN_ORG_SLUG=<an org slug>` AND
 * `NODE_ENV=development` in the API's `.env`, and it is impossible in prod.
 */
export async function loginRequest(
  identifier: string,
  password: string
): Promise<LoginOutcome> {
  const { data } = await api.post<LoginResponse>("/admin/auth/login", {
    identifier,
    password
  })
  if (data.mfaRequired && data.challengeToken) {
    return { status: "mfa_required", challengeToken: data.challengeToken }
  }
  return { status: "ok", user: data.user as SessionUser }
}

/**
 * Second login step: exchange the challenge token + a code (authenticator or
 * recovery) for the session. A 401 here means "wrong code", not "expired
 * session", so this path is excluded from the axios refresh-retry.
 */
export async function loginMfaRequest(
  challengeToken: string,
  code: string
): Promise<SessionUser> {
  const { data } = await api.post<LoginResponse>("/admin/auth/login/mfa", {
    challengeToken,
    code
  })
  return data.user as SessionUser
}

export async function meRequest() {
  const { data } = await api.get<MeResponse>("/admin/auth/me")
  // `impersonation` is present only when a super-admin is acting as this user.
  return { user: data.user, impersonation: data.impersonation ?? null }
}

export async function logoutRequest() {
  await api.post("/admin/auth/logout")
}

/**
 * End the current impersonation session: the backend revokes it and clears its
 * cookies. Only valid on an impersonation session (a normal HR session 400s).
 * After this the caller is signed out, the operator returns to the super-admin
 * console (the tab it opened from).
 */
export async function exitImpersonationRequest() {
  await api.post("/admin/auth/impersonation/exit")
}

/**
 * Request a one-time password-reset code by email.
 *
 * This ALWAYS resolves on a 2xx, for every email — known, unknown, or belonging
 * to another org. That is deliberate on the backend (`forgotPassword` returns
 * early and still 200s), so the endpoint can't be used to enumerate who has an
 * account. Do NOT "improve" this into reporting whether the email was found:
 * the server does not tell us, and it must not.
 *
 * Org selection is the page's own hostname, exactly as in `loginRequest` above —
 * so on localhost this silently issues nothing unless the API has
 * `DEV_LOGIN_ORG_SLUG` set. There is no org field in this body.
 *
 * The emailed code is 6 characters, single-use, valid 30 minutes. Calling this
 * again invalidates any previous unconsumed code.
 */
export async function forgotPasswordRequest(email: string) {
  await api.post("/admin/auth/forgot-password", { email })
}

/**
 * Redeem the emailed code and set a new password.
 *
 * Every failure mode — wrong code, expired code, already-consumed code, unknown
 * email, unresolved org — comes back as one opaque 400 ("Invalid or expired
 * reset code."). The UI cannot and should not distinguish them.
 *
 * On success the backend revokes EVERY session for this user, so the caller is
 * signed out everywhere and must log in again with the new password.
 */
export async function resetPasswordRequest(
  email: string,
  code: string,
  newPassword: string
) {
  await api.post("/admin/auth/reset-password", { email, code, newPassword })
}

/**
 * Change the signed-in user's own password. Proves ownership with the CURRENT
 * password (no email/code), so it only works while authenticated.
 *
 * A wrong current password comes back as a 401 with a specific message
 * ("Your current password is incorrect."), and reusing the old password is a
 * 400 — surface both to the user. On success the backend signs out this user's
 * OTHER sessions but refreshes THIS device's cookies, so the caller stays
 * logged in and does not need to re-authenticate.
 */
export async function changePasswordRequest(
  currentPassword: string,
  newPassword: string
) {
  await api.post("/admin/auth/change-password", {
    currentPassword,
    newPassword
  })
}
