import { useEffect, useRef, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import toast from "react-hot-toast"
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  Trash2,
  Upload,
  UploadCloud,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  bulkConfirmCvs,
  bulkPresignCvs,
  uploadCvToPresignedUrl,
} from "@/features/candidates/candidatesApi"
import {
  ALLOWED_CV_CONTENT_TYPES,
  MAX_CV_UPLOAD_FILES,
  SKIP_REASON_LABELS,
  type AllowedCvContentType,
  type BulkConfirmResult,
  type BulkConfirmSkipReason,
} from "@/features/candidates/types"
import { errorMessage } from "@/lib/errors"
import { cn } from "@/lib/utils"

/**
 * Extension → mime, for the browsers that hand us an empty (or plain
 * `application/octet-stream`) `File.type` for .doc/.docx. The mime we send at
 * presign is what S3 signs the PUT for, so guessing wrong here surfaces as a
 * 403 on upload, not a validation error.
 */
const CONTENT_TYPE_BY_EXTENSION: Record<string, AllowedCvContentType> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

const ACCEPT_ATTR = ".pdf,.doc,.docx"

function contentTypeFor(file: File): AllowedCvContentType | null {
  if ((ALLOWED_CV_CONTENT_TYPES as readonly string[]).includes(file.type)) {
    return file.type as AllowedCvContentType
  }
  const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
  return CONTENT_TYPE_BY_EXTENSION[ext] ?? null
}

