import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent
} from "react"
import Hls from "hls.js"
import {
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  PlayCircle,
  Volume1,
  Volume2,
  VolumeX
} from "lucide-react"
import clsx from "clsx"
import { apiUrl } from "@/lib/api"
import { BASIC_AUTH_HEADER } from "@/lib/basicAuth"

/**
 * Admin-side ApplyVideoPlayer — visual + behavioural port of the
 * landing-page's `/apply` intro video player (same custom HLS
 * controls, same scrub bar, same volume slider, same fullscreen
 * handling) so admins previewing the bundle see EXACTLY what the
 * candidate will see on the public page.
 *
 * Differences from the landing-page version (kept intentionally
 * small so this file stays diff-friendly with the source of
 * truth):
 *
 *   1. No `"use client"` directive — Vite + React, not Next.js.
 *   2. `BASIC_AUTH_HEADER` is imported from the admin dashboard's
 *      local lib (`@/lib/basicAuth`) rather than the landing-page's
 *      `@/lib/api/basicAuth`. The header value flows identically
 *      via hls.js's `xhrSetup`.
 *   3. Simpler public surface — `manifestUrl` + optional
 *      `durationSec` instead of the landing's `playerStatus`
 *      object (the admin doesn't share the gate hook). The inner
 *      `HlsPlayer` is unchanged and still accepts `enforceWatch`
 *      as a prop, but the admin's outer wrapper hardcodes that
 *      false — admins should always be able to scrub freely.
 *
 * If you change the landing-page player, mirror the change here
 * (or vice versa). At the time of this comment they share ~95%
 * of the logic; if the drift grows, lift into a workspace package.
 */
/**
 * A point of interest on the recording timeline. The interview reviewer
 * builds one per question (label = question text, atSec = when it was asked)
 * to caption the recording and mark the scrubber.
 */
export interface VideoChapter {
  /** Offset into the recording, in seconds. */
  atSec: number
  /** Text shown as the caption while this chapter is active. */
  label: string
}

/** Imperative handle a parent can use to drive the player (jump to a question). */
export interface VideoPlayerHandle {
  /** Seek to `sec` (clamped to the clip), then start playback. */
  seekTo: (sec: number) => void
}

interface ApplyVideoPlayerProps {
  /**
   * HLS manifest URL the admin preview should play. Pass `null`
   * while the parent is still fetching the bundle status — the
   * player renders a "Loading…" placeholder in that case.
   */
  manifestUrl: string | null
  /**
   * Optional pre-known duration (in seconds). The backend reports
   * this on the bundle status response, and seeding it here avoids
   * a "—:—" flicker in the time readout before hls.js parses the
   * manifest's `EXT-X-TARGETDURATION` markers.
   */
  durationSec?: number
  /**
   * Send cookies on every hls.js XHR (manifest / segment). Defaults
   * `false` — the apply-video endpoints are public + perimeter-Basic-
   * Auth only. The interview drawer reuses this player against
   * admin-cookie-gated endpoints, so it passes `true` to carry the
   * `access_token` cookie through to the JwtAuthGuard.
   */
  withCredentials?: boolean
  /**
   * Timeline markers. When present, the active chapter's label is shown as a
   * caption over the video and ticks are drawn on the scrubber.
   */
  chapters?: VideoChapter[]
  /**
   * Optional handle the parent populates with imperative controls (e.g.
   * `seekTo`) so it can jump the player to a question. A plain ref-prop is
   * used instead of `forwardRef` to keep the component a hoisted declaration.
   */
  apiRef?: MutableRefObject<VideoPlayerHandle | null>
}

/**
 * /apply intro video.
 *
 *   - Outer component: thin wrapper that picks one of three views
 *     based on `playerStatus`:
 *       - `null` → loading placeholder
 *       - `hasReadyVideo: false` → "Video coming soon" placeholder
 *       - otherwise → mount `<HlsPlayer />` with the manifest URL
 *
 *   - Inner `HlsPlayer`: visual + behavioural port of the training
 *     portal's `HlsVideoPlayer`. Two deliberate differences:
 *       - NO watermark. This is public marketing content the
 *         candidate is supposed to share, not paid candidate
 *         material.
 *       - Auth is the perimeter Basic Auth header (built-time baked
 *         into `NEXT_PUBLIC_API_BASIC_AUTH*`) instead of training's
 *         `training_access_token` cookie. Attached via `xhrSetup`
 *         on every manifest / segment fetch.
 *
 *   When `enforceWatch` is on, the inner player also:
 *
 *       - Tracks `maxWatchedSec` (the furthest currentTime reached
 *         through natural playback — backward seeks DO NOT reset it
 *         and DO NOT contribute to it).
 *       - Clamps every forward seek (pointer, keyboard, video click)
 *         to `maxWatchedSec`.
 *       - Renders a darker "locked" region on the scrubber from
 *         `maxWatchedSec / duration` to the right edge, with a small
 *         lock icon and a hint banner over the picture.
 *       - Fires `onWatched()` when `maxWatchedSec / duration >= 0.9`
 *         OR when the `ended` event fires (some videos / browsers
 *         can skip the last fraction of a percent).
 */
