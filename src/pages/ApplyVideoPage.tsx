import { useCallback, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertCircle,
  CheckCircle2,
  Film,
  Loader2,
  RefreshCw,
  UploadCloud
} from "lucide-react"
import toast from "react-hot-toast"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  completeApplyVideoUpload,
  fetchApplyVideoStatus,
  initApplyVideoUpload,
  retryApplyVideoTranscode,
  uploadApplyVideoToPresignedUrl
} from "@/features/apply-video/applyVideoApi"
import type { ApplyVideoStatus } from "@/features/apply-video/types"
import axios from "axios"
import ApplyVideoPlayer from "@/components/apply-video/ApplyVideoPlayer"

// File-picker accept list. We mirror the LMS LessonUploadDialog's set
// so the admin's expectations carry across. The backend doesn't
// enforce a server-side allow-list; ffmpeg will fail loudly on a
// non-video and surface the error in `lastError`.
const FILE_INPUT_ACCEPT =
  "video/*,video/mp4,video/quicktime,video/x-matroska,video/x-msvideo,video/webm,video/x-m4v,.mp4,.mov,.m4v,.mkv,.avi,.webm"

const MAX_BYTES = 2 * 1024 * 1024 * 1024 // 2 GB hard cap on the picker

type LocalPhase =
  | { phase: "idle" }
  | { phase: "uploading"; pct: number }
  | { phase: "finalising" }
  | { phase: "error"; message: string }

const STATUS_BADGE: Record<
  ApplyVideoStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  draft: { label: "No video", variant: "outline" },
  uploading: { label: "Uploading", variant: "secondary" },
  processing: { label: "Processing", variant: "secondary" },
  ready: { label: "Live", variant: "default" },
  failed: { label: "Failed", variant: "destructive" }
}

