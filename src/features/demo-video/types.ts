/**
 * Mirror of `DemoVideoStatus` in the backend. The dashboard renders
 * the badge / progress bar by branching on this enum.
 */
export type DemoVideoStatus =
  | "draft"
  | "uploading"
  | "processing"
  | "ready"
  | "failed"

/**
 * Wire shape returned by `GET /admin/demo-video` and
 * `POST /admin/demo-video/upload-complete`. Kept in lockstep with
 * `DemoVideoStatusResponse` in `jobjen-backend/src/modules/demo-video/service/demo-video.service.ts`.
 */
export interface DemoVideoStatusResponse {
  videoStatus: DemoVideoStatus
  videoProgress: string
  lastError: string
  durationSec: number
  sourceBytes: number
  originalFilename: string
  hasReadyVideo: boolean
  uploadedAt: string | null
  readyAt: string | null
}

/**
 * Result of `POST /admin/demo-video/upload-init`. Matches the
 * `PresignedPutResult` interface in `jobjen-backend/src/modules/storage/service/s3.service.ts`.
 */
export interface DemoVideoPresignedPutResponse {
  uploadUrl: string
  key: string
  publicUrl: string
  contentType: string
  expiresIn: number
}
