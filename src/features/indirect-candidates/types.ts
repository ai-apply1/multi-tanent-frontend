/**
 * Types for the unified active-candidates roster. One backend collection
 * (`indirect-candidates`) now holds BOTH populations, distinguished by
 * `source`:
 *   - "manual"   — added by hand from outside the apply funnel.
 *   - "pipeline" — mirrored in when an applicant was marked Active at the
 *                  end of the hiring pipeline (carries `applicationId` /
 *                  `interviewSessionId` back to the source applicant).
 */

export type SecurityDepositStatus = "pending" | "paid"
export type WhatsappGroupStatus = "pending" | "created" | "cancelled"

/** Where an active candidate came from. */
export type ActiveCandidateSource = "manual" | "pipeline"

/**
 * Optional triage color an operator pins on an active candidate for
 * at-a-glance sorting. Mirrors the Apple Files/Finder tag palette. `null`
 * means no color has been assigned.
 */
export type ActiveCandidateColor =
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple"
  | "gray"

/** Ordered list of the selectable colors, for rendering pickers/legends. */
export const ACTIVE_CANDIDATE_COLORS: ActiveCandidateColor[] = [
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "gray"
]

/** Human label per color, for menus and the filter dropdown. */
export const COLOR_LABELS: Record<ActiveCandidateColor, string> = {
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  purple: "Purple",
  gray: "Gray"
}

/** The five PDF document slots a candidate can carry. */
export const DOC_TYPES = [
  "resume",
  "agreement",
  "cnic",
  "portfolio",
  "projects"
] as const
export type DocType = (typeof DOC_TYPES)[number]

/** Display label per document slot. */
export const DOC_LABELS: Record<DocType, string> = {
  resume: "Resume",
  agreement: "Agreement",
  cnic: "CNIC (front + back)",
  portfolio: "Portfolio",
  projects: "Projects"
}

/** One document slot, as returned by the backend (no raw S3 key). */
export interface CandidateDocumentInfo {
  uploaded: boolean
  originalName: string
  contentType: string
  sizeBytes: number
  uploadedAt: string | null
}

export interface IndirectCandidate {
  candidateId: string
  /** "manual" (hand-added) or "pipeline" (mirrored from an activated applicant). */
  source: ActiveCandidateSource
  /** Source applicant id (pipeline rows only; "" for manual). */
  applicationId: string
  /** Interview session for the roster's "View Result" (pipeline rows; "" otherwise). */
  interviewSessionId: string
  /** Role the applicant applied for (pipeline snapshot; "" for manual). */
  primaryRole: string
  /** Years of experience (pipeline snapshot; 0 for manual). */
  yearsOfExperience: number
  /** City (pipeline snapshot; "" for manual). */
  city: string
  fullName: string
  email: string
  phoneNumber: string
  referenceName: string
  linkedinUrl: string
  githubUrl: string
  professionalWhatsapp: string
  personalWhatsapp: string
  securityDepositStatus: SecurityDepositStatus
  whatsappGroupStatus: WhatsappGroupStatus
  comments: string
  /** Triage color pinned on the row, or null when uncolored. */
  colorLabel: ActiveCandidateColor | null
  documents: Record<DocType, CandidateDocumentInfo>
  createdByAdminName: string
  createdAt: string | null
  updatedAt: string | null
}

export interface PaginatedIndirectCandidates {
  data: IndirectCandidate[]
  count: number
  page: number
  limit: number
  totalPage: number
  nextPage: number | null
}

/** Editable fields (everything except the server-managed documents/audit). */
export interface IndirectCandidatePayload {
  fullName: string
  email: string
  phoneNumber: string
  referenceName?: string
  linkedinUrl?: string
  githubUrl?: string
  professionalWhatsapp?: string
  personalWhatsapp?: string
  securityDepositStatus?: SecurityDepositStatus
  whatsappGroupStatus?: WhatsappGroupStatus
  comments?: string
  /** Pass a color to tag the candidate, or null to clear it. */
  colorLabel?: ActiveCandidateColor | null
}

export interface ListIndirectCandidatesParams {
  page?: number
  limit?: number
  search?: string
  securityDepositStatus?: SecurityDepositStatus
  whatsappGroupStatus?: WhatsappGroupStatus
  source?: ActiveCandidateSource
  colorLabel?: ActiveCandidateColor
}

/**
 * Onboarding fields captured by the activation modal when marking a
 * pipeline applicant Active. Identity (name / email / phone) is NOT sent,
 * it comes from the applicant server-side.
 */
export interface ActivateApplicantPayload {
  referenceName?: string
  linkedinUrl?: string
  githubUrl?: string
  professionalWhatsapp?: string
  personalWhatsapp?: string
  securityDepositStatus?: SecurityDepositStatus
  whatsappGroupStatus?: WhatsappGroupStatus
  comments?: string
  /** Optional triage color to pin on the new roster row. */
  colorLabel?: ActiveCandidateColor | null
}
