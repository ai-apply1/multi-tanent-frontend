import axios from "axios"
import api, { apiUrl } from "@/lib/api"
import type {
  BulkConfirmResult,
  BulkConfirmRow,
  BulkEmailResult,
  BulkExtractRow,
  BulkPresignFile,
  CandidateDetail,
  CandidateStatus,
  InviteResult,
  KanbanBoard,
  ListCandidatesParams,
  PaginatedCandidates,
  PresignedCvUpload,
  SendCandidateEmailPayload,
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
 * Mint a short-lived, inline CV view URL. Returns a RELATIVE path
 * (`/cv/<id>/<name>?t=<token>`) that `fetchCandidateCvBlobUrl` resolves against
 * the backend API origin — the same host every other call uses — so the backend
 * verifies the one-time token and streams the file for rendering as an in-tab
 * blob, rather than exposing the raw S3 link. See the backend `CvViewController`.
 */
export async function getCandidateCvViewUrl(candidateId: string) {
  const { data } = await api.post<{ url: string; expiresIn: number }>(
    `/admin/candidates/${candidateId}/cv-view-url`
  )
  return data
}

/**
 * Fetch a candidate's CV and return a `blob:` object URL for it.
 *
 * Why a blob and not a plain navigation to `/cv/...`: a download manager (IDM)
 * intercepts a top-level navigation that returns `application/pdf` and turns it
 * into a download, by URL extension AND by content type, so no server header
 * can both render it inline and hide it. A `blob:` URL is in-memory and
 * same-origin, so there is no HTTP transfer for IDM to hook, and the browser
 * still renders the PDF inline.
 *
 * Plain `fetch`, NOT the `api` instance: this route returns raw bytes, not the
 * encrypted JSON envelope the axios interceptors expect (they would try to
 * decrypt a PDF). It needs no auth header — the one-time token is in the URL,
 * and the route is exempt from the crypto layer and the Basic Auth perimeter.
 *
 * The caller owns the returned URL and should `URL.revokeObjectURL` it once the
 * viewer has loaded (revoking after load is safe; the rendered document keeps
 * its bytes).
 */
export async function fetchCandidateCvBlobUrl(
  candidateId: string
): Promise<string> {
  const { url } = await getCandidateCvViewUrl(candidateId)
  // Fetch from the backend API origin (like every other call), NOT the page
  // origin: the relative `/cv/...` path is served by the backend, and routing
  // it through the API host keeps the token's mint host and its redeem host
  // identical in every environment. A Vercel `/cv` rewrite can't do this —
  // its destination is a static string that can't read `VITE_API_BASE_URL`.
  const res = await fetch(apiUrl(`/api/v1${url}`))
  if (!res.ok) throw new Error(`Could not load the CV (${res.status}).`)
  // The route serves the bytes as `text/plain` so a download manager (IDM)
  // ignores the fetch; the REAL type comes back in `X-Cv-Content-Type`. Build
  // the blob from that so it renders as a PDF. This is a CROSS-origin fetch, so
  // the header is only readable because the backend lists `X-Cv-Content-Type`
  // in its CORS `exposedHeaders` — keep the two in sync. Never trust
  // `res.blob()`'s type here — it would be text/plain.
  const type = res.headers.get("x-cv-content-type") || "application/pdf"
  const buf = await res.arrayBuffer()
  return URL.createObjectURL(new Blob([buf], { type }))
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
 * engine parked at `needs_review` for human review.
 *
 * Guarded server-side, all before any side effect: 409 `INVALID_STATUS`
 * unless the candidate is exactly `needs_review`, 422 when the job isn't open,
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

/**
 * Send a chosen email template (subject + body edited in the compose dialog)
 * to one or more candidates. INVITE / FOLLOWUP re-mint each candidate's
 * interview link; SHORTLIST / REJECTION carry only name/org/job tokens.
 *
 * PER-CANDIDATE, never all-or-nothing: a recipient whose job closed or whose
 * attempts are spent lands in `skipped` while the rest still send, so callers
 * must surface both `sent` and `skipped`. Does NOT change candidate status.
 */
export async function sendCandidateEmail(payload: SendCandidateEmailPayload) {
  const { data } = await api.post<BulkEmailResult>(
    "/admin/candidates/send-email",
    payload
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
 * Step 1.5: read name/email/phone/city off CVs whose PUTs have landed.
 *
 * Reads only — no candidate rows are created, so abandoning the dialog here
 * costs nothing but orphaned S3 objects (swept by the prefix delete, same
 * as an abandoned presign).
 *
 * Send at most `BULK_EXTRACT_BATCH` keys per call; the server rejects more.
 * Per-CV outcomes ride in each row's `error` — the call itself only throws
 * on a real transport/auth failure.
 */
export async function bulkExtractCvs(jobId: string, cvKeys: string[]) {
  const { data } = await api.post<{ rows: BulkExtractRow[] }>(
    `/admin/jobs/${jobId}/candidates/bulk-extract`,
    { cvKeys }
  )
  return data.rows
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
