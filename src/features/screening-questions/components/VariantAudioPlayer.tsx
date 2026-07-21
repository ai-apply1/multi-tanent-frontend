import { useRef, useState } from "react"
import { Loader2, Pause, Play } from "lucide-react"
import toast from "react-hot-toast"
import { getQuestionVariantAudioUrl } from "@/features/screening-questions/screeningQuestionsApi"
import { errorMessage as apiError } from "@/lib/errors"

interface VariantAudioPlayerProps {
  questionId: string
  variantId: string
}

/**
 * Play/pause a bank wording's generated clip.
 *
 * The clip lives under a private S3 prefix, so it can't be linked directly —
 * the URL is minted on demand by the backend and fetched only when the
 * operator first presses play (not on render), matching how the interview
 * drawer plays its presigned clips. The `<audio>` element is rendered in JSX
 * (hidden) and driven through a ref, with its `src` coming from state so the
 * URL is never mutated behind React's back; it is re-fetched once it has
 * plausibly expired (the presign is 10 min).
 *
 * Rendered only for wordings that are actually ready — there is nothing to
 * play otherwise, and that keeps this component from having to reason about
 * generation state (its sibling `VariantAudioStatus` owns that).
 */
export function VariantAudioPlayer({
  questionId,
  variantId
}: VariantAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const fetchedAtRef = useRef(0)
  const [url, setUrl] = useState("")
  const [loading, setLoading] = useState(false)
  const [playing, setPlaying] = useState(false)

  const ensureUrl = async (): Promise<string> => {
    // Re-fetch a minute inside the 10-min TTL rather than risk playing a
    // just-expired URL and getting a 403 mid-press.
    if (url && Date.now() - fetchedAtRef.current < 9 * 60_000) return url
    const fresh = await getQuestionVariantAudioUrl(questionId, variantId)
    fetchedAtRef.current = Date.now()
    setUrl(fresh.url)
    return fresh.url
  }

  const toggle = async () => {
    const el = audioRef.current
    if (!el) return
    if (playing) {
      el.pause()
      return
    }
    setLoading(true)
    try {
      const next = await ensureUrl()
      // Drive `src` PURELY through the ref — never also through a React prop.
      // Binding it to state as well meant the `setUrl` inside `ensureUrl`
      // re-rendered and made React write `src` a SECOND time; that load landed
      // while the `play()` below was still pending and interrupted it —
      // "The play() request was interrupted by a new load request". Assign once,
      // only when it actually changed, then play.
      if (el.src !== next && el.currentSrc !== next) el.src = next
      await el.play()
    } catch (err) {
      // A load or pause that lands while play() is still pending rejects it
      // with AbortError — benign (the operator paused or re-pressed). Only real
      // failures (expired URL → 403, network, decode) should surface.
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        toast.error(apiError(err, "Could not play this clip."))
      }
      setPlaying(false)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* `src` is set imperatively in `toggle` (via the ref), never here — a
          React-managed `src` would re-load the element and interrupt play(). */}
      <audio
        ref={audioRef}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <button
        type="button"
        onClick={toggle}
        disabled={loading}
        aria-label={playing ? "Pause audio" : "Play audio"}
        title={playing ? "Pause" : "Play this wording"}
        className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-primary hover:bg-accent disabled:opacity-50"
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.9} />
        ) : playing ? (
          <Pause className="h-3.5 w-3.5" strokeWidth={1.9} />
        ) : (
          <Play className="h-3.5 w-3.5" strokeWidth={1.9} />
        )}
      </button>
    </>
  )
}
