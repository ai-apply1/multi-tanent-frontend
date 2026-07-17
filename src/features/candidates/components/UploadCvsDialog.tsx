import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import toast from "react-hot-toast"
import {
  AlertTriangle,
  CheckCircle2,
  FileArchive,
  FileText,
  Loader2,
  Sparkles,
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
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  bulkConfirmCvs,
  bulkExtractCvs,
  bulkPresignCvs,
  uploadCvToPresignedUrl,
} from "@/features/candidates/candidatesApi"
import {
  ALLOWED_CV_CONTENT_TYPES,
  BULK_EXTRACT_BATCH,
  EXTRACT_ERROR_LABELS,
  MAX_CV_UPLOAD_FILES,
  SKIP_REASON_LABELS,
  type AllowedCvContentType,
  type BulkConfirmResult,
  type BulkConfirmSkipReason,
  type BulkExtractError,
} from "@/features/candidates/types"
import { extractCvsFromZip, isZipFile } from "@/features/candidates/unzipCvs"
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

const ACCEPT_ATTR = ".pdf,.doc,.docx,.zip"

function contentTypeFor(file: File): AllowedCvContentType | null {
  if ((ALLOWED_CV_CONTENT_TYPES as readonly string[]).includes(file.type)) {
    return file.type as AllowedCvContentType
  }
  const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
  return CONTENT_TYPE_BY_EXTENSION[ext] ?? null
}

/**
 * "Jane Doe - CV (2).pdf" → "Jane Doe".
 *
 * Only a fallback now: the extractor reads the real name off the CV. This
 * still matters when the CV has no readable name, because a filename guess
 * beats an empty box.
 */
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

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** Per-file state through presign → PUT → extract → confirm. */
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
  /** Set once the PUT lands; the only linkage to the S3 object. */
  cvKey: string | null
  /** Why the CV couldn't be READ (distinct from an upload failure). */
  extractError: BulkExtractError | string | null
}

/**
 * select → review → summary.
 *
 * The split exists because the CVs must be IN S3 before the extractor can
 * read them, but the rows must be reviewed before they become candidates.
 * Nothing is created until the review is confirmed.
 */
