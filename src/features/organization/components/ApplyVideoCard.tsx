import { useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
  Video,
} from "lucide-react"
import toast from "react-hot-toast"
import { Button } from "@/components/ui/button"
import { HlsPlayer } from "@/components/interviews/HlsPlayer"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { errorMessage as apiError } from "@/lib/errors"
import {
  completeApplyVideoUpload,
  getApplyVideoStatus,
  initApplyVideoUpload,
  removeApplyVideo,
  retryApplyVideoTranscode,
  uploadApplyVideoToPresignedUrl,
} from "@/features/organization/applyVideoApi"
import type {
  ApplyVideoStatus,
  OrgApplyVideo,
} from "@/features/organization/types"

// Mirrors the backend `APPLY_VIDEO` config. The size cap is picker-only
// courtesy; the server enforces it again against the object's real length.
const MAX_BYTES = 500 * 1024 * 1024
const ACCEPT_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
  "video/x-msvideo",
]
const ACCEPT = `${ACCEPT_TYPES.join(",")},.mp4,.mov,.m4v,.webm,.mkv,.avi`

const STATUS_BADGE: Record<
  ApplyVideoStatus,
  { label: string; className: string; Icon: typeof Clock }
> = {
  draft: { label: "No video", className: "bg-surface-3 text-ink-muted", Icon: Video },
  uploading: {
    label: "Uploading",
    className: "bg-[var(--warning-soft)] text-[var(--warning)]",
    Icon: Loader2,
  },
  processing: {
    label: "Processing",
    className: "bg-[var(--warning-soft)] text-[var(--warning)]",
    Icon: Loader2,
  },
  ready: {
    label: "Live",
    className: "bg-[var(--success-soft)] text-[var(--success)]",
    Icon: CheckCircle2,
  },
  failed: {
    label: "Failed",
    className: "bg-[var(--danger-soft)] text-[var(--danger)]",
    Icon: AlertCircle,
  },
}

/** Local upload phase — the part the SERVER can't see (bytes leaving the browser). */
type LocalPhase =
  | { phase: "idle" }
  | { phase: "uploading"; pct: number }
  | { phase: "finalising" }

