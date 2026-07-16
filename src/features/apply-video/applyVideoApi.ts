import axios from "axios"
import api from "@/lib/api"
import type {
  ApplyVideoPresignedPutResponse,
  ApplyVideoStatusResponse
} from "@/features/apply-video/types"

/**
 * Status / lifecycle endpoints — admin-side, JWT-cookie auth, hitting
 * the same backend the training pages already use. Layout mirrors
 * `trainingApi.ts` (init → S3 PUT → complete → poll status) so any
 * future "second video" page can copy the pattern without churn.
 */

export async function fetchApplyVideoStatus(): Promise<ApplyVideoStatusResponse> {
  const { data } = await api.get<ApplyVideoStatusResponse>("/admin/apply-video")
  return data
}

export async function initApplyVideoUpload(payload: {
  mimeType: string
  filename: string
}): Promise<ApplyVideoPresignedPutResponse> {
  const { data } = await api.post<ApplyVideoPresignedPutResponse>(
    "/admin/apply-video/upload-init",
    payload
  )
  return data
}

/**
 * Direct browser PUT to S3 using the presigned URL minted above.
 * Uses a fresh axios instance so the global crypto + cookie
 * interceptors on `@/lib/api` don't tamper with the request (S3
 * rejects any header it didn't sign for).
 *
 * `x-amz-server-side-encryption: AES256` is sent explicitly to
 * satisfy the bucket's `DenyUnencryptedObjectUploads` policy. The
 * backend also signs `ServerSideEncryption: "AES256"` into the
 * presigned URL — adding the header here covers the case where the
 * SDK serializes SSE as a signed header (rather than a hoisted
 * query param), so the browser PUT survives the signature check
 * either way.
 */
export async function uploadApplyVideoToPresignedUrl(
  uploadUrl: string,
  file: File,
  contentType: string,
  onProgress?: (pct: number) => void
): Promise<void> {
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

export async function completeApplyVideoUpload(payload: {
  key: string
  mimeType: string
  sizeBytes?: number
  filename?: string
}): Promise<ApplyVideoStatusResponse> {
  const { data } = await api.post<ApplyVideoStatusResponse>(
    "/admin/apply-video/upload-complete",
    payload
  )
  return data
}

export async function retryApplyVideoTranscode(): Promise<ApplyVideoStatusResponse> {
  const { data } = await api.post<ApplyVideoStatusResponse>(
    "/admin/apply-video/retry-transcode"
  )
  return data
}
