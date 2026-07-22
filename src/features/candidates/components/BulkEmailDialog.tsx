import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Loader2, Plus } from "lucide-react"
import toast from "react-hot-toast"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  fetchEmailTemplates,
  previewEmailTemplate,
  type EmailTemplateItem,
} from "@/features/organization/emailTemplatesApi"
import { sendCandidateEmail } from "@/features/candidates/candidatesApi"
import type { BulkEmailPurpose } from "@/features/candidates/types"
import { errorMessage } from "@/lib/errors"

/**
 * Which candidate templates this compose dialog offers, in display order.
 * Job-share is excluded (it targets a job's apply URL, not a candidate).
 * Reminder leads because manual interview reminders are the primary use.
 */
const ALLOWED_PURPOSES: BulkEmailPurpose[] = [
  "followup",
  "invite",
  "shortlist",
  "rejection",
]

const inputBase =
  "h-11 w-full rounded-lg border border-[var(--field-border)] bg-surface px-3.5 text-[14px] text-ink outline-none placeholder:text-ink-subtle focus:border-primary focus:shadow-[0_0_0_3px_var(--accent-ring)]"

/**
 * Compose + send one email template to a set of candidates. HR picks a
 * template, edits the copy (with a live server preview so it matches the sent
 * mail byte-for-byte), and sends. INVITE / FOLLOWUP re-mint each recipient's
 * interview link server-side; the send is per-candidate, so partial success is
 * reported rather than failing the whole batch. Used for both a multi-select
 * bulk send and a single candidate.
 */
