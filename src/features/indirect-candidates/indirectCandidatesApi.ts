import axios from "axios"
import api from "@/lib/api"
import type {
  ActivateApplicantPayload,
  DocType,
  IndirectCandidate,
  IndirectCandidatePayload,
  ListIndirectCandidatesParams,
  PaginatedIndirectCandidates
} from "@/features/indirect-candidates/types"

export async function listIndirectCandidates(
  params: ListIndirectCandidatesParams = {}
) {
  const { data } = await api.get<PaginatedIndirectCandidates>(
    "/admin/indirect-candidates",
    {
      params: {
        page: params.page ?? 1,
        limit: params.limit ?? 25,
        ...(params.search?.trim() ? { search: params.search.trim() } : {}),
        ...(params.securityDepositStatus
          ? { securityDepositStatus: params.securityDepositStatus }
          : {}),
        ...(params.whatsappGroupStatus
          ? { whatsappGroupStatus: params.whatsappGroupStatus }
          : {}),
        ...(params.source ? { source: params.source } : {}),
        ...(params.colorLabel ? { colorLabel: params.colorLabel } : {})
      }
    }
  )
  return data
}

/**
 * Mark a pipeline applicant Active and mirror them into the active-candidates
 * roster with the onboarding info from the activation modal. Returns the
 * created/updated roster candidate so the modal can attach documents next.
 * (Lives on the applicants surface, not the indirect-candidates surface,
 * because it also sets the applicant's `active` pipeline chip.)
 */
export async function activateApplicant(
  applicationId: string,
  payload: ActivateApplicantPayload
) {
  const { data } = await api.post<IndirectCandidate>(
    `/admin/applicants/${applicationId}/activate`,
    payload
  )
  return data
}

export async function getIndirectCandidate(candidateId: string) {
  const { data } = await api.get<IndirectCandidate>(
    `/admin/indirect-candidates/${candidateId}`
  )
  return data
}

export async function createIndirectCandidate(payload: IndirectCandidatePayload) {
  const { data } = await api.post<IndirectCandidate>(
    "/admin/indirect-candidates",
    payload
  )
  return data
}

export async function updateIndirectCandidate(
  candidateId: string,
  payload: Partial<IndirectCandidatePayload>
) {
  const { data } = await api.patch<IndirectCandidate>(
    `/admin/indirect-candidates/${candidateId}`,
    payload
  )
  return data
}

export async function deleteIndirectCandidate(candidateId: string) {
  const { data } = await api.delete<{ success: boolean; candidateId: string }>(
    `/admin/indirect-candidates/${candidateId}`
  )
  return data
}

// ---------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------

interface PresignResponse {
  uploadUrl: string
  key: string
  contentType: string
  expiresIn: number
}

async function presignDocument(
  candidateId: string,
  docType: DocType,
  body: { filename: string; contentType: string }
) {
  const { data } = await api.post<PresignResponse>(
    `/admin/indirect-candidates/${candidateId}/documents/${docType}/presign`,
    body
  )
  return data
}

async function confirmDocument(
  candidateId: string,
  docType: DocType,
  body: { key: string; originalName: string }
) {
  const { data } = await api.post<IndirectCandidate>(
    `/admin/indirect-candidates/${candidateId}/documents/${docType}/confirm`,
    body
  )
  return data
}

/**
 * Upload a single PDF directly to S3 with a fresh axios instance so the
 * global crypto + cookie interceptors don't tamper with the request (S3
 * rejects any header it didn't sign for). `x-amz-server-side-encryption:
 * AES256` satisfies the bucket's DenyUnencryptedObjectUploads policy.
 */
async function putToPresignedUrl(
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
 * Full per-document upload: presign, PUT straight to S3, then confirm.
 * Returns the refreshed candidate (from the confirm step).
 */
export async function uploadCandidateDocument(
  candidateId: string,
  docType: DocType,
  file: File,
  onProgress?: (pct: number) => void
) {
  const contentType = file.type || "application/pdf"
  const presigned = await presignDocument(candidateId, docType, {
    filename: file.name,
    contentType
  })
  await putToPresignedUrl(presigned.uploadUrl, file, presigned.contentType, onProgress)
  return confirmDocument(candidateId, docType, {
    key: presigned.key,
    originalName: file.name
  })
}

export async function removeCandidateDocument(
  candidateId: string,
  docType: DocType
) {
  const { data } = await api.delete<IndirectCandidate>(
    `/admin/indirect-candidates/${candidateId}/documents/${docType}`
  )
  return data
}

/** Mint a short-lived presigned GET URL to view/download a document. */
export async function getCandidateDocumentUrl(
  candidateId: string,
  docType: DocType
) {
  const { data } = await api.get<{ url: string; expiresIn: number }>(
    `/admin/indirect-candidates/${candidateId}/documents/${docType}/url`
  )
  return data
}