function formatBytes(n: number): string {
  if (!n) return ""
  const mb = n / (1024 * 1024)
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`
}

interface ApplyVideoCardProps {
  /** The video block from the org profile — the initial cache seed. */
  initial: OrgApplyVideo
  canWrite: boolean
}

/**
 * The apply intro video: upload / replace / remove, live transcode status, and
 * an inline preview of the finished bundle.
 *
 * State lives SERVER-side; this polls `getApplyVideoStatus` and re-arms the
 * poll while a transcode runs, so navigating away and back recovers with no
 * local state. The one thing local is the S3 PUT progress, which the server
 * can't observe. Two-tier lock: `localBusy` (init → PUT → complete) hard-locks
 * the controls because leaving aborts the upload; `serverBusy` (uploading /
 * processing) only disables re-upload so you can't double-enqueue, and the page
 * stays usable while ffmpeg runs.
 */
export function ApplyVideoCard({ initial, canWrite }: ApplyVideoCardProps) {
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [local, setLocal] = useState<LocalPhase>({ phase: "idle" })
  const [removeOpen, setRemoveOpen] = useState(false)

  const statusQuery = useQuery({
    queryKey: ["applyVideoStatus"],
    queryFn: getApplyVideoStatus,
    initialData: initial,
    refetchInterval: (query) => {
      const s = query.state.data?.status
      return s === "uploading" || s === "processing" ? 1500 : false
    },
  })
  const video = statusQuery.data ?? initial

  const localBusy = local.phase !== "idle"
  const serverBusy = video.status === "uploading" || video.status === "processing"

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const init = await initApplyVideoUpload({
        contentType: file.type,
        fileName: file.name,
        sizeBytes: file.size,
      })
      await uploadApplyVideoToPresignedUrl(
        init.uploadUrl,
        file,
        init.contentType,
        (pct) => setLocal({ phase: "uploading", pct })
      )
      setLocal({ phase: "finalising" })
      return completeApplyVideoUpload({ mediaId: init.mediaId, key: init.key })
    },
    onSuccess: (data) => {
      queryClient.setQueryData<OrgApplyVideo>(["applyVideoStatus"], data)
      toast.success("Upload complete. Transcoding your video now.")
    },
    onError: (err) => toast.error(apiError(err, "Could not upload that video.")),
    onSettled: () => {
      setLocal({ phase: "idle" })
      if (inputRef.current) inputRef.current.value = ""
    },
  })

  const retryMutation = useMutation({
    mutationFn: retryApplyVideoTranscode,
    onSuccess: (data) => {
      queryClient.setQueryData<OrgApplyVideo>(["applyVideoStatus"], data)
    },
    onError: (err) => toast.error(apiError(err, "Could not retry.")),
  })

  const removeMutation = useMutation({
    mutationFn: removeApplyVideo,
    onSuccess: (data) => {
      queryClient.setQueryData<OrgApplyVideo>(["applyVideoStatus"], data)
      // Close HERE, not in `onConfirm`. The dialog stays up through the request
      // so it can show its "Removing…" state, which means something has to
      // dismiss it when that finishes — otherwise the video disappears from the
      // card behind a dialog that never goes away.
      setRemoveOpen(false)
      toast.success("Video removed.")
    },
    // Deliberately left OPEN on failure: the toast explains what went wrong and
    // the buttons re-enable, so the obvious retry is right there. Closing would
    // dump the operator back to a card that still shows the video with no clue
    // whether anything happened.
    onError: (err) => toast.error(apiError(err, "Could not remove the video.")),
  })

  const onPick = (file: File | undefined) => {
    if (!file) return
    if (!ACCEPT_TYPES.includes(file.type)) {
      toast.error("Use an MP4, MOV, WebM, MKV or AVI video.")
      return
    }
    if (file.size > MAX_BYTES) {
      toast.error(`That video is over ${formatBytes(MAX_BYTES)}. Use a smaller one.`)
      return
    }
    uploadMutation.mutate(file)
  }

  const badge = STATUS_BADGE[video.status]
  const spinning = video.status === "uploading" || video.status === "processing"
  // A live bundle exists AND we're not mid-replace — safe to render the player.
  const showPreview = video.hasVideo && Boolean(video.manifestUrl)

  /**
   * ONE derivation of the progress readout, so the label and the percent are
   * always the same phase. They used to be computed independently, which is
   * how a retrying job could render a stale "Transcoding" against a reset 0%.
   *
   * The local S3 PUT wins while it is in flight (the server can't see it);
   * after that the server's own phase drives it.
   */
  const { progressLabel, progressPct, indeterminate } = (() => {
    if (local.phase === "uploading") {
      return { progressLabel: "Uploading", progressPct: local.pct, indeterminate: false }
    }
    if (local.phase === "finalising") {
      return { progressLabel: "Finalising", progressPct: 0, indeterminate: true }
    }
    return {
      progressLabel: video.progressLabel || "Processing",
      progressPct: video.progressPct,
      // No measurable percentage yet — queued, or a phase the worker can't
      // quantify. Show motion rather than a frozen zero.
      indeterminate: video.progressPct <= 0,
    }
  })()

  return (
    <div className="rounded-2xl border border-line bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-ink">Apply intro video</h3>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-muted">
            Played to candidates part-way through their application, while their CV
            uploads in the background. No video, no video step, the funnel just
            skips it.
          </p>
        </div>
        <span
          className={
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold " +
            badge.className
          }
        >
          <badge.Icon className={"h-3.5 w-3.5" + (spinning ? " animate-spin" : "")} strokeWidth={1.9} />
          {badge.label}
        </span>
      </div>

      {/* Live preview of the finished bundle. Stays visible during a replace,
          because the old video keeps playing until the new one is ready. */}
      {showPreview ? (
        // `max-w-md` caps the preview at ~448px (252px tall at 16:9). Without
        // it the player is `aspect-video w-full` and stretches to the full
        // settings card, which on a wide screen is a ~1360px video dominating
        // a page that is mostly form fields. This is a "check the right video
        // is live" thumbnail, not a viewing experience — the max-w still lets
        // it shrink to full width on a narrow screen.
        <div className="mt-4 w-full max-w-md overflow-hidden rounded-xl border border-line bg-black">
          <HlsPlayer
            key={video.manifestUrl}
            manifestUrl={video.manifestUrl}
            durationSec={video.durationSec}
          />
        </div>
      ) : null}

      {/* Progress: the local S3 PUT first, then the server's transcode %.
          Label and percent are always read from the SAME source in the same
          render, so they can never disagree. */}
      {localBusy || serverBusy ? (
        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between text-[12px] text-ink-muted">
            <span>{progressLabel}</span>
            <span className="mono tabular-nums">
              {indeterminate ? "" : `${progressPct}%`}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
            {indeterminate ? (
              /* The server is working but hasn't reported a percentage yet
                 (queued, or a phase that can't be measured). A sliding bar
                 says "busy" honestly; a frozen "0%" reads as hung, which is
                 exactly how a stalled job used to look. */
              <div className="h-full w-1/3 animate-[apply-video-indeterminate_1.2s_ease-in-out_infinite] rounded-full bg-primary" />
            ) : (
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${Math.max(progressPct, 2)}%` }}
              />
            )}
          </div>
        </div>
      ) : null}

      {video.status === "failed" && video.error ? (
        <p className="mt-4 rounded-lg border border-[color-mix(in_srgb,var(--danger),transparent_60%)] bg-[var(--danger-soft)] px-3 py-2 text-[12.5px] text-[var(--danger)]">
          {video.error}
        </p>
      ) : null}

      {video.originalFilename && !localBusy ? (
        <p className="mt-3 text-[12px] text-ink-subtle">
          <span className="text-ink-muted">{video.originalFilename}</span>
          {video.sizeBytes ? ` · ${formatBytes(video.sizeBytes)}` : ""}
        </p>
      ) : null}

      {canWrite ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => onPick(e.target.files?.[0])}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={localBusy || serverBusy}
          >
            {localBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" strokeWidth={1.7} />
            )}
            {video.hasVideo ? "Replace video" : "Choose video"}
          </Button>

          {video.status === "failed" ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => retryMutation.mutate()}
              disabled={retryMutation.isPending || localBusy}
            >
              {retryMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" strokeWidth={1.7} />
              )}
              Retry
            </Button>
          ) : null}

          {video.hasVideo || video.status === "failed" ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setRemoveOpen(true)}
              disabled={localBusy || removeMutation.isPending}
              className="text-ink-muted hover:text-[var(--danger)]"
            >
              {removeMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" strokeWidth={1.7} />
              )}
              Remove
            </Button>
          ) : null}

          <p className="text-[12px] text-ink-subtle">
            MP4, MOV, WebM, MKV or AVI, up to {formatBytes(MAX_BYTES)}.
          </p>
        </div>
      ) : null}

      <ConfirmDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title="Remove apply video?"
        description="Candidates will no longer see a video step in the application. You can upload a new one any time."
        confirmLabel="Remove video"
        loadingLabel="Removing…"
        destructive
        loading={removeMutation.isPending}
        onConfirm={() => removeMutation.mutate()}
      />
    </div>
  )
}
