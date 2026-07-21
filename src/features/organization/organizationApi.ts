import axios from "axios"
import api from "@/lib/api"
import type {
  FaviconPresignPayload,
  FaviconPresignResult,
  LogoPresignPayload,
  LogoPresignResult,
  OrgAwsStorage,
  OrgEmailDomain,
  OrgProfile,
  ProvisionStoragePayload,
  StorageSetup,
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
 * The same, for the DARK-BACKGROUND variant. A separate route rather than a
 * flag on the one above, because the key lands under the org's `logo-dark/`
 * prefix and the backend re-checks each field against its OWN prefix on the
 * PATCH — so the two can never be crossed by a confused client.
 *
 * The bytes go up through `uploadLogoToPresignedUrl` unchanged: it takes a URL
 * and a file and knows nothing about which variant it is carrying.
 */
/**
 * Force the worker to re-derive the dark variant from the main logo.
 *
 * Normally unnecessary — saving a logo derives its counterpart on its own —
 * so this is the retry for a derivation that failed, and the way to re-run one
 * after the transform itself changes. Resolves with the profile already showing
 * `logoVariant.status: "processing"`.
 */
export async function regenerateLogoVariant() {
  const { data } = await api.post<OrgProfile>(
    "/admin/organization/logo-dark/generate"
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

// ---------------------------------------------------------------------
// Favicon upload — mirrors the logo pair exactly, different endpoint + prefix
// ---------------------------------------------------------------------

/**
 * Step 1: mint a presigned PUT for a new org favicon. `org_admin` only. Like
 * the logo, the returned `key` is inert until a PATCH stores it as
 * `faviconKey`; an abandoned upload just orphans an object under this org's
 * favicon prefix.
 */
export async function presignFavicon(payload: FaviconPresignPayload) {
  const { data } = await api.post<FaviconPresignResult>(
    "/admin/organization/favicon/presign",
    payload
  )
  return data
}

/**
 * Step 2: direct browser PUT to S3. Byte-for-byte the same contract as
 * `uploadLogoToPresignedUrl` (fresh axios, no crypto/cookie interceptors,
 * explicit AES256, `Content-Type` matching the signed value); kept as its own
 * function so the favicon path reads end to end without a shared "asset"
 * abstraction that would hide which prefix is being written.
 */
export async function uploadFaviconToPresignedUrl(
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

/**
 * The org's storage-setup details the "connect your AWS" guide fills its policy
 * JSON with, including the org's STABLE bootstrap ExternalId (server-owned,
 * minted on first read). Per-org, so it is keyed by the org in the cache.
 */
export async function getStorageSetup(): Promise<StorageSetup> {
  const { data } = await api.get<StorageSetup>(
    "/admin/organization/storage/setup"
  )
  return data
}

/**
 * Connect the org's own AWS account: provision its S3 bucket + access role from
 * the bootstrap role the admin created, then verify. Returns the lifecycle
 * ({state, bucket, region, error}); `active` means storage is live.
 */
export async function provisionStorage(
  payload: ProvisionStoragePayload
): Promise<OrgAwsStorage> {
  const { data } = await api.post<OrgAwsStorage>(
    "/admin/organization/storage/provision",
    payload
  )
  return data
}
