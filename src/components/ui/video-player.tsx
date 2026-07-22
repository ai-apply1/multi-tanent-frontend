import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from "react"
import {
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  Volume1,
  Volume2,
  VolumeX
} from "lucide-react"
import { cn } from "@/lib/utils"
import { apiUrl } from "@/lib/api"
import { BASIC_AUTH_ENABLED, BASIC_AUTH_HEADER } from "@/lib/basicAuth"

interface VideoPlayerProps {
  src: string
  /** Visible label for accessibility (e.g. "Webcam recording"). */
  ariaLabel?: string
  className?: string
  /** Optional poster shown until the user starts playback. */
  poster?: string
  /**
   * Authoritative duration in seconds, supplied by the backend when
   * known (captured client-side at recording time and persisted on
   * the session document). When provided, the player uses this as
   * the canonical timeline length for both the time readout and the
   * seek slider — eliminating the high-water-mark heuristics we'd
   * otherwise need for non-cued MediaRecorder WebMs whose duration
   * the browser can't reliably extract on playback.
   *
   * Pass `0` or omit for legacy recordings that pre-date this field.
   */
  knownDurationSec?: number
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00"
  const total = Math.floor(sec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
  }
  return `${m}:${s.toString().padStart(2, "0")}`
}

/**
 * Theme-aware HTML5 video player with overlay controls.
 *
 * Why we don't just use `<video controls>`:
 *  - The native chrome doesn't match the rest of the dashboard.
 *  - WebM blobs from `MediaRecorder` (the candidate's webcam
 *    recordings) ship without a duration header (no Cues, often
 *    `Duration = Infinity` in Segment Info), so the native progress
 *    bar shows `0:00 / —:—` and the scrubber is dead.
 *
 * How we know the duration:
 *  - For recordings produced by the candidate frontend AFTER the
 *    duration capture rollout, the backend ships `knownDurationSec`
 *    (the recorder's wall-clock duration, persisted at upload time).
 *    We use it as the authoritative timeline length — no probing, no
 *    high-water heuristics, the seek slider is anchored immediately.
 *  - For legacy recordings without `knownDurationSec`, we still
 *    monotonically discover duration from `v.duration`,
 *    `v.seekable.end`, `v.buffered.end`, and `v.currentTime` — never
 *    perfect, but at least always >= playhead.
 *
 * Performance contract:
 *  - `preload="none"` — the drawer only loads bytes when the reviewer
 *    actually clicks play. Webcam recordings can be 50–150 MB, so we
 *    keep network strictly user-driven.
 *
 * Accessibility:
 *  - Click anywhere on the picture to toggle play/pause.
 *  - Double-click to fullscreen.
 *  - Keyboard: Space toggles play, F fullscreen, M mute, ←/→ ±5s,
 *    shift-←/→ ±10s, Home/End jump to start/end.
 */
