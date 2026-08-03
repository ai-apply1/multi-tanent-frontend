import { useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Linkedin,
  Loader2,
  Send,
  X,
} from "lucide-react"
import toast from "react-hot-toast"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { postJobToLinkedIn, removeJobFromLinkedIn } from "@/features/jobs/jobsApi"
import { getLinkedInStatus } from "@/features/integrations/integrationsApi"
import type { Job, JobLinkedIn } from "@/features/jobs/types"
import { settingsTab } from "@/routes"
import { errorCode, errorMessage as apiError } from "@/lib/errors"

/** LinkedIn's own limit: identical content can't be reposted for ~20 min after a delete. */
const REPOST_COOLDOWN_MS = 20 * 60 * 1000

const EMPTY_LINKEDIN: JobLinkedIn = {
  status: "none",
  postUrl: null,
  postUrn: null,
  postedAt: null,
  removedAt: null,
  lastError: null,
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

/**
 * The LinkedIn post control strip on a job's detail page. One horizontal strip:
 * status on the left, actions on the right.
 *
 *   - not posted   → "Post to LinkedIn" (checks the connection first; sends the
 *                    user to Settings → Integrations if it isn't connected/active,
 *                    otherwise posts right away)
 *   - posted       → "View post" + "Unpublish"
 *   - just removed → "Post to LinkedIn" disabled for 20 min, with LinkedIn's
 *                    duplicate-content policy explained inline (change content or wait)
 *
 * Connection management is NOT here — it lives on Settings → Integrations.
 */
export function JobLinkedInControls({ job }: { job: Job }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const linkedin = job.linkedin ?? EMPTY_LINKEDIN
  const jobId = job._id

  const [checking, setChecking] = useState(false)
  const [confirmUnpublish, setConfirmUnpublish] = useState(false)

  // Cooldown after an unpublish: LinkedIn refuses an identical repost for ~20
  // min. Driven by the server's `removedAt`, so it survives reloads and is
  // consistent across devices. Ticks each second while active.
  const removedAtMs = linkedin.removedAt
    ? new Date(linkedin.removedAt).getTime()
    : 0
  const cooldownUntil =
    linkedin.status === "removed" && removedAtMs
      ? removedAtMs + REPOST_COOLDOWN_MS
      : 0
  const [now, setNow] = useState(() => Date.now())
  const inCooldown = cooldownUntil > now
  useEffect(() => {
    if (!inCooldown) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [inCooldown])

  const patchLinkedIn = (patch: Partial<JobLinkedIn>) => {
    queryClient.setQueryData<Job>(["job", jobId], (prev) =>
      prev
        ? { ...prev, linkedin: { ...(prev.linkedin ?? EMPTY_LINKEDIN), ...patch } }
        : prev
    )
  }

  const publishMutation = useMutation({
    mutationFn: () => postJobToLinkedIn(jobId),
    onSuccess: (res) => {
      toast.success("Posted to LinkedIn.")
      patchLinkedIn({
        status: res.status,
        postUrl: res.postUrl,
        postUrn: res.postUrn,
        postedAt: res.postedAt,
        removedAt: null,
        lastError: null,
      })
      void queryClient.invalidateQueries({ queryKey: ["job", jobId] })
    },
    onError: (err) => {
      const code = errorCode(err)
      if (code === "LINKEDIN_NOT_CONNECTED") {
        toast.error("Connect LinkedIn in Settings to post.")
        navigate(settingsTab("integrations"))
        return
      }
      // Duplicate-content / any other error: show the backend's message (the
      // duplicate one already explains "change content or wait").
      toast.error(apiError(err, "Could not post to LinkedIn."))
      patchLinkedIn({ status: "failed", lastError: apiError(err, "") || null })
    },
  })

  const unpublishMutation = useMutation({
    mutationFn: () => removeJobFromLinkedIn(jobId),
    onSuccess: () => {
      toast.success("Removed from LinkedIn.")
      setConfirmUnpublish(false)
      // Optimistically stamp removedAt so the cooldown starts immediately; the
      // invalidate then reconciles with the server's authoritative timestamp.
      patchLinkedIn({
        status: "removed",
        removedAt: new Date().toISOString(),
        postUrl: null,
        postUrn: null,
      })
      void queryClient.invalidateQueries({ queryKey: ["job", jobId] })
    },
    onError: (err) =>
      toast.error(apiError(err, "Could not remove the LinkedIn post.")),
  })

  const handlePost = async () => {
    if (inCooldown) return
    setChecking(true)
    try {
      const status = await getLinkedInStatus()
      if (!status.active) {
        toast.error(
          status.expired
            ? "Your LinkedIn connection expired. Reconnect in Settings."
            : "Connect LinkedIn in Settings to post."
        )
        navigate(settingsTab("integrations"))
        return
      }
      publishMutation.mutate()
    } catch (err) {
      toast.error(apiError(err, "Could not check your LinkedIn connection."))
    } finally {
      setChecking(false)
    }
  }

  const isPublished = linkedin.status === "published" && Boolean(linkedin.postUrl)
  const posting = checking || publishMutation.isPending

  return (
    <div className="mb-5 rounded-xl border border-line bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
          <Linkedin className="h-4 w-4" strokeWidth={1.8} />
        </span>

        <div className="min-w-0 flex-1">
          {isPublished ? (
            <div className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
              <CheckCircle2
                className="h-4 w-4 text-[var(--success)]"
                strokeWidth={2}
              />
              Posted to LinkedIn
            </div>
          ) : (
            <div className="text-[13px] font-semibold text-ink">
              Share this job on LinkedIn
            </div>
          )}
          <p className="text-[12px] text-ink-muted">
            {isPublished
              ? "Live on your LinkedIn feed, linking to the apply page."
              : "Posts to your connected LinkedIn feed, linking to the apply page."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isPublished ? (
            <>
              <a href={linkedin.postUrl ?? "#"} target="_blank" rel="noreferrer">
                <Button variant="secondary" size="sm">
                  <ExternalLink className="h-4 w-4" strokeWidth={1.9} />
                  View post
                </Button>
              </a>
              <Button
                variant="danger"
                size="sm"
                onClick={() => setConfirmUnpublish(true)}
              >
                <X className="h-4 w-4" strokeWidth={1.9} />
                Unpublish
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              onClick={handlePost}
              disabled={posting || inCooldown}
            >
              {posting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Posting…
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" strokeWidth={1.9} />
                  Post to LinkedIn
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Cooldown notice after an unpublish. */}
      {!isPublished && inCooldown ? (
        <div className="mt-2.5 flex items-start gap-2 rounded-lg border border-[var(--warning)]/40 bg-[var(--warning-soft)] px-3 py-2">
          <Clock
            className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]"
            strokeWidth={1.9}
          />
          <p className="text-[12px] text-[var(--warning)]">
            LinkedIn doesn't allow reposting the same content within 20 minutes
            of deleting a post. Change the job details or wait{" "}
            <span className="mono font-semibold">
              {formatCountdown(cooldownUntil - now)}
            </span>
            , then post again.
          </p>
        </div>
      ) : null}

      {/* Last failure (when not in cooldown and not published). */}
      {!isPublished && !inCooldown && linkedin.status === "failed" && linkedin.lastError ? (
        <div className="mt-2.5 flex items-start gap-2 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger-soft)] px-3 py-2">
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-[var(--danger)]"
            strokeWidth={1.9}
          />
          <p className="text-[12px] text-[var(--danger)]">
            Last attempt failed: {linkedin.lastError}
          </p>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmUnpublish}
        onOpenChange={setConfirmUnpublish}
        title="Unpublish this LinkedIn post?"
        description="This deletes the post from your LinkedIn feed. Note: LinkedIn won't let you repost identical content for about 20 minutes after deleting — you'll need to change the job details or wait."
        destructive
        confirmLabel="Unpublish"
        loadingLabel="Removing…"
        loading={unpublishMutation.isPending}
        onConfirm={() => unpublishMutation.mutate()}
      />
    </div>
  )
}