/** "Jane Doe - CV (2).pdf" → "Jane Doe" — a starting point the user edits. */
function nameFromFile(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b(cv|resume|curriculum vitae)\b/gi, "")
    .replace(/\(\d+\)/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Per-file state through presign → PUT → confirm. */
type RowStatus = "idle" | "uploading" | "uploaded" | "failed"

interface UploadRow {
  /** Stable across re-renders; the `key` and the correlation handle. */
  id: string
  file: File
  contentType: AllowedCvContentType
  fullName: string
  email: string
  phone: string
  city: string
  status: RowStatus
  progress: number
  /** Why the direct S3 PUT failed — shown inline, not toasted. */
  error: string | null
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The import target. The dialog only opens for an `open` job (422 otherwise). */
  jobId: string
  jobTitle: string
  /** Fired once the confirm lands with at least one created row. */
  onImported: () => void
}

/**
 * Bulk CV import: presign → direct-to-S3 PUT → confirm.
 *
 * The API never touches the files — it mints presigned PUTs and later
 * receives the keys back. That's also why the two halves can disagree: a PUT
 * can fail locally (reported here) and, independently, the confirm can skip a
 * row server-side (duplicate email, key outside this job's prefix). Both are
 * rendered; neither is swallowed.
 */
export function UploadCvsDialog({
  open,
  onOpenChange,
  jobId,
  jobTitle,
  onImported,
}: Props) {
  const [rows, setRows] = useState<UploadRow[]>([])
  const [touched, setTouched] = useState<Set<string>>(new Set())
  const [result, setResult] = useState<BulkConfirmResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Fresh dialog every time: a previous run's rows/result must not leak into
  // the next import (and a stale `result` would show the summary screen for a
  // batch the user never sent).
  useEffect(() => {
    if (!open) return
    setRows([])
    setTouched(new Set())
    setResult(null)
  }, [open])

  const addFiles = (fileList: FileList | null) => {
    if (!fileList?.length) return
    const incoming: UploadRow[] = []
    let rejected = 0
    for (const file of Array.from(fileList)) {
      const contentType = contentTypeFor(file)
      if (!contentType) {
        rejected += 1
        continue
      }
      incoming.push({
        id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
        file,
        contentType,
        fullName: nameFromFile(file.name),
        email: "",
        phone: "",
        city: "",
        status: "idle",
        progress: 0,
        error: null,
      })
    }
    if (rejected > 0) {
      toast.error(
        `Skipped ${rejected} file${rejected === 1 ? "" : "s"} — only PDF, DOC and DOCX are accepted.`
      )
    }
    setRows((prev) => {
      const room = MAX_CV_UPLOAD_FILES - prev.length
      if (incoming.length > room) {
        toast.error(
          `You can upload ${MAX_CV_UPLOAD_FILES} CVs at a time — the extra ${
            incoming.length - room
          } were left out.`
        )
      }
      return [...prev, ...incoming.slice(0, Math.max(room, 0))]
    })
  }

  const patchRow = (id: string, patch: Partial<UploadRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  const removeRow = (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id))
  }

  const emailError = (row: UploadRow): string | null => {
    if (!row.email.trim()) return "Email is required."
    if (!EMAIL_RE.test(row.email.trim())) return "Enter a valid email."
    return null
  }

  const nameError = (row: UploadRow): string | null =>
    row.fullName.trim() ? null : "Name is required."

  const canSubmit =
    rows.length > 0 && rows.every((r) => !emailError(r) && !nameError(r))

  const uploadMutation = useMutation({
    mutationFn: async (): Promise<BulkConfirmResult> => {
      // 1. Presign — one URL per file, same order as we sent them.
      const presigned = await bulkPresignCvs(
        jobId,
        rows.map((r) => ({
          fileName: r.file.name,
          contentType: r.contentType,
          email: r.email.trim(),
          fullName: r.fullName.trim(),
        }))
      )

      setRows((prev) =>
        prev.map((r) => ({ ...r, status: "uploading", progress: 0, error: null }))
      )

      // 2. Direct-to-S3 PUTs. `allSettled`, not `all`: one dead upload must
      //    not cancel the other 49 — the survivors still get confirmed below.
      //    Correlation is by INDEX, which `bulkPresign`'s Promise.all
      //    preserves; file names alone aren't unique.
      const puts = await Promise.allSettled(
        rows.map(async (row, index) => {
          const slot = presigned[index]
          if (!slot) throw new Error("The server returned no upload URL for this file.")
          await uploadCvToPresignedUrl(slot.uploadUrl, row.file, row.contentType, (pct) =>
            patchRow(row.id, { progress: pct })
          )
          return { row, key: slot.key }
        })
      )

      const uploaded: Array<{ row: UploadRow; key: string }> = []
      puts.forEach((outcome, index) => {
        const row = rows[index]
        if (outcome.status === "fulfilled") {
          uploaded.push(outcome.value)
          patchRow(row.id, { status: "uploaded", progress: 100 })
        } else {
          patchRow(row.id, {
            status: "failed",
            error: errorMessage(outcome.reason, "Upload to storage failed."),
          })
        }
      })

      if (uploaded.length === 0) {
        throw new Error("Every upload failed — no candidates were created.")
      }

      // 3. Confirm. Per-row on the server too: duplicates and bad keys are
      //    reported, not thrown.
      return bulkConfirmCvs(
        jobId,
        uploaded.map(({ row, key }) => ({
          fullName: row.fullName.trim(),
          email: row.email.trim(),
          ...(row.phone.trim() ? { phone: row.phone.trim() } : {}),
          ...(row.city.trim() ? { city: row.city.trim() } : {}),
          cvKey: key,
        }))
      )
    },
    onSuccess: (res) => {
      setResult(res)
      if (res.created.length > 0) {
        toast.success(
          `Imported ${res.created.length} candidate${res.created.length === 1 ? "" : "s"}.`
        )
        onImported()
      }
    },
    onError: (err: unknown) => {
      // The job flipping out of `open` mid-dialog lands here as a 422 whose
      // message names the actual status — worth reading, so pass it through.
      toast.error(errorMessage(err, "Could not upload the CVs."))
    },
  })

  const busy = uploadMutation.isPending
  const failedUploads = rows.filter((r) => r.status === "failed")

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) return
        onOpenChange(next)
      }}
    >
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-3xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>Upload CVs</DialogTitle>
          <DialogDescription>
            {result ? (
              <>Import summary for {jobTitle}.</>
            ) : (
              <>
                Add up to {MAX_CV_UPLOAD_FILES} CVs to <strong>{jobTitle}</strong>. Each
                one becomes a candidate at <em>Applied</em>, and the CV is parsed and
                pre-screened automatically. PDF, DOC and DOCX only.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 py-2">
          {result ? (
            <ImportSummary result={result} />
          ) : (
            <div className="space-y-4">
              <button
                type="button"
                disabled={busy || rows.length >= MAX_CV_UPLOAD_FILES}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-center transition-colors",
                  "hover:border-primary hover:bg-primary/5",
                  "disabled:pointer-events-none disabled:opacity-50"
                )}
              >
                <UploadCloud className="h-6 w-6 text-primary" />
                <span className="text-sm font-medium">Choose CV files</span>
                <span className="text-xs text-muted-foreground">
                  {rows.length > 0
                    ? `${rows.length} of ${MAX_CV_UPLOAD_FILES} selected`
                    : "PDF, DOC or DOCX"}
                </span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ACCEPT_ATTR}
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files)
                  // Reset so re-picking the same file fires `change` again.
                  e.target.value = ""
                }}
              />

              {rows.length === 0 ? (
                <p className="text-center text-xs text-muted-foreground">
                  Name and email are required per CV — they're the candidate's identity
                  and the email is how the interview invite reaches them.
                </p>
              ) : (
                <div className="space-y-3">
                  {rows.map((row) => {
                    const isTouched = touched.has(row.id)
                    const emailMsg = isTouched ? emailError(row) : null
                    const nameMsg = isTouched ? nameError(row) : null
                    return (
                      <div
                        key={row.id}
                        className="rounded-lg border border-border bg-card p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span
                              className="truncate text-xs font-medium"
                              title={row.file.name}
                            >
                              {row.file.name}
                            </span>
                            <span className="shrink-0 text-[11px] text-muted-foreground">
                              {formatBytes(row.file.size)}
                            </span>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {row.status === "uploaded" ? (
                              <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />
                            ) : null}
                            {row.status === "failed" ? (
                              <AlertTriangle className="h-4 w-4 text-destructive" />
                            ) : null}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 hover:bg-destructive/10 hover:text-destructive"
                              disabled={busy}
                              onClick={() => removeRow(row.id)}
                              aria-label={`Remove ${row.file.name}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>

                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label htmlFor={`name-${row.id}`} className="text-xs">
                              Name
                            </Label>
                            <Input
                              id={`name-${row.id}`}
                              value={row.fullName}
                              disabled={busy}
                              aria-invalid={Boolean(nameMsg)}
                              maxLength={200}
                              onChange={(e) =>
                                patchRow(row.id, { fullName: e.target.value })
                              }
                              onBlur={() =>
                                setTouched((prev) => new Set(prev).add(row.id))
                              }
                            />
                            {nameMsg ? (
                              <p className="text-xs text-destructive">{nameMsg}</p>
                            ) : null}
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor={`email-${row.id}`} className="text-xs">
                              Email
                            </Label>
                            <Input
                              id={`email-${row.id}`}
                              type="email"
                              value={row.email}
                              disabled={busy}
                              aria-invalid={Boolean(emailMsg)}
                              maxLength={320}
                              placeholder="candidate@example.com"
                              onChange={(e) => patchRow(row.id, { email: e.target.value })}
                              onBlur={() =>
                                setTouched((prev) => new Set(prev).add(row.id))
                              }
                            />
                            {emailMsg ? (
                              <p className="text-xs text-destructive">{emailMsg}</p>
                            ) : null}
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor={`phone-${row.id}`} className="text-xs">
                              Phone <span className="text-muted-foreground">(optional)</span>
                            </Label>
                            <Input
                              id={`phone-${row.id}`}
                              value={row.phone}
                              disabled={busy}
                              maxLength={40}
                              placeholder="+92…"
                              onChange={(e) => patchRow(row.id, { phone: e.target.value })}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor={`city-${row.id}`} className="text-xs">
                              City <span className="text-muted-foreground">(optional)</span>
                            </Label>
                            <Input
                              id={`city-${row.id}`}
                              value={row.city}
                              disabled={busy}
                              maxLength={120}
                              onChange={(e) => patchRow(row.id, { city: e.target.value })}
                            />
                          </div>
                        </div>

                        {row.status === "uploading" ? (
                          <div className="mt-3">
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-primary transition-[width] duration-200"
                                style={{ width: `${row.progress}%` }}
                              />
                            </div>
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              Uploading… {row.progress}%
                            </p>
                          </div>
                        ) : null}
                        {row.error ? (
                          <p className="mt-2 text-xs text-destructive">{row.error}</p>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0">
          {result ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <>
              <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                // Deliberately NOT gated on `canSubmit`: every row starts with
                // an empty (invalid) email, so a canSubmit-disabled button
                // would sit dead with no explanation. Clicking instead reveals
                // every field error at once — a fresh dialog stays clean until
                // the user actually asks to submit.
                disabled={rows.length === 0 || busy}
                onClick={() => {
                  setTouched(new Set(rows.map((r) => r.id)))
                  if (!canSubmit) return
                  uploadMutation.mutate()
                }}
              >
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Uploading…
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    Upload {rows.length > 0 ? rows.length : ""}{" "}
                    {rows.length === 1 ? "CV" : "CVs"}
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>

        {/* Uploads that never reached S3 — distinct from the server's
            `skipped`, and only meaningful while the summary isn't shown yet
            (the summary folds them into its own section). */}
        {!result && failedUploads.length > 0 && !busy ? (
          <p className="shrink-0 text-xs text-destructive">
            {failedUploads.length} upload{failedUploads.length === 1 ? "" : "s"} failed —
            remove or retry {failedUploads.length === 1 ? "it" : "them"}.
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

/**
 * The honest two-column outcome. `created` and `skipped` are independent —
 * showing only the first would quietly lose candidates the user believes they
 * imported, which is the whole reason the endpoint reports per row.
 */
function ImportSummary({ result }: { result: BulkConfirmResult }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />
          {result.created.length} created
        </span>
        {result.skipped.length > 0 ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-muted-foreground">
            <AlertTriangle className="h-4 w-4" />
            {result.skipped.length} skipped
          </span>
        ) : null}
      </div>

      {result.created.length > 0 ? (
        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Created
          </h4>
          <ul className="space-y-1">
            {result.created.map((row) => (
              <li
                key={row.candidateId}
                className="flex flex-wrap items-baseline gap-x-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <span className="font-medium">{row.fullName}</span>
                <span className="text-xs text-muted-foreground">{row.email}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {result.skipped.length > 0 ? (
        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Skipped
          </h4>
          <ul className="space-y-1">
            {result.skipped.map((row, index) => (
              <li
                key={`${row.email}-${index}`}
                className="flex flex-wrap items-baseline justify-between gap-x-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{row.fullName}</span>
                  <span className="text-xs text-muted-foreground">{row.email}</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {SKIP_REASON_LABELS[row.reason as BulkConfirmSkipReason] ?? row.reason}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted-foreground">
            Skipped rows created nothing — nothing to undo. Re-upload after fixing the
            email, or open the existing candidate if they already applied to this job.
          </p>
        </div>
      ) : null}
    </div>
  )
}
