import axios from "axios"
import api from "@/lib/api"
import type {
  BulkConfirmResult,
  BulkConfirmRow,
  BulkPresignFile,
  CandidateDetail,
  CandidateStatus,
  InviteResult,
  KanbanBoard,
  ListCandidatesParams,
  PaginatedCandidates,
  PresignedCvUpload,
} from "@/features/candidates/types"

// ---------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------

export async function listCandidates(params: ListCandidatesParams = {}) {
  const { data } = await api.get<PaginatedCandidates>("/admin/candidates", {
    params: {
      page: params.page ?? 1,
      limit: params.limit ?? 25,
      ...(params.jobId ? { jobId: params.jobId } : {}),
      ...(params.statusKey ? { statusKey: params.statusKey } : {}),
      ...(params.search?.trim() ? { search: params.search.trim() } : {}),
    },
  })
  return data
}

export async function getCandidate(candidateId: string) {
  const { data } = await api.get<CandidateDetail>(`/admin/candidates/${candidateId}`)
  return data
}

/**
 * The org's kanban status catalog, board order (stageOrder asc). Includes the
 * org's CUSTOM columns alongside the 8 builtins — which is exactly why the
 * Status filter and the change-status menu are built from this call and never
 * from a hard-coded list.
 */
export async function listCandidateStatuses() {
  const { data } = await api.get<CandidateStatus[]>("/admin/statuses")
  return data
}

/**
 * The board for ONE job — there is no cross-job board, which is why the
 * page's view toggle is disabled until a single job is picked.
 *
 * Each column's `candidates` array is capped at 25 while `count` is the true
 * total; the renderer must own that gap (see `KanbanColumn`).
 */
export async function getCandidateKanban(jobId: string) {
  const { data } = await api.get<KanbanBoard>(`/admin/jobs/${jobId}/candidates/kanban`)
  return data
}

/**
 * Mint a short-lived presigned GET for the candidate's CV. Required because
 * the bucket is private — the stored `cvKey` is a key, not a URL, and there
 * is nothing anonymous to link to. The backend forces `attachment` with a
 * server-built filename, so a candidate-crafted HTML "CV" downloads instead
 * of executing in the reviewer's browser.
 */
export async function getCandidateCvUrl(candidateId: string) {
  const { data } = await api.get<{ downloadUrl: string; expiresIn: number }>(
    `/admin/candidates/${candidateId}/cv-url`
  )
  return data
}

/**
 * CSV export of the org's candidates, optionally scoped to one job. The
 * endpoint is `@SkipCrypto()` and streams raw `text/csv` (NOT the encrypted
 * JSON envelope), so we bypass the client crypto layer with the
 * `x-skip-crypto` marker AND ask axios for a blob — both are required, since
 * the request interceptor only preserves a non-JSON `responseType` when the
 * crypto path is skipped. Cookies + perimeter Basic Auth still ride along on
 * the shared instance, so the download stays authenticated.
 *
 * Only `jobId` is honoured: the export is "one job's funnel (or everything)
 * as a spreadsheet", deliberately not a mirror of the table's filters.
 *
 * `count` / `truncated` come from custom response headers, which a browser
 * only reveals cross-origin when the backend lists them in CORS
 * `exposedHeaders`. They are therefore best-effort: `count` is `null` when the
 * header didn't make it through, and the caller must word its toast without a
 * number rather than print a confident `0`.
 */
export async function exportCandidatesCsv(jobId?: string) {
  const res = await api.get<Blob>("/admin/candidates/export", {
    params: jobId ? { jobId } : {},
    responseType: "blob",
    headers: { "x-skip-crypto": "1" },
  })
  const rawCount = res.headers["x-export-count"]
  const parsed = rawCount == null ? Number.NaN : Number(rawCount)
  return {
    blob: res.data,
    count: Number.isFinite(parsed) ? parsed : null,
    truncated: res.headers["x-export-truncated"] === "true",
  }
}

// ---------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------

/**
 * Manual kanban move. Addresses the target column by KEY (builtin or custom),
 * never by ObjectId — matching how every funnel automation addresses statuses,
 * and the reason a board card can be dropped on a column the client only knows
 * by its catalog row.
 */
export async function updateCandidateStatus(
  candidateId: string,
  payload: { statusKey: string; note?: string }
) {
  const { data } = await api.patch<CandidateDetail>(
    `/admin/candidates/${candidateId}/status`,
    payload
  )
  return data
}

/**
 * HR-triggered manual invite — the escape hatch for candidates the vetting
 * engine parked at `prescreened` for human review.
 *
 * Guarded server-side, all before any side effect: 409 `INVALID_STATUS`
 * unless the candidate is exactly `prescreened`, 422 when the job isn't open,
 * 409 `MAX_ATTEMPTS` when the attempt cap is spent. Each carries a message
 * naming the actual state, so callers should surface it verbatim via
 * `errorMessage()` rather than flattening all three into one generic string.
 */
export async function sendCandidateInvite(candidateId: string) {
  const { data } = await api.post<InviteResult>(
    `/admin/candidates/${candidateId}/invite`,
    {}
  )
  return data
}

export async function deleteCandidate(candidateId: string) {
  const { data } = await api.delete<{ deleted: true; candidateId: string }>(
    `/admin/candidates/${candidateId}`
  )
  return data
}

// ---------------------------------------------------------------------
// Bulk CV import (presign → direct S3 PUT → confirm)
// ---------------------------------------------------------------------

/**
 * Step 1: mint one presigned PUT per CV so the browser uploads straight to
 * S3 (the API never buffers the files). No candidate rows exist yet — the
 * only linkage is the `key` echoed back at confirm. 422 when the job isn't
 * open. Max 50 files per call.
 */
export async function bulkPresignCvs(jobId: string, files: BulkPresignFile[]) {
  const { data } = await api.post<{ files: PresignedCvUpload[] }>(
    `/admin/jobs/${jobId}/candidates/bulk-presign`,
    { files }
  )
  return data.files
}

/**
 * Direct browser PUT to S3 with the presigned URL.
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
 * Copied from `interviewQuestionsApi.uploadToPresignedUrl` — keep the two in
 * step.
 */
export async function uploadCvToPresignedUrl(
  uploadUrl: string,
  file: File,
  contentType: string,
  onProgress?: (pct: number) => void
) {
  await axios.put(uploadUrl, file, {
    headers: {
      "Content-Type": contentType,
      "x-amz-server-side-encryption": "AES256",
    },
    withCredentials: false,
    onUploadProgress: (event) => {
      if (event.total && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100))
      }
    },
  })
}

/**
 * Step 2: create the candidate rows (status `applied`) and enqueue CV-parse
 * for each.
 *
 * PER-ROW, never all-or-nothing — a duplicate `(jobId, email)` or a key
 * outside this org+job's prefix lands that row in `skipped` while the rest of
 * the batch still creates. Callers must render BOTH halves.
 */
export async function bulkConfirmCvs(jobId: string, rows: BulkConfirmRow[]) {
  const { data } = await api.post<BulkConfirmResult>(
    `/admin/jobs/${jobId}/candidates/bulk-confirm`,
    { rows }
  )
  return data
}
