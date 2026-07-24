import api from "@/lib/api"

/**
 * Self-service MFA (TOTP) for the signed-in HR user (`/admin/auth/mfa/*`). All
 * cookie-authed through the shared `api` instance, so requests are transparently
 * encrypted and session-bound. Blocked while impersonating (the backend guards
 * the mutating routes with NoImpersonationGuard).
 */

export interface MfaStatus {
  enabled: boolean
  enrolledAt: string | null
  recoveryCodesRemaining: number
}

export interface MfaSetup {
  /** Base32 secret for manual entry into the authenticator app. */
  secretBase32: string
  /** `otpauth://` provisioning URI encoded by the QR. */
  otpauthUri: string
  /** PNG data URL of the QR to scan. */
  qrDataUrl: string
}

export async function fetchMfaStatus(): Promise<MfaStatus> {
  const { data } = await api.get<{ success: boolean } & MfaStatus>(
    "/admin/auth/mfa/status"
  )
  return {
    enabled: data.enabled,
    enrolledAt: data.enrolledAt,
    recoveryCodesRemaining: data.recoveryCodesRemaining
  }
}

/** Begin enrolment: mints a pending secret and returns the QR + manual key. */
export async function setupMfa(): Promise<MfaSetup> {
  const { data } = await api.post<{ success: boolean } & MfaSetup>(
    "/admin/auth/mfa/setup"
  )
  return {
    secretBase32: data.secretBase32,
    otpauthUri: data.otpauthUri,
    qrDataUrl: data.qrDataUrl
  }
}

/** Confirm enrolment with a code; returns the one-time recovery codes. */
export async function enableMfa(code: string): Promise<string[]> {
  const { data } = await api.post<{ success: boolean; recoveryCodes: string[] }>(
    "/admin/auth/mfa/enable",
    { code }
  )
  return data.recoveryCodes
}

/** Turn MFA off. Requires a current authenticator or recovery code. */
export async function disableMfa(code: string): Promise<void> {
  await api.post("/admin/auth/mfa/disable", { code })
}

/** Replace the recovery codes; returns the new set. Requires a current code. */
export async function regenerateRecoveryCodes(code: string): Promise<string[]> {
  const { data } = await api.post<{ success: boolean; recoveryCodes: string[] }>(
    "/admin/auth/mfa/recovery-codes",
    { code }
  )
  return data.recoveryCodes
}
