import axios from "axios"
import api from "@/lib/api"
import type { OrgDemoVideo } from "@/features/organization/types"

/**
 * The apply intro video upload/transcode lifecycle: init → S3 PUT → complete →
 * poll status, plus retry and remove. The status shape is `OrgDemoVideo` (the
 * same block returned on the org profile), so the settings card can poll this
 * one lightweight endpoint while a transcode runs instead of refetching the
 * whole profile.
 */

export interface DemoVideoUploadInit {
  mediaId: string
  uploadUrl: string
  key: string
  contentType: string
  expiresIn: number
}

export async function getDemoVideoStatus() {
  const { data } = await api.get<OrgDemoVideo>("/admin/organization/demo-video")
  return data
}

/**
 * Step 1: reserve a generation + mint a presigned PUT. `org_admin` only.
 * Content-type and size are validated here server-side, so a rejected file
 * never gets an upload URL.
 */
export async function initDemoVideoUpload(payload: {
  contentType: string
  fileName: string
  sizeBytes: number
}) {
  const { data } = await api.post<DemoVideoUploadInit>(
    "/admin/organization/demo-video/upload-init",
    payload
  )
  return data
}

/**
 * Step 2: direct browser PUT to S3. A FRESH axios (not `@/lib/api`): the global
 * crypto + cookie interceptors would attach headers S3 didn't sign for and it
 * would 403. Same contract as the logo/CV uploads — explicit AES256,
 * `Content-Type` matching the signed value, `withCredentials: false`.
 */
export async function uploadDemoVideoToPresignedUrl(
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
 * Step 3: confirm the PUT landed and start the transcode. The server HEADs the
 * object and re-validates the echoed `key` against the org+generation prefix.
 * Returns the (now `processing`) status.
 */
export async function completeDemoVideoUpload(payload: {
  mediaId: string
  key: string
}) {
  const { data } = await api.post<OrgDemoVideo>(
    "/admin/organization/demo-video/upload-complete",
    payload
  )
  return data
}

/** Re-run a failed transcode against the kept source — no re-upload needed. */
export async function retryDemoVideoTranscode() {
  const { data } = await api.post<OrgDemoVideo>(
    "/admin/organization/demo-video/retry"
  )
  return data
}

/** Remove the video: reset to `draft` (funnel skips the step) + delete S3 objects. */
export async function removeDemoVideo() {
  const { data } = await api.delete<OrgDemoVideo>(
    "/admin/organization/demo-video"
  )
  return data
}
