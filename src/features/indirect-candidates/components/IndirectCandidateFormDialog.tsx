import { useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import axios from "axios"
import {
  CheckCircle2,
  ExternalLink,
  FileText,
  Loader2,
  Trash2,
  Upload
} from "lucide-react"
import toast from "react-hot-toast"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import {
  activateApplicant,
  createIndirectCandidate,
  getCandidateDocumentUrl,
  removeCandidateDocument,
  updateIndirectCandidate,
  uploadCandidateDocument
} from "@/features/indirect-candidates/indirectCandidatesApi"
import {
  DOC_LABELS,
  DOC_TYPES,
  type ActivateApplicantPayload,
  type ActiveCandidateColor,
  type DocType,
  type IndirectCandidate,
  type IndirectCandidatePayload,
  type SecurityDepositStatus,
  type WhatsappGroupStatus
} from "@/features/indirect-candidates/types"
import { ColorSwatchPicker } from "@/features/indirect-candidates/components/CandidateColor"

/**
 * The applicant being activated (opened from the Applicants page "Mark
 * Active" action). Identity is prefilled read-only; the operator fills the
 * onboarding fields, which are saved against the applicant on the backend.
 */
export interface ActivateApplicantTarget {
  applicationId: string
  fullName: string
  email: string
  phoneNumber: string
}

interface IndirectCandidateFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The candidate being edited, or null to create a new one. */
  candidate: IndirectCandidate | null
  /**
   * When set (and `candidate` is null), the dialog runs in ACTIVATE mode:
   * it marks this applicant Active + mirrors them into the roster, then
   * switches to edit mode against the new row for document attach.
   */
  activateTarget?: ActivateApplicantTarget | null
}

const apiError = (err: unknown, fallback: string) =>
  axios.isAxiosError(err) &&
  (err.response?.data as { message?: string } | undefined)?.message
    ? (err.response!.data as { message: string }).message
    : fallback