export function BulkEmailDialog({
  open,
  onOpenChange,
  candidateIds,
  recipientLabel,
  onSent,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  candidateIds: string[]
  /** Human recipient summary, e.g. "8 candidates" or a single name. */
  recipientLabel: string
  onSent?: () => void
}) {
  const count = candidateIds.length

  const query = useQuery({
    queryKey: ["email-templates"],
    queryFn: fetchEmailTemplates,
    enabled: open,
  })
  // Only the candidate-facing templates, in ALLOWED_PURPOSES order.
  const templates = useMemo(() => {
    const all = query.data?.templates ?? []
    return ALLOWED_PURPOSES.map((p) =>
      all.find((t) => t.purpose === p),
    ).filter((t): t is EmailTemplateItem => Boolean(t))
  }, [query.data])

  const [purpose, setPurpose] = useState<string>("")
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [activeField, setActiveField] = useState<"subject" | "body">("body")
  const subjectRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  const selected: EmailTemplateItem | undefined = useMemo(
    () => templates.find((t) => t.purpose === purpose) ?? templates[0],
    [templates, purpose],
  )

  // Seed the editor from the chosen template. Keyed by purpose so switching
  // templates loads that template's copy.
  const seededFor = useRef<string | null>(null)
  useEffect(() => {
    if (!selected) return
    if (seededFor.current === selected.purpose) return
    seededFor.current = selected.purpose
    setPurpose(selected.purpose)
    setSubject(selected.subject)
    setBody(selected.body)
  }, [selected])

  // Reset to a fresh compose each time the dialog is reopened.
  useEffect(() => {
    if (!open) {
      seededFor.current = null
      setPurpose("")
    }
  }, [open])

  // ── Live preview (debounced, server-rendered so it matches the sent mail) ──
  const [previewHtml, setPreviewHtml] = useState("")
  const [previewSubject, setPreviewSubject] = useState("")
  const [previewing, setPreviewing] = useState(false)
  const previewKeyRef = useRef("")
  useEffect(() => {
    if (!open || !selected) return
    const key = `${selected.purpose} ${subject} ${body}`
    if (key === previewKeyRef.current) return

    let cancelled = false
    const id = setTimeout(() => {
      setPreviewing(true)
      previewEmailTemplate({ purpose: selected.purpose, subject, body })
        .then((r) => {
          if (cancelled) return
          previewKeyRef.current = key
          setPreviewHtml(r.html)
          setPreviewSubject(r.subject)
        })
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) setPreviewing(false)
        })
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(id)
    }
  }, [open, selected, subject, body])

  const sendMutation = useMutation({
    mutationFn: () =>
      sendCandidateEmail({
        candidateIds,
        purpose: purpose as BulkEmailPurpose,
        subject,
        body,
      }),
    onSuccess: (res) => {
      const firstReason = res.skipped[0]?.reason
      if (res.sent > 0 && res.skipped.length === 0) {
        toast.success(
          `Email sent to ${res.sent} candidate${res.sent === 1 ? "" : "s"}.`,
        )
      } else if (res.sent > 0) {
        toast.success(
          `Sent to ${res.sent}, skipped ${res.skipped.length}.` +
            (firstReason ? ` First skip: ${firstReason}` : ""),
        )
      } else {
        toast.error(
          firstReason
            ? `Nothing sent. ${firstReason}`
            : "No emails could be sent.",
        )
      }
      onSent?.()
      onOpenChange(false)
    },
    onError: (err) =>
      toast.error(errorMessage(err, "Could not send the email.")),
  })

  /** Insert text at the cursor of the active field. */
  const insertAtCursor = (text: string) => {
    if (activeField === "subject") {
      const el = subjectRef.current
      const at = el?.selectionStart ?? subject.length
      setSubject(subject.slice(0, at) + text + subject.slice(at))
      requestAnimationFrame(() => {
        el?.focus()
        el?.setSelectionRange(at + text.length, at + text.length)
      })
    } else {
      const el = bodyRef.current
      const at = el?.selectionStart ?? body.length
      setBody(body.slice(0, at) + text + body.slice(at))
      requestAnimationFrame(() => {
        el?.focus()
        el?.setSelectionRange(at + text.length, at + text.length)
      })
    }
  }

  const canSend =
    count > 0 &&
    Boolean(subject.trim()) &&
    Boolean(body.trim()) &&
    !sendMutation.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Send email</DialogTitle>
          <DialogDescription>
            Sending to {recipientLabel}. Reminders and invites include each
            candidate&apos;s own interview link. This does not change their
            status.
          </DialogDescription>
        </DialogHeader>

        {query.isLoading ? (
          <div className="flex items-center gap-2 py-8 text-[13.5px] text-ink-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading templates...
          </div>
        ) : templates.length === 0 ? (
          <p className="py-8 text-[13.5px] text-[var(--danger)]">
            Could not load the email templates. Please try again.
          </p>
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            {/* Compose */}
            <div>
              {/* Template picker */}
              <div className="scroll mb-4 flex w-fit max-w-full gap-1 overflow-x-auto rounded-full border border-line bg-surface-3 p-1">
                {templates.map((t) => {
                  const isActive = t.purpose === selected?.purpose
                  return (
                    <button
                      key={t.purpose}
                      type="button"
                      onClick={() => {
                        seededFor.current = null
                        setPurpose(t.purpose)
                      }}
                      className={
                        "shrink-0 whitespace-nowrap rounded-full px-3.5 py-2 text-[13px] font-semibold transition-colors " +
                        (isActive
                          ? "bg-surface text-primary shadow-sm"
                          : "text-ink-muted hover:text-ink")
                      }
                    >
                      {t.label}
                    </button>
                  )
                })}
              </div>

              <label className="mb-1.5 block text-[13px] font-semibold text-ink">
                Subject
              </label>
              <input
                ref={subjectRef}
                className={inputBase}
                value={subject}
                onFocus={() => setActiveField("subject")}
                onChange={(e) => setSubject(e.target.value)}
              />

              <label className="mb-1.5 mt-4 block text-[13px] font-semibold text-ink">
                Body
              </label>
              <textarea
                ref={bodyRef}
                rows={10}
                className={
                  inputBase.replace("h-11", "min-h-[220px]") +
                  " resize-y py-3 font-mono text-[13px] leading-relaxed"
                }
                value={body}
                onFocus={() => setActiveField("body")}
                onChange={(e) => setBody(e.target.value)}
              />

              {/* Merge fields + button inserter */}
              <div className="mt-3">
                <div className="mb-1.5 text-[12px] font-semibold text-ink-subtle">
                  Merge fields (insert into {activeField})
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(selected?.variables ?? []).map((v) => (
                    <button
                      key={v.token}
                      type="button"
                      title={v.label}
                      onClick={() => insertAtCursor(`{{${v.token}}}`)}
                      className="rounded-md border border-[var(--line-2)] bg-surface-2 px-2 py-1 font-mono text-[11.5px] text-ink-2 transition hover:border-primary/40 hover:bg-hover"
                    >
                      {`{{${v.token}}}`}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      insertAtCursor(
                        "\n\n[[button: Button label | https://example.com]]",
                      )
                    }
                    className="inline-flex items-center gap-1 rounded-md border border-[var(--line-2)] bg-surface-2 px-2 py-1 text-[11.5px] font-medium text-ink-2 transition hover:border-primary/40 hover:bg-hover"
                  >
                    <Plus className="h-3 w-3" /> Button
                  </button>
                </div>
                <p className="mt-2 text-[11.5px] text-ink-subtle">
                  A field left with no value keeps its {"{{token}}"} visible. Put
                  a button on its own line as [[button: Label | url]].
                </p>
              </div>
            </div>

            {/* Live preview */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[13px] font-semibold text-ink">
                  Live preview
                </span>
                {previewing ? (
                  <span className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-muted">
                    <Loader2 className="h-3 w-3 animate-spin" /> Updating
                  </span>
                ) : null}
              </div>
              <div className="overflow-hidden rounded-2xl border border-line bg-white">
                {previewSubject ? (
                  <div className="flex items-baseline gap-2.5 border-b border-[#edecf2] bg-[#fbfbfd] px-5 py-3.5">
                    <span className="shrink-0 text-[12px] font-medium text-[#9a96a4]">
                      Subject
                    </span>
                    <span
                      className="truncate text-[14px] font-semibold text-[#1a1622]"
                      title={previewSubject}
                    >
                      {previewSubject}
                    </span>
                  </div>
                ) : null}
                <iframe
                  title="Email preview"
                  sandbox=""
                  srcDoc={previewHtml}
                  className="h-[440px] w-full"
                />
              </div>
              <p className="mt-2 text-[11.5px] text-ink-subtle">
                Preview uses sample values. Each candidate gets their own name,
                job and link.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={sendMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!canSend}
            onClick={() => sendMutation.mutate()}
          >
            {sendMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : null}
            Send to {count}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
