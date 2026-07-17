import axios from "axios"
import api from "@/lib/api"
import type {
  LogoPresignPayload,
  LogoPresignResult,
  OrgEmailDomain,
  OrgProfile,
  UpdateOrganizationPayload
} from "@/features/organization/types"

/** The caller's own org — resolved from the JWT, never addressed by id. */
export async function getOrganization() {
  const { data } = await api.get<OrgProfile>("/admin/organization")
  return data
}

/** `org_admin` only; the backend 403s an `hr` caller. Returns the updated profile. */
export async function updateOrganization(payload: UpdateOrganizationPayload) {
  const { data } = await api.patch<OrgProfile>("/admin/organization", payload)
  return data
}

// ---------------------------------------------------------------------
// Logo upload (presign → direct S3 PUT → PATCH the key back)
// ---------------------------------------------------------------------

/**
 * Step 1: mint a presigned PUT so the browser uploads straight to S3 (the
 * API never buffers the image). `org_admin` only. The returned `key` means
 * nothing until step 3 stores it — an abandoned upload just orphans an
 * object under this org's logo prefix.
 */
export async function presignLogo(payload: LogoPresignPayload) {
  const { data } = await api.post<LogoPresignResult>(
    "/admin/organization/logo/presign",
    payload
  )
  return data
}

/**
 * Step 2: direct browser PUT to S3.
 *
 * A FRESH axios instance, not `@/lib/api`: the global crypto + cookie
 * interceptors would attach headers S3 didn't sign for, and S3 rejects the
 * PUT with a 403 that reads exactly like an auth bug.
 * `withCredentials: false` for the same reason.
 * `x-amz-server-side-encryption: AES256` is sent explicitly to satisfy the
 * bucket's `DenyUnencryptedObjectUploads` policy.
 * `Content-Type` MUST equal the value the URL was signed for or the
 * signature won't match.
 *
 * Same contract as `candidatesApi.uploadCvToPresignedUrl` — keep them in step.
 */
export async function uploadLogoToPresignedUrl(
  uploadUrl: string,
  file: File,
  contentType: string,
  onProgress?: (pct: number) => void
) {
  await axios.put(uploadUrl, file, {
    headers: {
      "Content-Type": contentType,
      "x-amz-server-side-encryption": "AES256"
    },
    withCredentials: false,
    onUploadProgress: (event) => {
      if (event.total && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100))
      }
    }
  })
}

/**
 * Ask Resend to re-check the org's sending domain now — the "I've added the
 * records" button.
 *
 * An accelerator, not the mechanism: Resend verifies asynchronously and also
 * pushes webhooks, so a domain reaches `verified` on its own once the records
 * resolve. This just saves the admin from refreshing and hoping.
 */
export async function verifyEmailDomain() {
  const { data } = await api.post<OrgEmailDomain>(
    "/admin/organization/email-domain/verify"
  )
  return data
}
