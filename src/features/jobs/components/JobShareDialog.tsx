import { useState, type KeyboardEvent } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import {
  AlertTriangle,
  Link as LinkIcon,
  Loader2,
  Mail,
  Send,
  X,
} from "lucide-react"
import toast from "react-hot-toast"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { CopyButton } from "@/components/common/CopyButton"
import { getJobShareLink, sendJobInvites } from "@/features/jobs/jobsApi"
import { errorMessage as apiError } from "@/lib/errors"
import { cn } from "@/lib/utils"

const MAX_EMAILS = 25
// Kept in step with the backend's `@IsEmail({}, { each: true })` on
// SendJobInvitesDto: the DTO validates the whole array, so a single address that
// passes a looser client check but fails validator.js 400s the ENTIRE batch —
// every valid recipient in the same send is dropped, and the class-validator
// message never names the offender. This mirrors validator.js's common domain
// rejections (empty/leading/trailing dots, a 1-char TLD, leading/trailing-hyphen
// labels) so the chip-commit toast rejects the bad address by name before it can
// ever reach the send.
const EMAIL_RE =
  /^[^\s@]+@(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/

interface JobShareDialogProps {
  jobId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Job share modal. Two cards side by side:
 *   - Invite by email (chip input + send)
 *   - Share the public interview link (copy)
 * Mirrors the jobjen design; QR-code affordance omitted for now.
 */
export function JobShareDialog({ jobId, open, onOpenChange }: JobShareDialogProps) {
  const linkQuery = useQuery({
    queryKey: ["jobShareLink", jobId],
    queryFn: () => getJobShareLink(jobId),
    enabled: open,
  })

  const sendMutation = useMutation({
    mutationFn: (emails: string[]) => sendJobInvites(jobId, emails),
    onSuccess: (res) => {
      toast.success(res.message)
      setEmails([])
    },
    onError: (err) => toast.error(apiError(err, "Could not send invites.")),
  })

  const [emails, setEmails] = useState<string[]>([])
  const [draft, setDraft] = useState("")

  const commitDraft = () => {
    const raw = draft.split(/[,;\s]+/).map((v) => v.trim()).filter(Boolean)
    if (raw.length === 0) return
    setEmails((prev) => {
      const next = new Set(prev.map((v) => v.toLowerCase()))
      const merged = [...prev]
      for (const value of raw) {
        const lower = value.toLowerCase()
        if (!EMAIL_RE.test(lower)) {
          toast.error(`"${value}" is not a valid email.`)
          continue
        }
        if (next.has(lower)) continue
        if (merged.length >= MAX_EMAILS) {
          toast.error(`Limit reached — up to ${MAX_EMAILS} emails per send.`)
          break
        }
        next.add(lower)
        merged.push(lower)
      }
      return merged
    })
    setDraft("")
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "," || e.key === ";") {
      e.preventDefault()
      commitDraft()
    } else if (e.key === "Backspace" && draft === "" && emails.length > 0) {
      setEmails((prev) => prev.slice(0, -1))
    }
  }

  const handleSend = () => {
    commitDraft()
    if (emails.length === 0) {
      toast.error("Add at least one email.")
      return
    }
    sendMutation.mutate(emails)
  }

  const shareUrl = linkQuery.data?.url ?? ""
  // The apply portal only serves an application form for OPEN jobs — a link to a
  // draft/closed/archived job resolves to its "not available" gate (or a 404 for
  // a draft). The backend builds the URL regardless of status, so we gate the
  // whole dialog — copy AND email invite — on the status it already returns,
  // rather than hand out a link that silently dead-ends for the candidate.
  const status = linkQuery.data?.status
  const isNonOpen = status !== undefined && status !== "open"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideCloseButton className="sm:max-w-3xl">
        <div className="mb-1 flex items-start justify-between gap-4">
          <div>
            <DialogTitle className="text-[18px]">Share this job</DialogTitle>
            <DialogDescription className="mt-1 text-[13px]">
              {linkQuery.data?.jobTitle ? (
                <>
                  Send the invite link for{" "}
                  <span className="font-semibold text-ink">
                    {linkQuery.data.jobTitle}
                  </span>{" "}
                  to candidates
                  {isNonOpen ? "." : " - anyone with the link can apply."}
                </>
              ) : isNonOpen ? (
                "Send the invite link to candidates."
              ) : (
                "Send the invite link to candidates — anyone with the link can apply."
              )}
            </DialogDescription>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={() => onOpenChange(false)}
            className="rounded-md p-1 text-ink-muted transition hover:bg-surface-3 hover:text-ink"
          >
            <X className="h-4 w-4" strokeWidth={1.9} />
          </button>
        </div>

        {isNonOpen ? (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-[var(--warning)]/40 bg-[var(--warning-soft)] px-3 py-2">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]"
              strokeWidth={1.9}
            />
            <p className="text-[12.5px] text-[var(--warning)]">
              {status === "draft"
                ? "This job isn't published yet — the link won't work for candidates until you publish it."
                : `This job isn't open (${status}) — the link won't work for candidates until it's reopened.`}
            </p>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Invite by email */}
          <section className="flex flex-col rounded-xl border border-line bg-surface p-4">
            <header className="mb-3 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-primary">
                <Mail className="h-4 w-4" strokeWidth={1.8} />
              </span>
              <div className="min-w-0">
                <h3 className="text-[13.5px] font-semibold text-ink">
                  Invite by email
                </h3>
                <p className="text-[12px] text-ink-muted">
                  Send the apply link straight to their inbox.
                </p>
              </div>
            </header>

            <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-[var(--field-border)] bg-surface px-2 py-1.5 focus-within:border-primary">
              {emails.map((email) => (
                <span
                  key={email}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-accent py-1 pl-3 pr-1.5 text-[12.5px] font-semibold text-primary"
                >
                  <span className="truncate" title={email}>{email}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${email}`}
                    onClick={() =>
                      setEmails((prev) => prev.filter((v) => v !== email))
                    }
                    className="inline-flex h-4 w-4 items-center justify-center rounded-full text-primary hover:bg-primary/10"
                  >
                    <X className="h-3 w-3" strokeWidth={2} />
                  </button>
                </span>
              ))}
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={commitDraft}
                placeholder={
                  emails.length === 0 ? "Type an email and press Enter" : ""
                }
                className="min-w-[140px] flex-1 border-0 bg-transparent text-[13.5px] text-ink outline-0 placeholder:text-ink-subtle"
              />
            </div>
            <p className="mt-1.5 text-[11.5px] text-ink-muted">
              Up to {MAX_EMAILS} per send. Enter, comma, or space separates them.
            </p>

            <Button
              type="button"
              size="sm"
              className="mt-3 w-full"
              onClick={handleSend}
              disabled={
                sendMutation.isPending || emails.length === 0 || isNonOpen
              }
            >
              {sendMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" strokeWidth={1.9} />
                  Send {emails.length > 0 ? `${emails.length} ` : ""}
                  invite{emails.length === 1 ? "" : "s"}
                </>
              )}
            </Button>
          </section>

          {/* Share link */}
          <section className="flex flex-col rounded-xl border border-line bg-surface p-4">
            <header className="mb-3 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-primary">
                <LinkIcon className="h-4 w-4" strokeWidth={1.8} />
              </span>
              <div className="min-w-0">
                <h3 className="text-[13.5px] font-semibold text-ink">
                  Share interview link
                </h3>
                <p className="text-[12px] text-ink-muted">
                  {isNonOpen
                    ? "The link goes live once this job is open."
                    : "Anyone with the link can apply."}
                </p>
              </div>
            </header>

            <div
              className={cn(
                "flex min-h-11 items-center gap-2 overflow-hidden rounded-lg border border-line bg-surface-3 px-3 py-2",
              )}
            >
              {linkQuery.isLoading ? (
                <div className="flex items-center gap-2 text-[13px] text-ink-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Building link…
                </div>
              ) : linkQuery.isError ? (
                <div className="text-[12.5px] text-[var(--danger)]">
                  Could not load link.
                </div>
              ) : isNonOpen ? (
                // The URL dead-ends at the apply portal's "not available" gate
                // while the job isn't open, so we withhold the copy affordance
                // rather than let it be handed out.
                <div className="flex items-center gap-2 text-[12.5px] text-ink-muted">
                  <LinkIcon className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                  The share link activates once this job is open.
                </div>
              ) : (
                <>
                  <span
                    className="mono flex-1 truncate text-[12.5px] text-ink"
                    title={shareUrl}
                  >
                    {shareUrl}
                  </span>
                  <CopyButton value={shareUrl} label="share link" />
                </>
              )}
            </div>
            <p className="mt-2 text-[11.5px] text-ink-muted">
              {isNonOpen
                ? "It won't reach candidates until the job is open."
                : "Post it anywhere — a job board, a Slack message, a QR code."}
            </p>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