const formatBytes = (bytes: number): string => {
  if (!bytes) return "—"
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

const formatDuration = (sec: number): string => {
  if (!sec) return "—"
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, "0")}`
}

const formatDate = (iso: string | null): string => {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      hour12: true
    })
  } catch {
    return "—"
  }
}

const apiError = (err: unknown, fallback: string): string => {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { message?: string | string[] } | undefined
    const m = Array.isArray(data?.message) ? data?.message[0] : data?.message
    if (m) return String(m)
  }
  if (err instanceof Error) return err.message
  return fallback
}

/**
 * Extract a 0-100 percent (or null) from the server `videoProgress`
 * label. The HLS worker emits strings like `"Transcoding video (42%)"`
 * and `"Uploading segments to storage (3/12)"`. We surface a numeric
 * bar when we can parse one, otherwise fall back to an indeterminate
 * shimmer so the admin still sees motion.
 */
const parseServerPct = (label: string): number | null => {
  const pct = /\((\d{1,3})%\)/.exec(label)
  if (pct) return Math.min(100, Math.max(0, Number(pct[1])))
  const ratio = /\((\d+)\/(\d+)\)/.exec(label)
  if (ratio) {
    const num = Number(ratio[1])
    const den = Number(ratio[2])
    if (den > 0) return Math.min(100, Math.max(0, Math.round((num / den) * 100)))
  }
  return null
}

export function ApplyVideoPage() {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [local, setLocal] = useState<LocalPhase>({ phase: "idle" })

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["applyVideoStatus"],
    queryFn: fetchApplyVideoStatus,
    // Poll fast while a pipeline is live; back off when terminal so
    // we don't hammer Mongo when nothing is happening.
    refetchInterval: (query) => {
      const s = query.state.data?.videoStatus
      if (!s) return 1500
      return s === "uploading" || s === "processing" ? 1500 : false
    }
  })

  const handleFile = useCallback(
    async (file: File) => {
      if (file.size > MAX_BYTES) {
        toast.error("That video is over 2 GB. Trim or re-encode before uploading.")
        return
      }
      setLocal({ phase: "uploading", pct: 0 })
      try {
        const presigned = await initApplyVideoUpload({
          mimeType: file.type || "video/mp4",
          filename: file.name
        })
        await uploadApplyVideoToPresignedUrl(
          presigned.uploadUrl,
          file,
          presigned.contentType,
          (pct) => setLocal({ phase: "uploading", pct })
        )
        setLocal({ phase: "finalising" })
        await completeApplyVideoUpload({
          key: presigned.key,
          mimeType: presigned.contentType,
          sizeBytes: file.size,
          filename: file.name
        })
        setLocal({ phase: "idle" })
        toast.success("Upload accepted. Transcode is running, sit tight.")
        queryClient.invalidateQueries({ queryKey: ["applyVideoStatus"] })
      } catch (err) {
        const message = apiError(err, "Upload failed.")
        setLocal({ phase: "error", message })
        toast.error(message)
      }
    },
    [queryClient]
  )

  const onRetry = useCallback(async () => {
    try {
      await retryApplyVideoTranscode()
      toast.success("Retry queued.")
      queryClient.invalidateQueries({ queryKey: ["applyVideoStatus"] })
    } catch (err) {
      toast.error(apiError(err, "Could not retry transcode."))
    }
  }, [queryClient])

  const triggerPicker = () => fileInputRef.current?.click()

  const serverPct = data?.videoProgress ? parseServerPct(data.videoProgress) : null
  const isBusyOnServer =
    data?.videoStatus === "uploading" || data?.videoStatus === "processing"
  const isLocalBusy = local.phase === "uploading" || local.phase === "finalising"
  const showRetry = data?.videoStatus === "failed" && !isLocalBusy
  const status: ApplyVideoStatus = data?.videoStatus ?? "draft"
  const badge = STATUS_BADGE[status]

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Film className="h-6 w-6 text-primary" />
            Apply page video
          </h1>
          <p className="text-sm text-muted-foreground">
            One intro video, shown on{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">jobjen.com/apply</code>.
            Replace it any time, the new bundle goes live atomically when the
            transcode finishes.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isLoading}
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Refresh now
        </Button>
      </div>

      {/* Status card */}
      <Card>
        <CardHeader className="border-b border-border">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                Current status
                <Badge variant={badge.variant}>{badge.label}</Badge>
              </CardTitle>
              <CardDescription>
                {data?.originalFilename
                  ? `Live file: ${data.originalFilename}`
                  : "No video uploaded yet."}
              </CardDescription>
            </div>
            {showRetry && (
              <Button onClick={onRetry} variant="default" size="sm">
                <RefreshCw className="h-4 w-4" />
                Retry transcode
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-6">
          {isError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              Could not load apply-video status.{" "}
              <button
                onClick={() => refetch()}
                className="underline underline-offset-2"
              >
                Retry
              </button>
            </div>
          )}

          {/* Progress strip while local or server work is in flight */}
          {(isBusyOnServer || isLocalBusy) && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="truncate pr-2">
                  {local.phase === "uploading"
                    ? `Uploading source from browser (${local.pct}%)`
                    : local.phase === "finalising"
                    ? "Finalising upload…"
                    : data?.videoProgress || "Working…"}
                </span>
                {(local.phase === "uploading" ||
                  serverPct !== null ||
                  isBusyOnServer) && (
                  <span className="tabular-nums">
                    {local.phase === "uploading"
                      ? `${local.pct}%`
                      : serverPct !== null
                      ? `${serverPct}%`
                      : ""}
                  </span>
                )}
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                {local.phase === "uploading" ? (
                  <div
                    className="h-full bg-primary transition-[width] duration-200 ease-out"
                    style={{ width: `${local.pct}%` }}
                  />
                ) : serverPct !== null ? (
                  <div
                    className="h-full bg-primary transition-[width] duration-200 ease-out"
                    style={{ width: `${serverPct}%` }}
                  />
                ) : (
                  // Indeterminate shimmer for the "Uploading
                  // segments…" / "Reading video info" phases where we
                  // can't parse a percent. CSS keyframes already exist
                  // in the dashboard's global stylesheet under
                  // `animate-progress-indeterminate`; if that class
                  // isn't present in your theme, swap for a pulse.
                  <div className="h-full w-1/3 animate-pulse bg-primary" />
                )}
              </div>
            </div>
          )}

          {data?.videoStatus === "failed" && data?.lastError && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 wrap-break-word">{data.lastError}</div>
            </div>
          )}

          {data?.hasReadyVideo && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <span>Bundle is live.</span>
              <span>·</span>
              <span>
                Duration <span className="text-foreground">{formatDuration(data.durationSec)}</span>
              </span>
              <span>·</span>
              <span>
                Source size{" "}
                <span className="text-foreground">{formatBytes(data.sourceBytes)}</span>
              </span>
              <span>·</span>
              <span>
                Ready at <span className="text-foreground">{formatDate(data.readyAt)}</span>
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Upload card */}
      <Card>
        <CardHeader>
          <CardTitle>Upload a new video</CardTitle>
          <CardDescription>
            MP4 / MOV / MKV / WebM. Re-encoded server-side to a public HLS bundle
            (libx264 / AAC / yuv420p) so every browser can stream it. Max 2 GB.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <Button
              onClick={triggerPicker}
              disabled={isLocalBusy}
              variant={data?.hasReadyVideo ? "outline" : "default"}
            >
              <UploadCloud className="h-4 w-4" />
              {isLocalBusy
                ? local.phase === "uploading"
                  ? `Uploading… ${local.pct}%`
                  : "Finalising…"
                : data?.hasReadyVideo
                ? "Replace video"
                : "Choose video"}
            </Button>
            <p className="text-xs text-muted-foreground">
              The new bundle goes live the moment the transcode finishes. Viewers
              already on the page get the new video on next play / refresh.
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={FILE_INPUT_ACCEPT}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void handleFile(f)
              // Reset so picking the same file twice still fires `change`.
              e.target.value = ""
            }}
          />
          {local.phase === "error" && (
            <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {local.message}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Preview card — uses the same custom HLS player the
          landing-page candidate sees on /apply, so admins
          previewing the bundle get an identical experience
          (gradient play overlay, custom scrubber, keyboard
          shortcuts, fullscreen). The component is a port of
          `jobjen-landing-page/src/app/components/pages/apply/
          ApplyVideoPlayer.tsx`; if either file changes, mirror
          to the other (see the file's docblock). Key on `readyAt`
          so a freshly-published bundle remounts the player
          (otherwise hls.js would keep its in-memory buffer from
          the previous bundle). */}
      {data?.hasReadyVideo && (
        <Card>
          <CardHeader>
            <CardTitle>Preview</CardTitle>
            <CardDescription>
              Same stream + same player the /apply page renders. Use this to
              sanity-check the bundle before sharing the page.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ApplyVideoPlayer
              key={data.readyAt ?? "ready"}
              manifestUrl="/api/apply-video/manifest.m3u8"
              durationSec={data.durationSec}
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
