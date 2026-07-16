import axios from "axios"
import api from "@/lib/api"
import type {
  DemoVideoPresignedPutResponse,
  DemoVideoStatusResponse
} from "@/features/demo-video/types"

/**
 * Admin-side status / lifecycle endpoints for the AI-interview demo
 * walkthrough video. Same shape as `applyVideoApi.ts` (init → S3 PUT →
 * complete → poll) against the `demo-video` backend slot.
 */

export async function fetchDemoVideoStatus(): Promise<DemoVideoStatusResponse> {
  const { data } = await api.get<DemoVideoStatusResponse>("/admin/demo-video")
  return data
}

export async function initDemoVideoUpload(payload: {
  mimeType: string
  filename: string
}): Promise<DemoVideoPresignedPutResponse> {
  const { data } = await api.post<DemoVideoPresignedPutResponse>(
    "/admin/demo-video/upload-init",
    payload
  )
  return data
}

/**
 * Direct browser PUT to S3 using the presigned URL minted above. Uses
 * a fresh axios instance so the global crypto + cookie interceptors on
 * `@/lib/api` don't tamper with the request (S3 rejects any header it
 * didn't sign for). `x-amz-server-side-encryption: AES256` is sent
 * explicitly to satisfy the bucket's `DenyUnencryptedObjectUploads`
 * policy.
 */
export async function uploadDemoVideoToPresignedUrl(
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

export async function completeDemoVideoUpload(payload: {
  key: string
  mimeType: string
  sizeBytes?: number
  filename?: string
}): Promise<DemoVideoStatusResponse> {
  const { data } = await api.post<DemoVideoStatusResponse>(
    "/admin/demo-video/upload-complete",
    payload
  )
  return data
}

export async function retryDemoVideoTranscode(): Promise<DemoVideoStatusResponse> {
  const { data } = await api.post<DemoVideoStatusResponse>(
    "/admin/demo-video/retry-transcode"
  )
  return data
}
