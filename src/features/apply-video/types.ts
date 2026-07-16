/**
 * Mirror of `ApplyVideoStatus` in the backend. The dashboard renders
 * the badge / progress bar by branching on this enum.
 */
export type ApplyVideoStatus =
  | "draft"
  | "uploading"
  | "processing"
  | "ready"
  | "failed"

/**
 * Wire shape returned by `GET /admin/apply-video` and
 * `POST /admin/apply-video/upload-complete`. Kept in lockstep with
 * `ApplyVideoStatusResponse` in `jobjen-backend/src/modules/apply-video/service/apply-video.service.ts`.
 */
export interface ApplyVideoStatusResponse {
  videoStatus: ApplyVideoStatus
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
 * Result of `POST /admin/apply-video/upload-init`. Matches the
 * `PresignedPutResult` interface in `jobjen-backend/src/modules/storage/service/s3.service.ts`.
 */
export interface ApplyVideoPresignedPutResponse {
  uploadUrl: string
  key: string
  publicUrl: string
  contentType: string
  expiresIn: number
}
