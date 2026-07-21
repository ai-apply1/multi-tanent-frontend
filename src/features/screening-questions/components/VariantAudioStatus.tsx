import { AlertCircle, Loader2, RefreshCw, Volume2 } from "lucide-react"
import {
  variantAudioState,
  type QuestionVariant
} from "@/features/screening-questions/types"

interface VariantAudioStatusProps {
  /**
   * The SERVER's copy of this wording, or undefined for a draft the server
   * has never seen. Deliberately not the local form draft: audio belongs to
   * the saved text, and showing "ready" next to unsaved edits would claim the
   * clip matches words it does not.
   */
  variant?: QuestionVariant
  /** Retired wordings are never generated, so they show nothing at all. */
  retired: boolean
  onRetry: () => void
  busy?: boolean
}

/**
 * The audio state of ONE wording, with its retry.
 *
 * Reads from the server copy rather than the draft on purpose. While the
 * operator is mid-edit the two disagree, and the honest thing to report is
 * the state of the clip that actually exists — the moment they save, the
 * backend clears the flag for any wording whose text changed and this flips
 * to "Generating" on its own.
 */
export function VariantAudioStatus({
  variant,
  retired,
  onRetry,
  busy = false
}: VariantAudioStatusProps) {
  // A wording the server has never seen has no audio to report. Saying so
  // beats an empty gap, which reads as "generated" at a glance.
  if (!variant) {
    return (
      <span className="text-[11.5px] whitespace-nowrap text-ink-subtle">
        Audio after save
      </span>
    )
  }

  // Retired wordings are skipped by the worker — they can never reach a
  // candidate — so offering a retry here would queue work that never runs.
  if (retired) return null

  const state = variantAudioState(variant)

  if (state === "ready") {
    return (
      <span
        className="inline-flex items-center gap-1 text-[11.5px] whitespace-nowrap text-[var(--success)]"
        title="This wording has a generated voice clip."
      >
        <Volume2 className="h-3.5 w-3.5" strokeWidth={1.8} />
        Audio ready
      </span>
    )
  }

  if (state === "generating") {
    return (
      <span
        className="inline-flex items-center gap-1 text-[11.5px] whitespace-nowrap text-ink-muted"
        title="The voice clip is being generated in the background."
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
        Generating…
      </span>
    )
  }

  const failed = state === "failed"
  return (
    <button
      type="button"
      onClick={onRetry}
      disabled={busy}
      // The full reason, not a truncation: it is the only place the operator
      // learns whether this is "try again" or "fix the API key".
      title={
        failed
          ? `Audio generation failed: ${variant.audioError}\nClick to try again.`
          : "No voice clip yet. Click to generate."
      }
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] font-semibold whitespace-nowrap transition-colors disabled:opacity-50 ${
        failed
          ? "text-[var(--danger)] hover:bg-[var(--danger-soft)]"
          : "text-ink-muted hover:bg-surface-3"
      }`}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
      ) : failed ? (
        <AlertCircle className="h-3.5 w-3.5" strokeWidth={1.8} />
      ) : (
        <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
      )}
      {failed ? "Audio failed — retry" : "Generate audio"}
    </button>
  )
}