export function VideoPlayer({
  src,
  ariaLabel,
  className,
  poster,
  knownDurationSec
}: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const hideControlsTimer = useRef<number | null>(null)

  const [isPlaying, setIsPlaying] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [hasError, setHasError] = useState(false)
  const [hasStarted, setHasStarted] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState<number>(() =>
    knownDurationSec && knownDurationSec > 0 ? knownDurationSec : 0
  )
  const [volume, setVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  // Live-drag state for the two sliders. Held up here (instead of
  // alongside the rest of the slider code) because the auto-hide
  // controls effect below also consults them to keep the chrome on
  // screen while the user is mid-drag.
  const [isSeeking, setIsSeeking] = useState(false)
  const [isAdjustingVolume, setIsAdjustingVolume] = useState(false)

  // If the backend ships a different recording, refresh duration with
  // the new authoritative value.
  useEffect(() => {
    if (knownDurationSec && knownDurationSec > 0) {
      setDuration(knownDurationSec)
    }
  }, [knownDurationSec])

  // ── runtime event wiring ─────────────────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current
    if (!v) return

    /**
     * Fallback duration discovery for legacy recordings that lack
     * server-supplied `knownDurationSec`. MediaRecorder WebMs ship
     * without seekable duration metadata, so we accumulate a
     * high-water mark across every signal that has any claim on it
     * (`v.duration`, `v.seekable.end`, `v.buffered.end`,
     * `v.currentTime`) and `Math.max` against previous state. The
     * result drifts upward toward the real duration as more data
     * arrives — never accurate while playing, but never a duration
     * smaller than the playhead either.
     *
     * No-op when `knownDurationSec` is supplied — we already know.
     */
    const tryUpdateDuration = () => {
      if (knownDurationSec && knownDurationSec > 0) return
      let best = 0
      if (Number.isFinite(v.duration) && v.duration > 0) {
        best = v.duration
      }
      if (v.seekable && v.seekable.length > 0) {
        const end = v.seekable.end(v.seekable.length - 1)
        if (Number.isFinite(end) && end > best) best = end
      }
      if (v.buffered && v.buffered.length > 0) {
        const end = v.buffered.end(v.buffered.length - 1)
        if (Number.isFinite(end) && end > best) best = end
      }
      if (
        Number.isFinite(v.currentTime) &&
        v.currentTime < 1e7 &&
        v.currentTime > best
      ) {
        best = v.currentTime
      }
      if (best > 0) {
        setDuration((prev) => (best > prev ? best : prev))
      }
    }

    const onTime = () => {
      if (Number.isFinite(v.currentTime) && v.currentTime < 1e7) {
        setCurrentTime(v.currentTime)
        // currentTime is a hard floor on duration — keep the duration
        // high-water mark up to date so the progress bar can't lie.
        tryUpdateDuration()
      }
    }
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    const onEnded = () => {
      setIsPlaying(false)
      // Last chance to lock in a real duration — at `ended`, the
      // browser has definitely scanned the whole stream.
      tryUpdateDuration()
    }
    const onError = () => {
      setHasError(true)
      setIsLoading(false)
    }
    const onWaiting = () => setIsLoading(true)
    const onPlaying = () => setIsLoading(false)
    const onVolumeChange = () => {
      setVolume(v.volume)
      setIsMuted(v.muted || v.volume === 0)
    }

    v.addEventListener("durationchange", tryUpdateDuration)
    v.addEventListener("loadedmetadata", tryUpdateDuration)
    v.addEventListener("loadeddata", tryUpdateDuration)
    v.addEventListener("progress", tryUpdateDuration)
    v.addEventListener("canplay", tryUpdateDuration)
    v.addEventListener("timeupdate", onTime)
    v.addEventListener("play", onPlay)
    v.addEventListener("pause", onPause)
    v.addEventListener("ended", onEnded)
    v.addEventListener("error", onError)
    v.addEventListener("waiting", onWaiting)
    v.addEventListener("playing", onPlaying)
    v.addEventListener("volumechange", onVolumeChange)

    return () => {
      v.removeEventListener("durationchange", tryUpdateDuration)
      v.removeEventListener("loadedmetadata", tryUpdateDuration)
      v.removeEventListener("loadeddata", tryUpdateDuration)
      v.removeEventListener("progress", tryUpdateDuration)
      v.removeEventListener("canplay", tryUpdateDuration)
      v.removeEventListener("timeupdate", onTime)
      v.removeEventListener("play", onPlay)
      v.removeEventListener("pause", onPause)
      v.removeEventListener("ended", onEnded)
      v.removeEventListener("error", onError)
      v.removeEventListener("waiting", onWaiting)
      v.removeEventListener("playing", onPlaying)
      v.removeEventListener("volumechange", onVolumeChange)
    }
  }, [src, knownDurationSec])

  // ── fullscreen state subscription ────────────────────────────────────────
  useEffect(() => {
    const onFs = () => setIsFullscreen(document.fullscreenElement === containerRef.current)
    document.addEventListener("fullscreenchange", onFs)
    return () => document.removeEventListener("fullscreenchange", onFs)
  }, [])

  // Reset derived state when src changes (e.g. drawer reopens with a new session).
  useEffect(() => {
    setIsPlaying(false)
    setHasStarted(false)
    setCurrentTime(0)
    setDuration(knownDurationSec && knownDurationSec > 0 ? knownDurationSec : 0)
    setIsLoading(false)
    setHasError(false)
  }, [src, knownDurationSec])

  // ── perimeter Basic Auth: blob-URL fallback ─────────────────────────────
  //
  // When the build is configured with perimeter Basic Auth, the
  // backend's `BasicAuthMiddleware` gates `/api/admin/interviews/:id/video`
  // too. `<video src>` is browser-issued — there's no JS hook to set
  // `Authorization`, so the request would 401 silently.
  //
  // Workaround: pull the whole video via `fetch` (which DOES let us
  // set headers), pack the response bytes into a Blob, and play from
  // an Object URL. Trade-offs:
  //   - Loads the entire recording into memory before playback can
  //     begin (~50–150 MB per webcam recording, fine on the desktops
  //     reviewers use).
  //   - Seek works perfectly because the bytes are local.
  //   - HTTP Range requests are no longer used; we eat the full
  //     egress on every play.
  //
  // When Basic Auth is OFF (local dev), we skip the fetch and let the
  // browser do its normal Range-streaming `<video src>` thing.
  const [effectiveSrc, setEffectiveSrc] = useState<string>(
    BASIC_AUTH_ENABLED ? "" : apiUrl(src)
  )
  // Non-null while the blob fetch is pulling the recording. `pct`/`totalMb`
  // are null when the response exposes no Content-Length (progress is then
  // indeterminate). Screen recordings can run to hundreds of MB, so without
  // this the reviewer stares at a spinner that looks identical to a hang.
  const [download, setDownload] = useState<{
    pct: number | null
    totalMb: number | null
  } | null>(null)
  useEffect(() => {
    if (!BASIC_AUTH_ENABLED) {
      setEffectiveSrc(apiUrl(src))
      return
    }
    if (!src) {
      setEffectiveSrc("")
      return
    }

    setIsLoading(true)
    setEffectiveSrc("")
    setDownload({ pct: null, totalMb: null })

    const controller = new AbortController()
    let objectUrl: string | null = null
    let cancelled = false

    const headers: Record<string, string> = {}
    if (BASIC_AUTH_HEADER) headers["Authorization"] = BASIC_AUTH_HEADER

    const run = async () => {
      const res = await fetch(apiUrl(src), {
        credentials: "include",
        headers,
        signal: controller.signal
      })
      if (!res.ok) {
        throw new Error(`Video request failed (HTTP ${res.status})`)
      }
      const totalBytes = Number(res.headers.get("content-length") || 0)
      let blob: Blob
      if (res.body && totalBytes > 0) {
        const reader = res.body.getReader()
        const chunks: BlobPart[] = []
        let received = 0
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (!value) continue
          chunks.push(value)
          received += value.byteLength
          if (!cancelled) {
            setDownload({
              pct: Math.min(99, Math.floor((received / totalBytes) * 100)),
              totalMb: totalBytes / (1024 * 1024)
            })
          }
        }
        blob = new Blob(chunks, {
          type: res.headers.get("content-type") || "video/webm"
        })
      } else {
        blob = await res.blob()
      }
      if (cancelled) return
      objectUrl = URL.createObjectURL(blob)
      setEffectiveSrc(objectUrl)
      setDownload(null)
      setIsLoading(false)
    }

    run().catch((err) => {
      if (cancelled || (err instanceof DOMException && err.name === "AbortError")) {
        return
      }
      setHasError(true)
      setDownload(null)
      setIsLoading(false)
       
      console.error("[video-player] failed to fetch recording", err)
    })

    return () => {
      cancelled = true
      controller.abort()
      setDownload(null)
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [src])

  // ── core controls ────────────────────────────────────────────────────────
  //
  // We intentionally do NOT run the "seek to MAX_SAFE_INTEGER" duration
  // probe that the audio player uses. For small audios it succeeds —
  // the file is fully buffered by the time the probe lands, so the
  // browser reports the real duration. For multi-MB webcam WebMs
  // streamed through our auth proxy it backfires: Chrome commits to
  // `seekable.end(0)` (typically just the first couple of seconds of
  // buffer) as the "real" duration and never updates it again. The
  // multi-signal high-water-mark detection above is more reliable.
  const togglePlay = useCallback(async () => {
    const v = videoRef.current
    if (!v || hasError) return

    if (!v.paused) {
      v.pause()
      return
    }

    setIsLoading(true)
    try {
      const dur = v.duration
      const isAtEnd = Number.isFinite(dur) && dur > 0 && v.currentTime >= dur - 0.05
      if (isAtEnd) {
        v.currentTime = 0
        setCurrentTime(0)
      }
      setHasStarted(true)
      await v.play()
    } catch {
      setHasError(true)
    } finally {
      setIsLoading(false)
    }
  }, [hasError])

  /**
   * Seek with two layers of recovery for non-cued WebMs (everything
   * recorded by `MediaRecorder` lacks a Cues element, which is what
   * lets the browser locate keyframes for fast random-access seek):
   *
   *  1. Soft nudge — after `seeked` fires, briefly play the video
   *     and wait for `requestVideoFrameCallback` to confirm a *new*
   *     frame has actually been painted before pausing again. The old
   *     `play().then(pause)` form pauses before the decoder renders,
   *     which is why the picture used to stay frozen on the previous
   *     frame.
   *  2. Hard reset — if `seeked` doesn't fire within 1.5s, or any
   *     soft step rejects, we call `video.load()` and re-apply the
   *     target on `loadedmetadata`. This drops and rebuilds the
   *     decoder pipeline, which fixes the rare cases where Chrome's
   *     WebM demuxer gets permanently desynced from audio.
   *
   * For files that *do* carry Cues (e.g. anything we re-encode
   * server-side later) this all behaves like a normal seek.
   */
  const performSeek = useCallback((target: number) => {
    const v = videoRef.current
    if (!v) return
    const wasPlaying = !v.paused
    setCurrentTime(target)

    let settled = false
    let hardResetTimer: number | null = null

    const cleanup = () => {
      if (hardResetTimer !== null) {
        window.clearTimeout(hardResetTimer)
        hardResetTimer = null
      }
      v.removeEventListener("seeked", onSoftSeeked)
    }

    // Wait for one rendered video frame after `play()` so the picture
    // is *actually* showing the new position before we pause again.
    const waitOneFrame = (): Promise<void> => {
      const vfc = (v as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: () => void) => number
      }).requestVideoFrameCallback
      if (typeof vfc === "function") {
        return new Promise<void>((resolve) => {
          vfc.call(v, () => resolve())
        })
      }
      return new Promise<void>((resolve) => window.setTimeout(resolve, 90))
    }

    const onSoftSeeked = async () => {
      if (settled) return
      cleanup()
      try {
        await v.play()
        await waitOneFrame()
        if (!wasPlaying) v.pause()
        settled = true
      } catch {
        if (!settled) hardReset()
      }
    }

    const hardReset = () => {
      if (settled) return
      settled = true
      cleanup()
      const onMeta = () => {
        v.removeEventListener("loadedmetadata", onMeta)
        try {
          v.currentTime = target
        } catch {
          /* ignore — we already did our best */
        }
        if (wasPlaying) v.play().catch(() => { /* ignore */ })
      }
      v.addEventListener("loadedmetadata", onMeta)
      try {
        v.load()
      } catch {
        v.removeEventListener("loadedmetadata", onMeta)
      }
    }

    v.addEventListener("seeked", onSoftSeeked, { once: true })
    try {
      v.currentTime = target
    } catch {
      hardReset()
      return
    }

    // Some browsers swallow `seeked` for non-cued WebMs when the user
    // jumps far ahead. Bail out to the hard reset if that happens.
    hardResetTimer = window.setTimeout(() => {
      hardReset()
    }, 1500)
  }, [])

  const seekToPct = useCallback(
    (pct: number) => {
      if (!duration) return
      const clamped = Math.max(0, Math.min(1, pct))
      performSeek(clamped * duration)
    },
    [duration, performSeek]
  )

  const seekBy = useCallback(
    (deltaSec: number) => {
      const v = videoRef.current
      if (!v || !duration) return
      const next = Math.max(0, Math.min(duration, v.currentTime + deltaSec))
      performSeek(next)
    },
    [duration, performSeek]
  )

  const toggleMute = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    v.muted = !v.muted
    setIsMuted(v.muted)
  }, [])

  const setVolumePct = useCallback((pct: number) => {
    const v = videoRef.current
    if (!v) return
    const clamped = Math.max(0, Math.min(1, pct))
    v.volume = clamped
    if (clamped === 0) v.muted = true
    else if (v.muted) v.muted = false
  }, [])

  const toggleFullscreen = useCallback(async () => {
    const c = containerRef.current
    if (!c) return
    try {
      if (document.fullscreenElement === c) {
        await document.exitFullscreen()
      } else {
        await c.requestFullscreen()
      }
    } catch {
      // Some browsers reject fullscreen if not initiated by a trusted
      // gesture (we are in one, but be defensive).
    }
  }, [])

  // ── auto-hide controls while playing ─────────────────────────────────────
  const showControls = useCallback(() => {
    setControlsVisible(true)
    if (hideControlsTimer.current !== null) {
      window.clearTimeout(hideControlsTimer.current)
    }
    hideControlsTimer.current = window.setTimeout(() => {
      // Only auto-hide while actively playing — paused state always shows.
      const v = videoRef.current
      if (v && !v.paused) setControlsVisible(false)
    }, 2500)
  }, [])

  useEffect(() => {
    return () => {
      if (hideControlsTimer.current !== null) {
        window.clearTimeout(hideControlsTimer.current)
      }
    }
  }, [])

  useEffect(() => {
    // Always show when paused OR while the user is actively dragging
    // a slider — they need to see what they're doing.
    if (!isPlaying || isSeeking || isAdjustingVolume) setControlsVisible(true)
  }, [isPlaying, isSeeking, isAdjustingVolume])

  // ── keyboard shortcuts (only when player is focused) ─────────────────────
  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      // Don't hijack when the user is typing in an input nested inside.
      const target = e.target as HTMLElement
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return

      switch (e.key) {
        case " ":
        case "k":
        case "K":
          e.preventDefault()
          void togglePlay()
          break
        case "f":
        case "F":
          e.preventDefault()
          void toggleFullscreen()
          break
        case "m":
        case "M":
          e.preventDefault()
          toggleMute()
          break
        case "ArrowRight":
          e.preventDefault()
          seekBy(e.shiftKey ? 10 : 5)
          break
        case "ArrowLeft":
          e.preventDefault()
          seekBy(e.shiftKey ? -10 : -5)
          break
        case "Home":
          e.preventDefault()
          seekToPct(0)
          break
        case "End":
          e.preventDefault()
          seekToPct(1)
          break
        case "ArrowUp":
          e.preventDefault()
          setVolumePct(volume + 0.05)
          break
        case "ArrowDown":
          e.preventDefault()
          setVolumePct(volume - 0.05)
          break
        default:
          return
      }
      showControls()
    },
    [
      seekBy,
      seekToPct,
      setVolumePct,
      showControls,
      toggleFullscreen,
      toggleMute,
      togglePlay,
      volume
    ]
  )

  // ── progress bar interactions ────────────────────────────────────────────
  const progressPct = useMemo(() => {
    if (!duration) return 0
    return Math.max(0, Math.min(100, (currentTime / duration) * 100))
  }, [currentTime, duration])

  // We pin the active pointerId during a drag so a second finger /
  // accidental second mouse button can't hijack the slider mid-drag.
  // `null` means "not currently dragging".
  const seekDragPointerRef = useRef<number | null>(null)
  const volumeDragPointerRef = useRef<number | null>(null)

  /**
   * Map a pointer X-coordinate to a [0..1] fraction along a horizontal
   * track, clamped at both ends. Used by both sliders so a drag that
   * leaves the track on either side snaps to the nearest endpoint
   * instead of jumping or stopping.
   */
  const ratioFromPointer = (track: HTMLElement, clientX: number): number => {
    const rect = track.getBoundingClientRect()
    if (rect.width <= 0) return 0
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  }

  const onScrubberPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!duration || hasError) return
      // Left mouse button only — ignore right/middle clicks so the
      // browser's own context menu still works.
      if (e.pointerType === "mouse" && e.button !== 0) return
      e.stopPropagation()
      const el = e.currentTarget
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        /* not supported — fall through, the captured-pointer path
           still works because the element is the same one receiving
           move/up events. */
      }
      // Cancel the auto-hide so the controls don't vanish mid-drag.
      if (hideControlsTimer.current !== null) {
        window.clearTimeout(hideControlsTimer.current)
        hideControlsTimer.current = null
      }
      seekDragPointerRef.current = e.pointerId
      setIsSeeking(true)
      seekToPct(ratioFromPointer(el, e.clientX))
    },
    [duration, hasError, seekToPct]
  )

  const onScrubberPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (seekDragPointerRef.current !== e.pointerId) return
      seekToPct(ratioFromPointer(e.currentTarget, e.clientX))
    },
    [seekToPct]
  )

  const onScrubberPointerEnd = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (seekDragPointerRef.current !== e.pointerId) return
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore — already released or never captured. */
      }
      seekDragPointerRef.current = null
      setIsSeeking(false)
      // Resume the auto-hide cycle now that the drag is over.
      showControls()
    },
    [showControls]
  )

  const onScrubberKey = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!duration) return
      const step = e.shiftKey ? 10 : 5
      if (e.key === "ArrowRight") {
        e.preventDefault()
        seekBy(step)
      } else if (e.key === "ArrowLeft") {
        e.preventDefault()
        seekBy(-step)
      } else if (e.key === "Home") {
        e.preventDefault()
        seekToPct(0)
      } else if (e.key === "End") {
        e.preventDefault()
        seekToPct(1)
      }
    },
    [duration, seekBy, seekToPct]
  )

  // ── volume slider ────────────────────────────────────────────────────────
  const onVolumePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return
      e.stopPropagation()
      const el = e.currentTarget
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        /* ignore — capture is a best-effort optimisation. */
      }
      // Cancel the auto-hide so the controls don't vanish mid-drag.
      if (hideControlsTimer.current !== null) {
        window.clearTimeout(hideControlsTimer.current)
        hideControlsTimer.current = null
      }
      volumeDragPointerRef.current = e.pointerId
      setIsAdjustingVolume(true)
      setVolumePct(ratioFromPointer(el, e.clientX))
    },
    [setVolumePct]
  )

  const onVolumePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (volumeDragPointerRef.current !== e.pointerId) return
      setVolumePct(ratioFromPointer(e.currentTarget, e.clientX))
    },
    [setVolumePct]
  )

  const onVolumePointerEnd = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (volumeDragPointerRef.current !== e.pointerId) return
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      volumeDragPointerRef.current = null
      setIsAdjustingVolume(false)
      // Resume the auto-hide cycle now that the drag is over.
      showControls()
    },
    [showControls]
  )

  // ── volume icon: matches level ───────────────────────────────────────────
  const VolumeIcon = isMuted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2

  // Stage gradient is brighter while controls are showing or paused so the
  // controls themselves stay legible against any scene.
  return (
    <div
      ref={containerRef}
      role="region"
      aria-label={ariaLabel ?? "Video player"}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseMove={showControls}
      onMouseLeave={() => {
        if (isPlaying) setControlsVisible(false)
      }}
      className={cn(
        "group relative isolate overflow-hidden rounded-lg border border-border bg-black",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className
      )}
    >
      {/*
        Download deterrents:
          • `controlsList="nodownload nofullscreen noremoteplayback"` —
            even though we render our own controls, this also strips the
            native overflow menu's "Download" entry on Chromium and the
            fullscreen/cast affordances.
          • `disablePictureInPicture` — PiP gives Chrome a built-in
            "Save Video As" path; remove it.
          • `onContextMenu` blocked — kills right-click → "Save video as".
          • `onDragStart` blocked — drag-to-desktop on Firefox/Safari
            also writes the file out; suppress it.

        Auth cookies flow automatically because the player loads from
        `/api/admin/interviews/:id/video`, which the dev Vite proxy and
        the production reverse proxy both rewrite to the backend at the
        same origin as the admin app.

        These defeat every casual download path the browser exposes.
        A determined user with DevTools can still capture bytes in
        flight — that's a fundamental browser constraint, not something
        a player can prevent. The streaming proxy makes even that
        capture useless without a valid admin session, since the URL
        requires the auth cookie to fetch.
      */}
      <video
        ref={videoRef}
        src={effectiveSrc || undefined}
        poster={poster}
        preload="none"
        playsInline
        controlsList="nodownload nofullscreen noremoteplayback"
        disablePictureInPicture
        onClick={() => void togglePlay()}
        onDoubleClick={() => void toggleFullscreen()}
        onContextMenu={(e) => e.preventDefault()}
        onDragStart={(e) => e.preventDefault()}
        draggable={false}
        className="block aspect-video w-full bg-black select-none"
      >
        Sorry, your browser can't play this recording.
      </video>

      {/* Big-play overlay shown only before first play */}
      {!hasStarted && !hasError ? (
        <button
          type="button"
          aria-label="Play video"
          onClick={(e) => {
            e.stopPropagation()
            void togglePlay()
          }}
          className={cn(
            "absolute inset-0 z-10 flex flex-col items-center justify-center gap-3",
            "bg-black/30 transition-colors hover:bg-black/40"
          )}
        >
          <span
            className={cn(
              "flex h-16 w-16 items-center justify-center rounded-full",
              "bg-primary/95 text-primary-foreground shadow-lg backdrop-blur",
              "transition-transform group-hover:scale-105"
            )}
          >
            {isLoading ? (
              <Loader2 className="h-7 w-7 animate-spin" />
            ) : (
              <Play className="h-8 w-8 fill-current" style={{ marginLeft: 3 }} />
            )}
          </span>
          {download ? (
            <span
              aria-live="polite"
              className="rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white/90 backdrop-blur"
            >
              {download.pct !== null && download.totalMb !== null
                ? `Downloading recording… ${download.pct}% of ${Math.max(1, Math.round(download.totalMb))} MB`
                : "Downloading recording…"}
            </span>
          ) : null}
        </button>
      ) : null}

      {/* Loading spinner while buffering after first play */}
      {hasStarted && isLoading && !hasError ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-white/90 drop-shadow" />
        </div>
      ) : null}

      {/* Bottom control bar with gradient backdrop */}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 z-20",
          "bg-linear-to-t from-black/80 via-black/40 to-transparent",
          "px-3 pb-2 pt-10 transition-opacity duration-200",
          controlsVisible || !isPlaying ? "opacity-100" : "opacity-0"
        )}
      >
        {/* Progress bar — drag-to-scrub */}
        <div
          role="slider"
          tabIndex={hasError ? -1 : 0}
          aria-valuemin={0}
          aria-valuemax={Math.floor(duration) || 0}
          aria-valuenow={Math.floor(currentTime)}
          aria-label="Seek"
          onPointerDown={onScrubberPointerDown}
          onPointerMove={onScrubberPointerMove}
          onPointerUp={onScrubberPointerEnd}
          onPointerCancel={onScrubberPointerEnd}
          onKeyDown={onScrubberKey}
          className={cn(
            "pointer-events-auto group/seek relative h-1 cursor-pointer touch-none rounded-full bg-white/25",
            "hover:h-1.5",
            isSeeking && "h-1.5",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            hasError && "cursor-not-allowed opacity-60"
          )}
        >
          <div
            className={cn(
              "absolute left-0 top-0 h-full rounded-full bg-primary",
              !isSeeking && "transition-[width] duration-75"
            )}
            style={{ width: `${progressPct}%` }}
          />
          <div
            className={cn(
              "absolute top-1/2 h-3 w-3 -translate-y-1/2 -translate-x-1/2 rounded-full",
              "bg-primary shadow-md transition-opacity",
              isSeeking ? "opacity-100" : "opacity-0 group-hover/seek:opacity-100"
            )}
            style={{ left: `${progressPct}%` }}
          />
        </div>

        {/* Bottom row: play, time, volume, fullscreen */}
        <div className="pointer-events-auto mt-2 flex items-center gap-2 text-white">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              void togglePlay()
            }}
            disabled={hasError}
            aria-label={isPlaying ? "Pause" : "Play"}
            className={cn(
              "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
              "text-white/95 transition-colors hover:bg-white/10",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              hasError && "cursor-not-allowed opacity-50"
            )}
          >
            {isLoading && !hasError ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isPlaying ? (
              <Pause className="h-4 w-4 fill-current" />
            ) : (
              <Play className="h-4 w-4 fill-current" style={{ marginLeft: 1 }} />
            )}
          </button>

          {/* Volume cluster */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                toggleMute()
              }}
              aria-label={isMuted ? "Unmute" : "Mute"}
              className={cn(
                "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                "text-white/95 transition-colors hover:bg-white/10",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              )}
            >
              <VolumeIcon className="h-4 w-4" />
            </button>
            {/* Volume slider — drag-to-set */}
            <div
              role="slider"
              tabIndex={0}
              aria-label="Volume"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round((isMuted ? 0 : volume) * 100)}
              onPointerDown={onVolumePointerDown}
              onPointerMove={onVolumePointerMove}
              onPointerUp={onVolumePointerEnd}
              onPointerCancel={onVolumePointerEnd}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight") {
                  e.preventDefault()
                  setVolumePct(volume + 0.05)
                } else if (e.key === "ArrowLeft") {
                  e.preventDefault()
                  setVolumePct(volume - 0.05)
                }
              }}
              className={cn(
                "group/volume relative h-1 w-20 cursor-pointer touch-none rounded-full bg-white/25",
                "hover:h-1.5",
                isAdjustingVolume && "h-1.5",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              )}
            >
              <div
                className={cn(
                  "absolute left-0 top-0 h-full rounded-full bg-white",
                  !isAdjustingVolume && "transition-[width] duration-75"
                )}
                style={{ width: `${(isMuted ? 0 : volume) * 100}%` }}
              />
              {/* Draggable thumb — always visible on hover, locked-on while dragging */}
              <div
                className={cn(
                  "absolute top-1/2 h-3 w-3 -translate-y-1/2 -translate-x-1/2 rounded-full",
                  "bg-white shadow-md transition-opacity",
                  isAdjustingVolume
                    ? "opacity-100"
                    : "opacity-0 group-hover/volume:opacity-100"
                )}
                style={{ left: `${(isMuted ? 0 : volume) * 100}%` }}
              />
            </div>
          </div>

          {/* Time readout */}
          <span className="ml-1 select-none font-mono text-[11px] tabular-nums text-white/80">
            {formatTime(currentTime)}
            <span className="mx-1 text-white/40">/</span>
            {duration ? formatTime(duration) : "0:00"}
          </span>

          <div className="flex-1" />

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              void toggleFullscreen()
            }}
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            className={cn(
              "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
              "text-white/95 transition-colors hover:bg-white/10",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            )}
          >
            {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {hasError ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 text-sm text-destructive">
          Failed to load this recording.
        </div>
      ) : null}
    </div>
  )
}