type Phase = "select" | "review" | "summary"

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
 * Bulk CV import: (ZIP →) presign → direct-to-S3 PUT → AI extract → review
 * → confirm.
 *
 * The API never touches the files — it mints presigned PUTs and later
 * receives the keys back. That's also why the halves can disagree: a PUT can
 * fail locally (reported here), a CV can upload fine but be unreadable
 * (reported per row), and the confirm can still skip a row server-side
 * (duplicate email, key outside this job's prefix). All three are rendered;
 * none is swallowed.
 *
 * The review step is not a formality. The extractor is told to return ""
 * rather than guess, but it can still misread — and a wrong email means a
 * real stranger receives an interview invite or a rejection, which cannot be
 * unsent. A human confirms every address before any row exists.
 */
export function UploadCvsDialog({
  open,
  onOpenChange,
  jobId,
  jobTitle,
  onImported,
}: Props) {
  const [phase, setPhase] = useState<Phase>("select")
  const [rows, setRows] = useState<UploadRow[]>([])
  const [touched, setTouched] = useState<Set<string>>(new Set())
  const [result, setResult] = useState<BulkConfirmResult | null>(null)
  const [unzipping, setUnzipping] = useState(false)
  const [readProgress, setReadProgress] = useState({ done: 0, total: 0 })
  const [selectedJobId, setSelectedJobId] = useState(jobId)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Fresh dialog every time: a previous run's rows/result must not leak into
  // the next import (and a stale `result` would show the summary screen for a
  // batch the user never sent).
  useEffect(() => {
    if (!open) return
    setPhase("select")
    setRows([])
    setTouched(new Set())
    setResult(null)
    setUnzipping(false)
    setReadProgress({ done: 0, total: 0 })
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
    const openJobs = all.filter((j) => j.status === "open")
    // If the caller's job isn't open (rare — the caller should have blocked
    // opening this dialog) show it anyway so the picker isn't visibly empty
    // of the "current" job.
    if (jobId && !openJobs.some((j) => j._id === jobId)) {
      const passed = all.find((j) => j._id === jobId)
      if (passed) return [passed, ...openJobs]
    }
    return openJobs
  }, [jobsQuery.data, jobId])

  const appendFiles = (incoming: File[], rejectedCount: number) => {
    const built: UploadRow[] = []
    let rejected = rejectedCount
    for (const file of incoming) {
      const contentType = contentTypeFor(file)
      if (!contentType) {
        rejected += 1
        continue
      }
      built.push({
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
        cvKey: null,
        extractError: null,
      })
    }
    if (rejected > 0) {
      toast.error(
        `Skipped ${rejected} file${rejected === 1 ? "" : "s"} — only PDF, DOC and DOCX are accepted.`
      )
    }
    setRows((prev) => {
      const room = MAX_CV_UPLOAD_FILES - prev.length
      if (built.length > room) {
        toast.error(
          `You can import ${MAX_CV_UPLOAD_FILES} CVs at a time — the extra ${
            built.length - room
          } were left out.`
        )
      }
      return [...prev, ...built.slice(0, Math.max(room, 0))]
    })
  }

  const addFiles = async (fileList: FileList | null) => {
    if (!fileList?.length) return
    const picked = Array.from(fileList)
    const zips = picked.filter(isZipFile)
    const loose = picked.filter((f) => !isZipFile(f))

    if (zips.length === 0) {
      appendFiles(loose, 0)
      return
    }

    // A ZIP is expanded here, in the browser — the server has no endpoint
    // that takes an archive (see unzipCvs.ts).
    setUnzipping(true)
    try {
      const fromZips: File[] = []
      let skipped = 0
      let truncated = false
      for (const zip of zips) {
        try {
          const out = await extractCvsFromZip(zip)
          fromZips.push(...out.files)
          skipped += out.skipped
          truncated = truncated || out.truncated
        } catch (err) {
          toast.error(errorMessage(err, `Could not open ${zip.name}.`))
        }
      }
      if (truncated) {
        toast.error("That archive was too large — only part of it was read.")
      }
      if (fromZips.length === 0 && skipped === 0) {
        toast.error("No PDF, DOC or DOCX files were found in that ZIP.")
      }
      appendFiles([...loose, ...fromZips], skipped)
    } finally {
      setUnzipping(false)
    }
  }

  const patchRow = (id: string, patch: Partial<UploadRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  const removeRow = (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id))
  }

  const emailError = (row: UploadRow): string | null => {
    if (!row.email.trim()) return "Email is required — the CV didn't have one."
    if (!EMAIL_RE.test(row.email.trim())) return "Enter a valid email."
    return null
  }

  const nameError = (row: UploadRow): string | null =>
    row.fullName.trim() ? null : "Name is required."

  const phoneError = (row: UploadRow): string | null =>
    row.phone.trim() ? null : "Phone is required — the CV didn't have one."

  /**
   * City is required because the job's city gate compares against it. A CV
   * that doesn't say where someone lives can't be gated, so the import
   * stops here rather than guessing.
   */
  const cityError = (row: UploadRow): string | null =>
    row.city.trim() ? null : "City is required — the CV didn't have one."

  const rowIncomplete = (row: UploadRow): boolean =>
    Boolean(emailError(row) || nameError(row) || phoneError(row) || cityError(row))

  /** Only uploaded rows can become candidates — a failed PUT has no key. */
  const importable = rows.filter((r) => r.status === "uploaded" && r.cvKey)
  const needsAttention = importable.filter(rowIncomplete)
  const canImport = importable.length > 0 && needsAttention.length === 0

  /** Phase 1: upload every file, then read them all. */
  const readMutation = useMutation({
    mutationFn: async (): Promise<void> => {
      // 1. Presign — one URL per file, same order as we sent them. Identity
      //    fields are omitted on purpose: we don't know them yet, and they
      //    are informational at presign anyway (fixed at confirm).
      const presigned = await bulkPresignCvs(
        selectedJobId,
        rows.map((r) => ({ fileName: r.file.name, contentType: r.contentType }))
      )

      setRows((prev) =>
        prev.map((r) => ({ ...r, status: "uploading", progress: 0, error: null }))
      )

      // 2. Direct-to-S3 PUTs. `allSettled`, not `all`: one dead upload must
      //    not cancel the other 49 — the survivors still get read below.
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
          patchRow(row.id, { status: "uploaded", progress: 100, cvKey: outcome.value.key })
        } else {
          patchRow(row.id, {
            status: "failed",
            error: errorMessage(outcome.reason, "Upload to storage failed."),
          })
        }
      })

      if (uploaded.length === 0) {
        throw new Error("Every upload failed — no CVs could be read.")
      }

      // 3. Read them. Sequential small batches, so the progress counter is
      //    real and one failed batch costs 5 rows, not the whole import.
      setReadProgress({ done: 0, total: uploaded.length })
      let done = 0
      for (const batch of chunk(uploaded, BULK_EXTRACT_BATCH)) {
        try {
          const out = await bulkExtractCvs(
            selectedJobId,
            batch.map(({ key }) => key)
          )
          const byKey = new Map(out.map((r) => [r.cvKey, r]))
          setRows((prev) =>
            prev.map((r) => {
              const got = r.cvKey ? byKey.get(r.cvKey) : undefined
              if (!got) return r
              return {
                ...r,
                // An empty extracted name falls back to the filename guess;
                // an empty email stays empty ON PURPOSE — that's the signal
                // the admin must type it, and a guess here reaches a real
                // person.
                fullName: got.fullName || r.fullName,
                email: got.email,
                phone: got.phone,
                city: got.city,
                extractError: got.error,
              }
            })
          )
        } catch (err) {
          const message = errorMessage(err, "Couldn't read this file")
          const ids = new Set(batch.map(({ row }) => row.id))
          setRows((prev) =>
            prev.map((r) => (ids.has(r.id) ? { ...r, extractError: message } : r))
          )
        }
        done += batch.length
        setReadProgress({ done, total: uploaded.length })
      }
    },
    onSuccess: () => setPhase("review"),
    onError: (err: unknown) => {
      // The job flipping out of `open` mid-dialog lands here as a 422 whose
      // message names the actual status — worth reading, so pass it through.
      toast.error(errorMessage(err, "Could not upload the CVs."))
    },
  })

  /** Phase 2: create the rows the human just approved. */
  const importMutation = useMutation({
    mutationFn: async (): Promise<BulkConfirmResult> =>
      bulkConfirmCvs(
        selectedJobId,
        // phone/city are unconditional now — they're required server-side,
        // and `canImport` already blocked the empty ones.
        importable.map((row) => ({
          fullName: row.fullName.trim(),
          email: row.email.trim(),
          phone: row.phone.trim(),
          city: row.city.trim(),
          cvKey: row.cvKey as string,
        }))
      ),
    onSuccess: (res) => {
      setResult(res)
      setPhase("summary")
      if (res.created.length > 0) {
        toast.success(
          `Imported ${res.created.length} candidate${res.created.length === 1 ? "" : "s"}.`
        )
        onImported()
      }
    },
    onError: (err: unknown) => {
      toast.error(errorMessage(err, "Could not import the candidates."))
    },
  })

  const busy = readMutation.isPending || importMutation.isPending || unzipping
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
              {phase === "review" ? "Check the details" : "Upload CVs"}
            </DialogTitle>
            <DialogDescription className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
              {phase === "summary" ? (
                <>Import summary for {jobTitle}.</>
              ) : phase === "review" ? (
                <>
                  Read from {importable.length} CV{importable.length === 1 ? "" : "s"}. Fix
                  anything wrong before importing — the email is where the interview invite
                  (or rejection) goes, and it can't be unsent.
                </>
              ) : (
                <>
                  Add up to {MAX_CV_UPLOAD_FILES} CVs — drop a{" "}
                  <strong>ZIP</strong> or pick files. Each becomes a candidate at{" "}
                  <em>Applied</em>, and the CV is parsed and pre-screened automatically. PDF,
                  DOC and DOCX only.
                </>
              )}
            </DialogDescription>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-6 pb-5">
          {phase === "summary" && result ? (
            <ImportSummary result={result} />
          ) : (
            <>
              {phase === "select" ? (
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
                      void addFiles(e.dataTransfer.files)
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
                        {unzipping ? (
                          <Loader2
                            className="h-[22px] w-[22px] animate-spin"
                            strokeWidth={1.7}
                          />
                        ) : (
                          <UploadCloud
                            className="h-[22px] w-[22px]"
                            strokeWidth={1.7}
                          />
                        )}
                      </span>
                      <span className="text-[14px] font-semibold text-ink">
                        {unzipping ? "Opening ZIP…" : "Drag & drop CVs here"}
                      </span>
                      <span className="mt-1.5 text-[12.5px] text-ink-muted">
                        {rows.length > 0
                          ? `${rows.length} of ${MAX_CV_UPLOAD_FILES} selected`
                          : `or click to browse · ZIP, PDF or DOCX, up to ${MAX_CV_UPLOAD_FILES} files`}
                      </span>
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept={ACCEPT_ATTR}
                      className="hidden"
                      onChange={(e) => {
                        void addFiles(e.target.files)
                        // Reset so re-picking the same file fires `change` again.
                        e.target.value = ""
                      }}
                    />
                  </div>
                </>
              ) : null}

              {phase === "select" ? (
                rows.length === 0 ? (
                  <p className="text-center text-[12px] text-ink-muted">
                    Drop a ZIP of CVs and the details are read from each one —
                    you check them on the next step before anything is created.
                  </p>
                ) : (
                  <SelectList rows={rows} busy={busy} onRemove={removeRow} />
                )
              ) : (
                <>
                  {needsAttention.length > 0 ? (
                    <div className="flex items-start gap-2 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger-soft)] px-3 py-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--danger)]" />
                      <p className="text-xs text-[var(--danger)]">
                        <strong>
                          {needsAttention.length} CV
                          {needsAttention.length === 1 ? "" : "s"}
                        </strong>{" "}
                        need a detail typed in — they're listed first. The rest are ready.
                      </p>
                    </div>
                  ) : null}

                  <div className="space-y-3">
                    {/* Rows needing a human float to the top — with 50 CVs, a
                        missing email 40 rows down is invisible otherwise. */}
                    {[...importable]
                      .sort(
                        (a, b) =>
                          Number(rowIncomplete(b)) - Number(rowIncomplete(a))
                      )
                      .map((row) => (
                        <ReviewRow
                          key={row.id}
                          row={row}
                          busy={busy}
                          incomplete={rowIncomplete(row)}
                          emailMsg={touched.has(row.id) ? emailError(row) : null}
                          nameMsg={touched.has(row.id) ? nameError(row) : null}
                          phoneMsg={touched.has(row.id) ? phoneError(row) : null}
                          cityMsg={touched.has(row.id) ? cityError(row) : null}
                          onPatch={(patch) => patchRow(row.id, patch)}
                          onTouch={() => setTouched((prev) => new Set(prev).add(row.id))}
                          onRemove={() => removeRow(row.id)}
                        />
                      ))}
                  </div>

                  {failedUploads.length > 0 ? (
                    <div className="space-y-1.5">
                      <h4 className="text-[11px] font-bold uppercase tracking-[0.05em] text-ink-subtle">
                        Didn't upload
                      </h4>
                      {failedUploads.map((row) => (
                        <div
                          key={row.id}
                          className="flex items-center justify-between gap-2 rounded-md border border-line px-3 py-2"
                        >
                          <span className="truncate text-xs text-ink" title={row.file.name}>
                            {row.file.name}
                          </span>
                          <span className="shrink-0 text-[11px] text-[var(--danger)]">
                            {row.error}
                          </span>
                        </div>
                      ))}
                      <p className="text-[11px] text-ink-muted">
                        These aren't part of the import. Close and try them again.
                      </p>
                    </div>
                  ) : null}
                </>
              )}

              {readMutation.isPending && readProgress.total > 0 ? (
                <div className="flex items-center justify-center gap-2 text-xs text-ink-muted">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  Reading CVs… {readProgress.done} of {readProgress.total}
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2.5 border-t border-line px-6 py-4">
          {phase === "summary" ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : phase === "review" ? (
            <>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                // Not gated on `canImport`: clicking reveals every field
                // error at once, which is more useful than a dead button.
                disabled={importable.length === 0 || busy}
                onClick={() => {
                  setTouched(new Set(importable.map((r) => r.id)))
                  if (!canImport) return
                  importMutation.mutate()
                }}
              >
                {importMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Importing…
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    Import {importable.length}{" "}
                    {importable.length === 1 ? "candidate" : "candidates"}
                  </>
                )}
              </Button>
            </>
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
                disabled={rows.length === 0 || !selectedJobId || busy}
                onClick={() => readMutation.mutate()}
              >
                {readMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {readProgress.total > 0 ? "Reading…" : "Uploading…"}
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Upload and read {rows.length > 0 ? rows.length : ""}{" "}
                    {rows.length === 1 ? "CV" : "CVs"}
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

/** The pre-upload list: just what's about to be sent. Nothing to edit yet. */
function SelectList({
  rows,
  busy,
  onRemove,
}: {
  rows: UploadRow[]
  busy: boolean
  onRemove: (id: string) => void
}) {
  return (
    <div className="grid gap-2">
      {rows.map((row) => (
        <div
          key={row.id}
          className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2"
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
              <FileText className="h-4 w-4" strokeWidth={1.7} />
            </span>
            <span className="truncate text-[12.5px] font-medium text-ink" title={row.file.name}>
              {row.file.name}
            </span>
            <span className="shrink-0 text-[11px] text-ink-subtle">
              {formatBytes(row.file.size)}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {row.status === "uploading" ? (
              <span className="text-[11px] text-ink-muted">{row.progress}%</span>
            ) : null}
            {row.status === "uploaded" ? (
              <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />
            ) : null}
            {row.status === "failed" ? (
              <AlertTriangle className="h-4 w-4 text-[var(--danger)]" />
            ) : null}
            <button
              type="button"
              disabled={busy}
              onClick={() => onRemove(row.id)}
              aria-label={`Remove ${row.file.name}`}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-subtle transition-colors hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] disabled:pointer-events-none disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

/** One extracted candidate, fully editable. */
function ReviewRow({
  row,
  busy,
  incomplete,
  emailMsg,
  nameMsg,
  phoneMsg,
  cityMsg,
  onPatch,
  onTouch,
  onRemove,
}: {
  row: UploadRow
  busy: boolean
  incomplete: boolean
  emailMsg: string | null
  nameMsg: string | null
  phoneMsg: string | null
  cityMsg: string | null
  onPatch: (patch: Partial<UploadRow>) => void
  onTouch: () => void
  onRemove: () => void
}) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-surface p-3",
        incomplete ? "border-[var(--danger)]/50" : "border-line"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
            <FileArchive className="h-4 w-4" strokeWidth={1.7} />
          </span>
          <span className="truncate text-[12.5px] font-medium text-ink" title={row.file.name}>
            {row.file.name}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {row.extractError ? (
            <span className="text-[11px] text-[var(--danger)]">
              {EXTRACT_ERROR_LABELS[row.extractError as BulkExtractError] ??
                row.extractError}
            </span>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={onRemove}
            aria-label={`Remove ${row.file.name}`}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-subtle transition-colors hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] disabled:pointer-events-none disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`name-${row.id}`} className="text-xs text-ink">
            Name
          </Label>
          <Input
            id={`name-${row.id}`}
            value={row.fullName}
            disabled={busy}
            aria-invalid={Boolean(nameMsg)}
            maxLength={200}
            onChange={(e) => onPatch({ fullName: e.target.value })}
            onBlur={onTouch}
          />
          {nameMsg ? <p className="text-xs text-[var(--danger)]">{nameMsg}</p> : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`email-${row.id}`} className="text-xs text-ink">
            Email
          </Label>
          <Input
            id={`email-${row.id}`}
            type="email"
            value={row.email}
            disabled={busy}
            aria-invalid={Boolean(emailMsg)}
            maxLength={320}
            placeholder="Not found — type it"
            onChange={(e) => onPatch({ email: e.target.value })}
            onBlur={onTouch}
          />
          {emailMsg ? <p className="text-xs text-[var(--danger)]">{emailMsg}</p> : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`phone-${row.id}`} className="text-xs text-ink">
            Phone
          </Label>
          <Input
            id={`phone-${row.id}`}
            value={row.phone}
            disabled={busy}
            aria-invalid={Boolean(phoneMsg)}
            maxLength={40}
            placeholder="Not found — type it"
            onChange={(e) => onPatch({ phone: e.target.value })}
            onBlur={onTouch}
          />
          {phoneMsg ? <p className="text-xs text-[var(--danger)]">{phoneMsg}</p> : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`city-${row.id}`} className="text-xs text-ink">
            City
          </Label>
          <Input
            id={`city-${row.id}`}
            value={row.city}
            disabled={busy}
            aria-invalid={Boolean(cityMsg)}
            maxLength={120}
            placeholder="Not found — type it"
            onChange={(e) => onPatch({ city: e.target.value })}
            onBlur={onTouch}
          />
          {cityMsg ? <p className="text-xs text-[var(--danger)]">{cityMsg}</p> : null}
        </div>
      </div>
    </div>
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
