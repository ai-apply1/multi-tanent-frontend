import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
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
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import {
  JOB_OPTIONS_QUERY_KEY,
  listJobOptions,
} from "@/features/jobs/jobsApi"
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
  /** The initial import target — pre-selects the "Attach to job" picker. */
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
  const [selectedJobId, setSelectedJobId] = useState(jobId)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Fresh dialog every time: a previous run's rows/result must not leak into
  // the next import (and a stale `result` would show the summary screen for a
  // batch the user never sent).
  useEffect(() => {
    if (!open) return
    setRows([])
    setTouched(new Set())
    setResult(null)
    setSelectedJobId(jobId)
    setIsDragging(false)
  }, [open, jobId])

  // Open jobs only — closed/archived jobs 422 on presign.
  const jobsQuery = useQuery({
    queryKey: JOB_OPTIONS_QUERY_KEY,
    queryFn: listJobOptions,
    enabled: open,
    staleTime: 60_000,
  })

  const jobOptions = useMemo(() => {
    const all = jobsQuery.data ?? []
    const open = all.filter((j) => j.status === "open")
    // If the caller's job isn't open (rare — the caller should have blocked
    // opening this dialog) show it anyway so the picker isn't visibly empty
    // of the "current" job.
    if (jobId && !open.some((j) => j._id === jobId)) {
      const passed = all.find((j) => j._id === jobId)
      if (passed) return [passed, ...open]
    }
    return open
  }, [jobsQuery.data, jobId])

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
    Boolean(selectedJobId) &&
    rows.length > 0 &&
    rows.every((r) => !emailError(r) && !nameError(r))

  const uploadMutation = useMutation({
    mutationFn: async (): Promise<BulkConfirmResult> => {
      // 1. Presign — one URL per file, same order as we sent them.
      const presigned = await bulkPresignCvs(
        selectedJobId,
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
        selectedJobId,
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
      <DialogContent className="flex max-h-[90vh] max-w-[480px] flex-col gap-0 p-0">
        <div className="flex items-start justify-between gap-4 px-6 pt-[22px] pb-[14px]">
          <div className="min-w-0">
            <DialogTitle className="text-[18px] font-semibold leading-tight">
              Upload CVs
            </DialogTitle>
            <DialogDescription className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
              {result
                ? `Import summary for ${jobTitle}.`
                : "Drop resumes and Jobjen parses each into a candidate, runs the CV pre-screen, and emails an interview invite to anyone who clears the gates."}
            </DialogDescription>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-6 pb-5">
          {result ? (
            <ImportSummary result={result} />
          ) : (
            <>
              <div>
                <label
                  htmlFor="upl-job"
                  className="mb-1.5 block text-[13px] font-semibold text-ink"
                >
                  Attach to job
                </label>
                <Select
                  value={selectedJobId}
                  onValueChange={(v) => setSelectedJobId(v)}
                  disabled={busy || jobsQuery.isLoading}
                >
                  <SelectTrigger
                    id="upl-job"
                    className="h-11"
                    aria-label="Attach to job"
                  >
                    <SelectValue placeholder={jobTitle || "Select a job…"} />
                  </SelectTrigger>
                  <SelectContent>
                    {jobOptions.length === 0 ? (
                      <div className="px-2 py-2 text-[12.5px] text-ink-muted">
                        No open jobs.
                      </div>
                    ) : (
                      jobOptions.map((j) => (
                        <SelectItem key={j._id} value={j._id}>
                          {j.title}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <p className="mt-1.5 text-[12px] text-ink-muted">
                  New candidates are added to this job and screened against
                  its gates.
                </p>
              </div>

              <div
                onDragEnter={(e) => {
                  e.preventDefault()
                  if (!busy) setIsDragging(true)
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  if (!busy) setIsDragging(true)
                }}
                onDragLeave={(e) => {
                  // Only clear when leaving the drop zone itself, not a child.
                  if (e.currentTarget.contains(e.relatedTarget as Node)) return
                  setIsDragging(false)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  setIsDragging(false)
                  if (busy) return
                  addFiles(e.dataTransfer.files)
                }}
              >
                <button
                  type="button"
                  disabled={busy || rows.length >= MAX_CV_UPLOAD_FILES}
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    "flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-line-2 bg-surface-2 px-5 py-8 text-center transition-colors",
                    "hover:border-primary/60",
                    isDragging ? "border-primary bg-accent" : "",
                    "disabled:pointer-events-none disabled:opacity-50",
                  )}
                >
                  <span className="mb-3 inline-flex h-[46px] w-[46px] items-center justify-center rounded-xl bg-accent text-primary">
                    <UploadCloud
                      className="h-[22px] w-[22px]"
                      strokeWidth={1.7}
                    />
                  </span>
                  <span className="text-[14px] font-semibold text-ink">
                    Drag & drop PDFs here
                  </span>
                  <span className="mt-1.5 text-[12.5px] text-ink-muted">
                    or click to browse · PDF or DOCX, up to{" "}
                    {MAX_CV_UPLOAD_FILES} files
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
              </div>

              {rows.length === 0 ? (
                <p className="text-center text-[12px] text-ink-muted">
                  Name and email are required per CV — they're the candidate's
                  identity and the email is how the interview invite reaches
                  them.
                </p>
              ) : (
                <div className="grid gap-2.5">
                  {rows.map((row) => {
                    const isTouched = touched.has(row.id)
                    const emailMsg = isTouched ? emailError(row) : null
                    const nameMsg = isTouched ? nameError(row) : null
                    return (
                      <div
                        key={row.id}
                        className="rounded-xl border border-line bg-surface p-3"
                      >
                        <div className="flex items-start gap-2.5">
                          <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
                            <FileText className="h-4 w-4" strokeWidth={1.7} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span
                                className="truncate text-[12.5px] font-medium text-ink"
                                title={row.file.name}
                              >
                                {row.file.name}
                              </span>
                              <span className="shrink-0 text-[11px] text-ink-subtle">
                                {formatBytes(row.file.size)}
                              </span>
                            </div>

                            <div className="mt-2.5 grid gap-2">
                              <Input
                                value={row.fullName}
                                disabled={busy}
                                aria-invalid={Boolean(nameMsg)}
                                maxLength={200}
                                placeholder="Full name"
                                onChange={(e) =>
                                  patchRow(row.id, {
                                    fullName: e.target.value,
                                  })
                                }
                                onBlur={() =>
                                  setTouched((prev) =>
                                    new Set(prev).add(row.id),
                                  )
                                }
                                className="h-9 text-[13px]"
                              />
                              {nameMsg ? (
                                <p className="text-[11.5px] text-[var(--danger)]">
                                  {nameMsg}
                                </p>
                              ) : null}
                              <Input
                                type="email"
                                value={row.email}
                                disabled={busy}
                                aria-invalid={Boolean(emailMsg)}
                                maxLength={320}
                                placeholder="candidate@example.com"
                                onChange={(e) =>
                                  patchRow(row.id, { email: e.target.value })
                                }
                                onBlur={() =>
                                  setTouched((prev) =>
                                    new Set(prev).add(row.id),
                                  )
                                }
                                className="h-9 text-[13px]"
                              />
                              {emailMsg ? (
                                <p className="text-[11.5px] text-[var(--danger)]">
                                  {emailMsg}
                                </p>
                              ) : null}
                            </div>

                            {row.status === "uploading" ? (
                              <div className="mt-2.5">
                                <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                                  <div
                                    className="h-full rounded-full bg-primary transition-[width] duration-200"
                                    style={{ width: `${row.progress}%` }}
                                  />
                                </div>
                                <p className="mt-1 text-[11px] text-ink-muted">
                                  Uploading… {row.progress}%
                                </p>
                              </div>
                            ) : null}
                            {row.error ? (
                              <p className="mt-2 text-[11.5px] text-[var(--danger)]">
                                {row.error}
                              </p>
                            ) : null}
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            {row.status === "uploaded" ? (
                              <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />
                            ) : null}
                            {row.status === "failed" ? (
                              <AlertTriangle className="h-4 w-4 text-[var(--danger)]" />
                            ) : null}
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => removeRow(row.id)}
                              aria-label={`Remove ${row.file.name}`}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-subtle transition-colors hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] disabled:pointer-events-none disabled:opacity-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {failedUploads.length > 0 && !busy ? (
                <p className="text-[12px] text-[var(--danger)]">
                  {failedUploads.length} upload
                  {failedUploads.length === 1 ? "" : "s"} failed — remove or
                  retry {failedUploads.length === 1 ? "it" : "them"}.
                </p>
              ) : null}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2.5 border-t border-line px-6 py-4">
          {result ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                // Deliberately NOT gated on `canSubmit` alone: every row starts
                // with an empty (invalid) email, so a canSubmit-disabled button
                // would sit dead with no explanation. Clicking instead reveals
                // every field error at once — a fresh dialog stays clean until
                // the user actually asks to submit.
                disabled={rows.length === 0 || !selectedJobId || busy}
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
                    Upload & screen
                  </>
                )}
              </Button>
            </>
          )}
        </div>
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
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3 text-[13px]">
        <span className="inline-flex items-center gap-1.5 font-medium text-ink">
          <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />
          {result.created.length} created
        </span>
        {result.skipped.length > 0 ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-ink-muted">
            <AlertTriangle className="h-4 w-4" />
            {result.skipped.length} skipped
          </span>
        ) : null}
      </div>

      {result.created.length > 0 ? (
        <div className="grid gap-1.5">
          <h4 className="text-[11px] font-bold uppercase tracking-[0.05em] text-ink-subtle">
            Created
          </h4>
          <ul className="grid gap-1">
            {result.created.map((row) => (
              <li
                key={row.candidateId}
                className="flex flex-wrap items-baseline gap-x-2 rounded-lg border border-line px-3 py-2 text-[13px]"
              >
                <span className="font-medium text-ink">{row.fullName}</span>
                <span className="text-[12px] text-ink-muted">{row.email}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {result.skipped.length > 0 ? (
        <div className="grid gap-1.5">
          <h4 className="text-[11px] font-bold uppercase tracking-[0.05em] text-ink-subtle">
            Skipped
          </h4>
          <ul className="grid gap-1">
            {result.skipped.map((row, index) => (
              <li
                key={`${row.email}-${index}`}
                className="flex flex-wrap items-baseline justify-between gap-x-2 rounded-lg border border-line px-3 py-2 text-[13px]"
              >
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium text-ink">{row.fullName}</span>
                  <span className="text-[12px] text-ink-muted">
                    {row.email}
                  </span>
                </span>
                <span className="text-[12px] text-ink-muted">
                  {SKIP_REASON_LABELS[row.reason as BulkConfirmSkipReason] ??
                    row.reason}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-ink-muted">
            Skipped rows created nothing — nothing to undo. Re-upload after
            fixing the email, or open the existing candidate if they already
            applied to this job.
          </p>
        </div>
      ) : null}
    </div>
  )
}