const formatBytes = (bytes: number) => {
  if (!bytes) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`
}

/**
 * Create / edit dialog for an indirect candidate.
 *
 * Two-phase by design: documents can only be attached AFTER the row
 * exists (the upload presigns against the candidateId). So on create we
 * save the text fields first, then keep the dialog open in edit mode so
 * the operator can attach PDFs.
 */
export function IndirectCandidateFormDialog({
  open,
  onOpenChange,
  candidate,
  activateTarget = null
}: IndirectCandidateFormDialogProps) {
  const queryClient = useQueryClient()
  // The live row. null until created; seeded from `candidate` when editing.
  const [current, setCurrent] = useState<IndirectCandidate | null>(candidate)

  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [phoneNumber, setPhoneNumber] = useState("")
  const [referenceName, setReferenceName] = useState("")
  const [linkedinUrl, setLinkedinUrl] = useState("")
  const [githubUrl, setGithubUrl] = useState("")
  const [professionalWhatsapp, setProfessionalWhatsapp] = useState("")
  const [personalWhatsapp, setPersonalWhatsapp] = useState("")
  const [securityDepositStatus, setSecurityDepositStatus] =
    useState<SecurityDepositStatus>("pending")
  const [whatsappGroupStatus, setWhatsappGroupStatus] =
    useState<WhatsappGroupStatus>("pending")
  const [comments, setComments] = useState("")
  const [colorLabel, setColorLabel] = useState<ActiveCandidateColor | null>(null)

  const [saving, setSaving] = useState(false)
  // Which document slot is mid-upload, plus its percent (one at a time).
  const [uploadingDoc, setUploadingDoc] = useState<DocType | null>(null)
  const [uploadPct, setUploadPct] = useState(0)
  const [removingDoc, setRemovingDoc] = useState<DocType | null>(null)

  // Seed / reset whenever the dialog opens or the target candidate changes.
  useEffect(() => {
    if (!open) return
    setCurrent(candidate)
    // In activate mode the identity is prefilled (read-only) from the applicant.
    setFullName(candidate?.fullName ?? activateTarget?.fullName ?? "")
    setEmail(candidate?.email ?? activateTarget?.email ?? "")
    setPhoneNumber(candidate?.phoneNumber ?? activateTarget?.phoneNumber ?? "")
    setReferenceName(candidate?.referenceName ?? "")
    setLinkedinUrl(candidate?.linkedinUrl ?? "")
    setGithubUrl(candidate?.githubUrl ?? "")
    setProfessionalWhatsapp(candidate?.professionalWhatsapp ?? "")
    setPersonalWhatsapp(candidate?.personalWhatsapp ?? "")
    setSecurityDepositStatus(candidate?.securityDepositStatus ?? "pending")
    setWhatsappGroupStatus(candidate?.whatsappGroupStatus ?? "pending")
    setComments(candidate?.comments ?? "")
    setColorLabel(candidate?.colorLabel ?? null)
    setSaving(false)
    setUploadingDoc(null)
    setUploadPct(0)
    setRemovingDoc(null)
  }, [open, candidate, activateTarget])

  const isEdit = Boolean(current)
  // Activation only applies on the FIRST save (before the roster row exists).
  const isActivate = Boolean(activateTarget) && !current
  // Identity is read-only for pipeline rows (and during activation): it's a
  // snapshot of the applicant, not editable here.
  const identityReadOnly =
    Boolean(activateTarget) || current?.source === "pipeline"
  const busy = saving || uploadingDoc !== null || removingDoc !== null

  const buildPayload = (): IndirectCandidatePayload => ({
    fullName: fullName.trim(),
    email: email.trim(),
    phoneNumber: phoneNumber.trim(),
    ...buildOnboardingPayload()
  })

  // Onboarding fields only (no identity) — shared by the update + activate
  // payloads, since identity is fixed for pipeline rows.
  const buildOnboardingPayload = (): ActivateApplicantPayload => ({
    referenceName: referenceName.trim(),
    linkedinUrl: linkedinUrl.trim(),
    githubUrl: githubUrl.trim(),
    professionalWhatsapp: professionalWhatsapp.trim(),
    personalWhatsapp: personalWhatsapp.trim(),
    securityDepositStatus,
    whatsappGroupStatus,
    comments: comments.trim(),
    colorLabel
  })

  // Roster + (on activate) the applicants table both need to refresh.
  const invalidateRoster = () => {
    queryClient.invalidateQueries({ queryKey: ["active-candidates"] })
    queryClient.invalidateQueries({ queryKey: ["applicants"] })
  }

  const handleSave = async () => {
    if (!fullName.trim() || !email.trim() || !phoneNumber.trim()) {
      toast.error("Full name, email, and phone number are required.")
      return
    }
    setSaving(true)
    try {
      if (current) {
        const updated = await updateIndirectCandidate(
          current.candidateId,
          buildPayload()
        )
        setCurrent(updated)
        toast.success("Candidate updated.")
      } else if (activateTarget) {
        const activated = await activateApplicant(
          activateTarget.applicationId,
          buildOnboardingPayload()
        )
        setCurrent(activated)
        toast.success("Candidate activated. You can attach documents below.")
      } else {
        const created = await createIndirectCandidate(buildPayload())
        setCurrent(created)
        toast.success("Candidate created. You can attach documents below.")
      }
      invalidateRoster()
    } catch (err) {
      toast.error(apiError(err, "Could not save candidate."))
    } finally {
      setSaving(false)
    }
  }

  const handleUpload = async (docType: DocType, file: File) => {
    if (!current) return
    if (file.type && file.type !== "application/pdf") {
      toast.error("Only PDF files are accepted.")
      return
    }
    setUploadingDoc(docType)
    setUploadPct(0)
    try {
      const refreshed = await uploadCandidateDocument(
        current.candidateId,
        docType,
        file,
        setUploadPct
      )
      setCurrent(refreshed)
      // A resume on a manually-added candidate triggers background AI
      // extraction of their role + experience; let the operator know it will
      // appear shortly (on the roster) rather than instantly.
      if (docType === "resume" && refreshed.source === "manual") {
        toast.success(
          "Resume uploaded. Extracting role and experience in the background."
        )
      } else {
        toast.success(`${DOC_LABELS[docType]} uploaded.`)
      }
      queryClient.invalidateQueries({ queryKey: ["active-candidates"] })
    } catch (err) {
      toast.error(apiError(err, "Upload failed."))
    } finally {
      setUploadingDoc(null)
      setUploadPct(0)
    }
  }

  const handleRemoveDoc = async (docType: DocType) => {
    if (!current) return
    setRemovingDoc(docType)
    try {
      const refreshed = await removeCandidateDocument(
        current.candidateId,
        docType
      )
      setCurrent(refreshed)
      toast.success(`${DOC_LABELS[docType]} removed.`)
      queryClient.invalidateQueries({ queryKey: ["active-candidates"] })
    } catch (err) {
      toast.error(apiError(err, "Could not remove the document."))
    } finally {
      setRemovingDoc(null)
    }
  }

  const handleView = async (docType: DocType) => {
    if (!current) return
    // Open a blank tab synchronously so the popup blocker treats it as a
    // user-initiated open, then point it at the presigned URL once minted.
    const win = window.open("", "_blank")
    try {
      const { url } = await getCandidateDocumentUrl(current.candidateId, docType)
      if (win) win.location.href = url
      else window.open(url, "_blank")
    } catch (err) {
      win?.close()
      toast.error(apiError(err, "Could not open the document."))
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (busy) return
        onOpenChange(o)
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isActivate
              ? "Activate candidate"
              : isEdit
                ? "Edit candidate"
                : "Add indirect candidate"}
          </DialogTitle>
          <DialogDescription>
            {isActivate
              ? "Mark this applicant Active and capture their onboarding details. Save first, then attach the remaining documents (their resume is pulled in from the application automatically)."
              : isEdit
                ? "Update details or manage documents. Document changes save immediately; click Save changes for the rest."
                : "Manually add a candidate sourced outside the apply funnel. Only name, email, and phone are required. Save first, then attach documents."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Identity */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="ic-name">
                Full name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="ic-name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Jane Doe"
                disabled={identityReadOnly}
                autoFocus={!identityReadOnly}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="ic-email">
                Email <span className="text-destructive">*</span>
              </Label>
              <Input
                id="ic-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jane@example.com"
                disabled={identityReadOnly}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="ic-phone">
                Phone number <span className="text-destructive">*</span>
              </Label>
              <Input
                id="ic-phone"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="+923001234567"
                disabled={identityReadOnly}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="ic-ref">Reference name</Label>
              <Input
                id="ic-ref"
                value={referenceName}
                onChange={(e) => setReferenceName(e.target.value)}
                placeholder="Referred by..."
              />
            </div>
          </div>

          {/* Links + WhatsApp */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="ic-linkedin">LinkedIn profile</Label>
              <Input
                id="ic-linkedin"
                value={linkedinUrl}
                onChange={(e) => setLinkedinUrl(e.target.value)}
                placeholder="https://linkedin.com/in/..."
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="ic-github">GitHub account</Label>
              <Input
                id="ic-github"
                value={githubUrl}
                onChange={(e) => setGithubUrl(e.target.value)}
                placeholder="https://github.com/..."
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="ic-prof-wa">Professional WhatsApp</Label>
              <Input
                id="ic-prof-wa"
                value={professionalWhatsapp}
                onChange={(e) => setProfessionalWhatsapp(e.target.value)}
                placeholder="+923001234567"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="ic-pers-wa">Personal WhatsApp</Label>
              <Input
                id="ic-pers-wa"
                value={personalWhatsapp}
                onChange={(e) => setPersonalWhatsapp(e.target.value)}
                placeholder="+923009876543"
              />
            </div>
          </div>

          {/* Statuses */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label>Security deposit</Label>
              <Select
                value={securityDepositStatus}
                onValueChange={(v) =>
                  setSecurityDepositStatus(v as SecurityDepositStatus)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label>WhatsApp group</Label>
              <Select
                value={whatsappGroupStatus}
                onValueChange={(v) =>
                  setWhatsappGroupStatus(v as WhatsappGroupStatus)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="created">Created</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Color label */}
          <div className="flex flex-col gap-2">
            <Label>Color label</Label>
            <ColorSwatchPicker
              value={colorLabel}
              onSelect={setColorLabel}
              disabled={saving}
            />
            <p className="text-xs text-muted-foreground">
              Optional. A quick visual tag for sorting candidates on the roster.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="ic-comments">Comments / notes</Label>
            <Textarea
              id="ic-comments"
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              rows={3}
              placeholder="Anything worth recording about this candidate."
            />
          </div>

          {/* Documents */}
          <div className="space-y-2">
            <Label>Documents (PDF)</Label>
            {!isEdit ? (
              <p className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
                {isActivate
                  ? "Mark active first, then you can attach the agreement, CNIC, portfolio, and projects PDFs here. The resume is pulled in from their application automatically."
                  : "Save the candidate first, then you can attach the resume, agreement, CNIC, portfolio, and projects PDFs here."}
              </p>
            ) : (
              <div className="space-y-2">
                {DOC_TYPES.map((docType) => (
                  <DocumentRow
                    key={docType}
                    docType={docType}
                    info={current?.documents[docType] ?? null}
                    uploading={uploadingDoc === docType}
                    uploadPct={uploadPct}
                    removing={removingDoc === docType}
                    disabled={busy && uploadingDoc !== docType && removingDoc !== docType}
                    onPick={(file) => handleUpload(docType, file)}
                    onView={() => handleView(docType)}
                    onRemove={() => handleRemoveDoc(docType)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {isEdit ? "Done" : "Cancel"}
          </Button>
          <Button type="button" onClick={handleSave} disabled={busy}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isEdit
              ? "Save changes"
              : isActivate
                ? "Mark Active"
                : "Create candidate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface DocumentRowProps {
  docType: DocType
  info: { uploaded: boolean; originalName: string; sizeBytes: number } | null
  uploading: boolean
  uploadPct: number
  removing: boolean
  disabled: boolean
  onPick: (file: File) => void
  onView: () => void
  onRemove: () => void
}

function DocumentRow({
  docType,
  info,
  uploading,
  uploadPct,
  removing,
  disabled,
  onPick,
  onView,
  onRemove
}: DocumentRowProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const uploaded = Boolean(info?.uploaded)

  return (
    <div className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <FileText className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          {DOC_LABELS[docType]}
          {uploaded ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          ) : null}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {uploading
            ? `Uploading, ${uploadPct}%`
            : uploaded
              ? `${info?.originalName || "Document"} (${formatBytes(info?.sizeBytes ?? 0)})`
              : "Not uploaded"}
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ""
          if (file) onPick(file)
        }}
      />

      {uploaded ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onView}
          disabled={disabled || uploading || removing}
          title="View document"
        >
          <ExternalLink className="h-4 w-4" />
        </Button>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || uploading || removing}
      >
        {uploading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Upload className="h-4 w-4" />
        )}
        {uploaded ? "Replace" : "Upload"}
      </Button>
      {uploaded ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          disabled={disabled || uploading || removing}
          title="Remove document"
        >
          {removing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4 text-destructive" />
          )}
        </Button>
      ) : null}
    </div>
  )
}