const ApplyVideoPlayer: React.FC<ApplyVideoPlayerProps> = ({
  manifestUrl,
  durationSec,
  withCredentials = false,
  chapters,
  apiRef
}) => {
  if (!manifestUrl) {
    return <Placeholder loading />
  }
  return (
    <div className="aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-black shadow-inner">
      <HlsPlayer
        manifestUrl={manifestUrl}
        knownDurationSec={durationSec}
        enforceWatch={false}
        withCredentials={withCredentials}
        chapters={chapters}
        apiRef={apiRef}
      />
    </div>
  )
}

export default ApplyVideoPlayer

// ---------------------------------------------------------------------------
// Placeholder — shown during initial load and when no video is published
// ---------------------------------------------------------------------------

function Placeholder({ loading }: { loading: boolean }) {
  return (
    <div className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] shadow-inner backdrop-blur-xl">
      <div className="flex flex-col items-center gap-2 text-white/40">
        <PlayCircle className="h-12 w-12 sm:h-16 sm:w-16" />
        <span className="text-[10px] font-bold uppercase tracking-widest sm:text-xs">
          {loading ? "Loading…" : "Video coming soon"}
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// HlsPlayer — full custom HLS player
// ---------------------------------------------------------------------------

interface HlsPlayerProps {
  manifestUrl: string
  knownDurationSec?: number
  enforceWatch: boolean
  onWatched?: () => void
  withCredentials?: boolean
  chapters?: VideoChapter[]
  apiRef?: MutableRefObject<VideoPlayerHandle | null>
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
 * Fraction of duration that counts as "watched". 90% gives enough
 * grace for outros / late ad-breaks without letting a user skip
 * past most of the content. The video's `ended` event is also a
 * trigger — whichever fires first wins.
 */
const WATCH_THRESHOLD = 0.9

function HlsPlayer({
  manifestUrl,
  knownDurationSec,
  enforceWatch,
  onWatched,
  withCredentials = false,
  chapters,
  apiRef
}: HlsPlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const hideControlsTimer = useRef<number | null>(null)

  const [isPlaying, setIsPlaying] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [hasError, setHasError] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [hasStarted, setHasStarted] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState<number>(() =>
    knownDurationSec && knownDurationSec > 0 ? knownDurationSec : 0
  )
  const [volume, setVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [isSeeking, setIsSeeking] = useState(false)
  const [isAdjustingVolume, setIsAdjustingVolume] = useState(false)
  // Question caption overlay — on by default whenever chapters are provided.
  const [captionsOn, setCaptionsOn] = useState(true)

  // Furthest natural-playback position reached. Increments only via
  // `timeupdate` while the user isn't actively scrubbing. Backward
  // seeks reduce currentTime but DO NOT reset maxWatchedSec, so the
  // user can rewind freely once they've reached a given position.
  const [maxWatchedSec, setMaxWatchedSec] = useState(0)
  // Latched: once we fire `onWatched`, don't fire again. We keep the
  // ref alongside state so the threshold-detector inside
  // `timeupdate` reads the latest value without needing the effect
  // to re-attach.
  const watchedFiredRef = useRef(false)

  // The seek ceiling shown to the user:
  //   - enforceWatch off: full duration (free scrub)
  //   - enforceWatch on:  the further of the user's maxWatchedSec
  //                       and the threshold portion already covered.
  //     We add a tiny grace (`+1s`) so a seek-to-current-position
  //     click doesn't get clamped back by rounding noise.
  const seekableEnd = enforceWatch
    ? Math.max(0, Math.min(duration, maxWatchedSec + 1))
    : duration

  // ── hls.js attach / detach ─────────────────────────────────────────────
  useEffect(() => {
    setErrorMsg(null)
    setHasError(false)
    setIsLoading(true)
    setHasStarted(false)
    setCurrentTime(0)
    setMaxWatchedSec(0)
    watchedFiredRef.current = false
    if (knownDurationSec && knownDurationSec > 0) {
      setDuration(knownDurationSec)
    } else {
      setDuration(0)
    }

    const video = videoRef.current
    if (!video) return

    let hls: Hls | null = null
    let networkRetry = 0
    let mediaRetry = 0

    const reportFatal = (msg: string) => {
      setIsLoading(false)
      setHasError(true)
      setErrorMsg(msg)
    }

    if (Hls.isSupported()) {
      hls = new Hls({
        xhrSetup: (xhr) => {
          // Perimeter Basic Auth, attached manually because hls.js mints
          // its own XHRs (axios's default header doesn't reach them).
          if (BASIC_AUTH_HEADER) {
            xhr.setRequestHeader("Authorization", BASIC_AUTH_HEADER)
          }
          // Public apply-video → false; admin-cookie-gated interview
          // drawer → true (carries the access_token cookie to the
          // JwtAuthGuard'd HLS endpoints).
          xhr.withCredentials = withCredentials
        },
        autoStartLoad: true,
        backBufferLength: 30,
        maxBufferLength: 30
      })
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setIsLoading(false)
      })
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!hls) return
        // eslint-disable-next-line no-console
        console.warn("[apply-video] hls error", {
          type: data.type,
          details: data.details,
          fatal: data.fatal,
          reason: data.reason,
          response: data.response
        })
        if (!data.fatal) return
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            if (networkRetry < 2) {
              networkRetry += 1
              hls.startLoad()
              return
            }
            reportFatal(
              "Network error while streaming the intro video. Check your connection and try again."
            )
            return
          case Hls.ErrorTypes.MEDIA_ERROR:
            if (mediaRetry < 1) {
              mediaRetry += 1
              hls.recoverMediaError()
              return
            }
            reportFatal("This video's format is not supported by your browser.")
            return
          default:
            reportFatal("Could not load the intro video. Please refresh and try again.")
        }
      })
      hls.loadSource(apiUrl(manifestUrl))
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari native HLS fallback — no JS hook to attach Basic Auth
      // to segment requests. Modern Safari (16.4+) supports MSE
      // (hls.js path) so this branch only matters on legacy iOS.
      video.src = apiUrl(manifestUrl)
      const onLoaded = () => setIsLoading(false)
      const onError = () => {
        if (BASIC_AUTH_HEADER) {
          reportFatal(
            "Your browser can't send the required authentication header. " +
              "Please update to the latest Safari (16.4+) or use Chrome / Edge."
          )
        } else {
          reportFatal("Could not load the intro video. Please refresh and try again.")
        }
      }
      video.addEventListener("loadedmetadata", onLoaded, { once: true })
      video.addEventListener("error", onError, { once: true })
    } else {
      setIsLoading(false)
      setHasError(true)
      setErrorMsg("Your browser doesn't support this video format.")
    }

    return () => {
      if (hls) hls.destroy()
      try {
        video.pause()
      } catch {
        /* ignore */
      }
      video.removeAttribute("src")
      video.load()
    }
  }, [manifestUrl, knownDurationSec, withCredentials])

  useEffect(() => {
    if (knownDurationSec && knownDurationSec > 0) {
      setDuration(knownDurationSec)
    }
  }, [knownDurationSec])

  // ── runtime event wiring ──────────────────────────────────────────────
  //
  // The "watched" trigger lives here so the threshold check sees the
  // freshest `duration` value (which can arrive via several event
  // handlers depending on the source format / hls.js version).
  useEffect(() => {
    const v = videoRef.current
    if (!v) return

    const tryUpdateDuration = () => {
      if (Number.isFinite(v.duration) && v.duration > 0) {
        setDuration((prev) => (v.duration > prev ? v.duration : prev))
      }
    }

    const fireWatchedOnce = () => {
      if (watchedFiredRef.current) return
      watchedFiredRef.current = true
      onWatched?.()
    }

    const onTime = () => {
      if (!Number.isFinite(v.currentTime) || v.currentTime >= 1e7) return
      setCurrentTime(v.currentTime)

      // Only natural playback bumps maxWatched. While the user is
      // actively dragging the scrubber we set `currentTime` via the
      // seek handler — which DOES fire `timeupdate` — so we need to
      // ignore those bumps. `isSeeking` (state) covers pointer
      // drag; we additionally guard with `v.seeking` (the native
      // flag set during a programmatic seek that hasn't completed)
      // for keyboard-driven seeks where `isSeeking` is false.
      if (!isSeeking && !v.seeking) {
        setMaxWatchedSec((prev) =>
          v.currentTime > prev ? v.currentTime : prev
        )
      }

      if (duration > 0 && v.currentTime / duration >= WATCH_THRESHOLD) {
        fireWatchedOnce()
      }
    }

    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    const onEndedHandler = () => {
      setIsPlaying(false)
      // Even if maxWatchedSec didn't quite hit the threshold (e.g. a
      // few-second video where the ended event fires before the
      // 90% timeupdate sample), reaching the end counts as
      // watched.
      fireWatchedOnce()
    }
    const onWaiting = () => setIsLoading(true)
    const onPlaying = () => setIsLoading(false)
    const onVolumeChange = () => {
      setVolume(v.volume)
      setIsMuted(v.muted || v.volume === 0)
    }
    const onError = () => {
      // eslint-disable-next-line no-console
      console.warn("[apply-video] native video error", v.error)
    }

    v.addEventListener("durationchange", tryUpdateDuration)
    v.addEventListener("loadedmetadata", tryUpdateDuration)
    v.addEventListener("loadeddata", tryUpdateDuration)
    v.addEventListener("progress", tryUpdateDuration)
    v.addEventListener("canplay", tryUpdateDuration)
    v.addEventListener("timeupdate", onTime)
    v.addEventListener("play", onPlay)
    v.addEventListener("pause", onPause)
    v.addEventListener("ended", onEndedHandler)
    v.addEventListener("waiting", onWaiting)
    v.addEventListener("playing", onPlaying)
    v.addEventListener("volumechange", onVolumeChange)
    v.addEventListener("error", onError)

    return () => {
      v.removeEventListener("durationchange", tryUpdateDuration)
      v.removeEventListener("loadedmetadata", tryUpdateDuration)
      v.removeEventListener("loadeddata", tryUpdateDuration)
      v.removeEventListener("progress", tryUpdateDuration)
      v.removeEventListener("canplay", tryUpdateDuration)
      v.removeEventListener("timeupdate", onTime)
      v.removeEventListener("play", onPlay)
      v.removeEventListener("pause", onPause)
      v.removeEventListener("ended", onEndedHandler)
      v.removeEventListener("waiting", onWaiting)
      v.removeEventListener("playing", onPlaying)
      v.removeEventListener("volumechange", onVolumeChange)
      v.removeEventListener("error", onError)
    }
  }, [manifestUrl, duration, isSeeking, onWatched])

  // ── fullscreen state subscription ─────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current
    const video = videoRef.current
    const onFs = () => {
      const standardFs = document.fullscreenElement === container
      const doc = document as unknown as {
        webkitFullscreenElement?: Element | null
      }
      const webkitContainerFs = doc.webkitFullscreenElement === container
      const v = video as unknown as { webkitDisplayingFullscreen?: boolean } | null
      const iosVideoFs = v?.webkitDisplayingFullscreen === true
      setIsFullscreen(Boolean(standardFs || webkitContainerFs || iosVideoFs))
    }
    document.addEventListener("fullscreenchange", onFs)
    document.addEventListener("webkitfullscreenchange", onFs as EventListener)
    video?.addEventListener("webkitbeginfullscreen", onFs as EventListener)
    video?.addEventListener("webkitendfullscreen", onFs as EventListener)
    return () => {
      document.removeEventListener("fullscreenchange", onFs)
      document.removeEventListener(
        "webkitfullscreenchange",
        onFs as EventListener
      )
      video?.removeEventListener("webkitbeginfullscreen", onFs as EventListener)
      video?.removeEventListener("webkitendfullscreen", onFs as EventListener)
    }
  }, [])

  // ── core controls ────────────────────────────────────────────────────
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
      const isAtEnd =
        Number.isFinite(dur) && dur > 0 && v.currentTime >= dur - 0.05
      if (isAtEnd) {
        v.currentTime = 0
        setCurrentTime(0)
      }
      setHasStarted(true)
      await v.play()
    } catch {
      // Autoplay refusal / transient decoder hiccup — hls.js handles
      // real failures on its own ERROR pathway. Don't flip hasError.
    } finally {
      setIsLoading(false)
    }
  }, [hasError])

  /**
   * Apply a seek with the enforcement clamp. The video element's
   * native `currentTime` setter is the source of truth; we sync
   * React state to match. Targets past `seekableEnd` get clamped
   * back to it — quietly, no toast. The scrubber visualisation
   * already shows the locked region so the clamp isn't surprising.
   */
  const performSeek = useCallback(
    (target: number) => {
      const v = videoRef.current
      if (!v) return
      const clamped = Math.max(0, Math.min(seekableEnd, target))
      setCurrentTime(clamped)
      try {
        v.currentTime = clamped
      } catch {
        /* ignore — browser will reject targets outside seekable range */
      }
    },
    [seekableEnd]
  )

  const seekToPct = useCallback(
    (pct: number) => {
      if (!duration) return
      performSeek(Math.max(0, Math.min(1, pct)) * duration)
    },
    [duration, performSeek]
  )

  const seekBy = useCallback(
    (deltaSec: number) => {
      const v = videoRef.current
      if (!v || !duration) return
      performSeek(v.currentTime + deltaSec)
    },
    [duration, performSeek]
  )

  // Imperative jump-to-time used by the interview reviewer's question chips:
  // seek to the marker and start playback so the reviewer lands on it.
  const seekTo = useCallback(
    (sec: number) => {
      const v = videoRef.current
      if (!v) return
      performSeek(sec)
      setHasStarted(true)
      const p = v.play()
      if (p && typeof p.then === "function") p.catch(() => {})
    },
    [performSeek]
  )

  // Publish the imperative handle to the parent via a plain ref-prop (keeps
  // this component a hoisted function declaration rather than a forwardRef).
  useEffect(() => {
    if (!apiRef) return
    apiRef.current = { seekTo }
    return () => {
      apiRef.current = null
    }
  }, [apiRef, seekTo])

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
    const v = videoRef.current
    if (!c) return
    const doc = document as unknown as {
      webkitFullscreenElement?: Element | null
      webkitExitFullscreen?: () => Promise<void> | void
    }
    const wrapper = c as unknown as {
      webkitRequestFullscreen?: () => Promise<void> | void
    }
    const videoEl = v as unknown as {
      webkitEnterFullscreen?: () => void
      webkitExitFullscreen?: () => void
      webkitDisplayingFullscreen?: boolean
    } | null
    if (document.fullscreenElement === c) {
      try {
        await document.exitFullscreen()
      } catch {
        /* ignore */
      }
      return
    }
    if (doc.webkitFullscreenElement === c) {
      try {
        await doc.webkitExitFullscreen?.()
      } catch {
        /* ignore */
      }
      return
    }
    if (videoEl?.webkitDisplayingFullscreen === true) {
      try {
        videoEl.webkitExitFullscreen?.()
      } catch {
        /* ignore */
      }
      return
    }
    if (typeof c.requestFullscreen === "function") {
      try {
        await c.requestFullscreen()
        return
      } catch {
        /* fall through */
      }
    }
    if (typeof wrapper.webkitRequestFullscreen === "function") {
      try {
        await wrapper.webkitRequestFullscreen()
        return
      } catch {
        /* fall through */
      }
    }
    if (videoEl && typeof videoEl.webkitEnterFullscreen === "function") {
      try {
        videoEl.webkitEnterFullscreen()
      } catch {
        /* ignore */
      }
    }
  }, [])

  // ── auto-hide controls while playing ──────────────────────────────────
  const showControls = useCallback(() => {
    setControlsVisible(true)
    if (hideControlsTimer.current !== null) {
      window.clearTimeout(hideControlsTimer.current)
    }
    hideControlsTimer.current = window.setTimeout(() => {
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
    if (!isPlaying || isSeeking || isAdjustingVolume) setControlsVisible(true)
  }, [isPlaying, isSeeking, isAdjustingVolume])

  // ── keyboard shortcuts ────────────────────────────────────────────────
  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
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
          // End during enforcement jumps to the seekable ceiling, not
          // to the actual duration. `seekToPct(1)` runs through
          // `performSeek` which clamps to `seekableEnd`.
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

  // ── progress bar percentages ─────────────────────────────────────────
  const progressPct = useMemo(() => {
    if (!duration) return 0
    return Math.max(0, Math.min(100, (currentTime / duration) * 100))
  }, [currentTime, duration])

  const lockedFromPct = useMemo(() => {
    if (!enforceWatch || !duration) return 100
    return Math.max(0, Math.min(100, (seekableEnd / duration) * 100))
  }, [enforceWatch, duration, seekableEnd])

  // Question markers, sorted by time. The active one (last marker whose start
  // has passed) drives the caption overlay. A small lead (+0.25s) flips the
  // caption right as the question begins rather than a beat late.
  const sortedChapters = useMemo(
    () =>
      (chapters ?? [])
        .filter((c) => Number.isFinite(c.atSec) && c.atSec >= 0)
        .sort((a, b) => a.atSec - b.atSec),
    [chapters]
  )
  const activeChapter = useMemo(() => {
    let active: VideoChapter | null = null
    for (const c of sortedChapters) {
      if (currentTime + 0.25 >= c.atSec) active = c
      else break
    }
    return active
  }, [sortedChapters, currentTime])

  const seekDragPointerRef = useRef<number | null>(null)
  const volumeDragPointerRef = useRef<number | null>(null)

  const ratioFromPointer = (track: HTMLElement, clientX: number): number => {
    const rect = track.getBoundingClientRect()
    if (rect.width <= 0) return 0
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  }

  const onScrubberPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!duration || hasError) return
      if (e.pointerType === "mouse" && e.button !== 0) return
      e.stopPropagation()
      const el = e.currentTarget
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
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
        /* ignore */
      }
      seekDragPointerRef.current = null
      setIsSeeking(false)
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

  // ── volume slider ────────────────────────────────────────────────────
  const onVolumePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return
      e.stopPropagation()
      const el = e.currentTarget
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
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
      showControls()
    },
    [showControls]
  )

  const VolumeIcon =
    isMuted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label="Intro video player"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseMove={showControls}
      onMouseLeave={() => {
        if (isPlaying) setControlsVisible(false)
      }}
      className={clsx(
        "group relative isolate h-full w-full overflow-hidden bg-black",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-black"
      )}
    >
      <video
        ref={videoRef}
        preload="metadata"
        playsInline
        onClick={() => void togglePlay()}
        onDoubleClick={() => void toggleFullscreen()}
        className="block h-full w-full bg-black"
      >
        Sorry, your browser can&apos;t play this video.
      </video>

      {/* Big-play overlay before first play */}
      {!hasStarted && !hasError ? (
        <button
          type="button"
          aria-label="Play video"
          onClick={(e) => {
            e.stopPropagation()
            void togglePlay()
          }}
          className={clsx(
            "absolute inset-0 z-20 flex items-center justify-center",
            "bg-black/30 transition-colors hover:bg-black/40"
          )}
        >
          <span
            className={clsx(
              "flex h-16 w-16 items-center justify-center rounded-full text-white shadow-[0_10px_30px_rgba(133,12,255,0.35)] backdrop-blur",
              "bg-gradient-to-r from-primary to-secondary",
              "transition-transform group-hover:scale-105"
            )}
          >
            {isLoading ? (
              <Loader2 className="h-7 w-7 animate-spin" />
            ) : (
              <Play className="h-8 w-8 fill-current" style={{ marginLeft: 3 }} />
            )}
          </span>
        </button>
      ) : null}

      {/* Buffering spinner after first play */}
      {hasStarted && isLoading && !hasError ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-white/90 drop-shadow" />
        </div>
      ) : null}

      {/* Question caption — which question is being asked at this moment.
          Scales up in fullscreen (where the player fills a large monitor) so
          the question stays readable; windowed it stays compact. */}
      {captionsOn && activeChapter ? (
        <div
          className={clsx(
            "pointer-events-none absolute inset-x-0 z-30 flex justify-center px-4",
            isFullscreen ? "bottom-24" : "bottom-16"
          )}
        >
          <span
            className={clsx(
              "max-w-[92%] rounded-md bg-black/70 text-center font-medium leading-snug text-white shadow-lg backdrop-blur-sm",
              isFullscreen
                ? "px-5 py-2.5 text-2xl lg:text-3xl"
                : "px-3 py-1.5 text-sm"
            )}
          >
            {activeChapter.label}
          </span>
        </div>
      ) : null}

      {/* Bottom control bar */}
      <div
        className={clsx(
          "pointer-events-none absolute inset-x-0 bottom-0 z-30",
          "bg-gradient-to-t from-black/85 via-black/45 to-transparent",
          "px-3 pb-2 pt-10 transition-opacity duration-200",
          controlsVisible || !isPlaying ? "opacity-100" : "opacity-0"
        )}
      >
        {/* Drag-to-scrub progress bar */}
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
          className={clsx(
            "pointer-events-auto group/seek relative h-1 cursor-pointer touch-none rounded-full bg-white/25",
            "hover:h-1.5",
            isSeeking && "h-1.5",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            hasError && "cursor-not-allowed opacity-60"
          )}
        >
          {/* Locked-region overlay — visible only while
              `enforceWatch` is on AND the user hasn't yet reached
              the threshold. Sits above the base track so the
              "watched" portion still shows through the gradient. */}
          {enforceWatch && lockedFromPct < 100 ? (
            <div
              className="absolute top-0 h-full rounded-r-full bg-black/55"
              style={{
                left: `${lockedFromPct}%`,
                right: 0
              }}
            />
          ) : null}
          <div
            className={clsx(
              "absolute left-0 top-0 h-full rounded-full bg-gradient-to-r from-primary to-secondary",
              !isSeeking && "transition-[width] duration-75"
            )}
            style={{ width: `${progressPct}%` }}
          />
          {/* Question markers — visual guides to where each question begins. */}
          {duration > 0
            ? sortedChapters.map((c, i) => (
                <span
                  key={`tick-${i}-${c.atSec}`}
                  className="pointer-events-none absolute top-1/2 h-2 w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/70 shadow"
                  style={{ left: `${Math.min(100, (c.atSec / duration) * 100)}%` }}
                />
              ))
            : null}
          <div
            className={clsx(
              "absolute top-1/2 h-3 w-3 -translate-y-1/2 -translate-x-1/2 rounded-full",
              "bg-white shadow-md transition-opacity",
              isSeeking ? "opacity-100" : "opacity-0 group-hover/seek:opacity-100"
            )}
            style={{ left: `${progressPct}%` }}
          />
        </div>

        {/* Bottom row */}
        <div className="pointer-events-auto mt-2 flex items-center gap-2 text-white">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              void togglePlay()
            }}
            disabled={hasError}
            aria-label={isPlaying ? "Pause" : "Play"}
            className={clsx(
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
              className={clsx(
                "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                "text-white/95 transition-colors hover:bg-white/10",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              )}
            >
              <VolumeIcon className="h-4 w-4" />
            </button>
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
              className={clsx(
                "group/volume relative h-1 w-20 cursor-pointer touch-none rounded-full bg-white/25",
                "hover:h-1.5",
                isAdjustingVolume && "h-1.5",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              )}
            >
              <div
                className={clsx(
                  "absolute left-0 top-0 h-full rounded-full bg-white",
                  !isAdjustingVolume && "transition-[width] duration-75"
                )}
                style={{ width: `${(isMuted ? 0 : volume) * 100}%` }}
              />
              <div
                className={clsx(
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

          <span className="ml-1 select-none font-mono text-[11px] tabular-nums text-white/80">
            {formatTime(currentTime)}
            <span className="mx-1 text-white/40">/</span>
            {duration ? formatTime(duration) : "—:—"}
          </span>

          <div className="flex-1" />

          {sortedChapters.length > 0 ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setCaptionsOn((on) => !on)
              }}
              aria-label={captionsOn ? "Hide question captions" : "Show question captions"}
              aria-pressed={captionsOn}
              title={captionsOn ? "Hide question captions" : "Show question captions"}
              className={clsx(
                "inline-flex h-8 shrink-0 items-center justify-center rounded-md px-2 text-[11px] font-bold tracking-wide",
                "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                captionsOn ? "bg-white/15 text-white" : "text-white/70 hover:bg-white/10"
              )}
            >
              CC
            </button>
          ) : null}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              void toggleFullscreen()
            }}
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            className={clsx(
              "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
              "text-white/95 transition-colors hover:bg-white/10",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            )}
          >
            {isFullscreen ? (
              <Minimize className="h-4 w-4" />
            ) : (
              <Maximize className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {hasError ? (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/75 px-6 text-center text-sm text-rose-300">
          {errorMsg ?? "Could not load the intro video. Please refresh and try again."}
        </div>
      ) : null}
    </div>
  )
}
