import type { CandidateListInterview } from "@/features/candidates/types"

/**
 * The one place that turns a stored interview score into what HR reads.
 *
 * ── Why this is shared rather than inlined ─────────────────────────────
 *
 * The backend stores `scores.overall` on a **0-10** scale; every surface shows
 * 0-100. That conversion lived only inside the detail drawer, and the table had
 * no conversion at all because it had no number to convert — it hardcoded
 * `null` and rendered "Pending" on every row forever, including candidates the
 * scorer had finished. The table and the drawer gave different answers about
 * the same person.
 *
 * Now that both read the same field, the multiply-by-ten has to live in one
 * place or they will drift again, and a rounding difference is exactly the kind
 * of thing nobody notices until a candidate is 69 in one view and 70 in the
 * other, on opposite sides of a hiring threshold.
 */

/**
 * Stored 0-10 → displayed 0-100.
 *
 * Clamped because the scale is a convention the scoring worker maintains, not
 * something the schema enforces (`scores` is a Mixed prop): a model change that
 * emitted 0-100 directly would otherwise paint a 1000-wide bar.
 */
export const toDisplayScore = (overall: number): number =>
  Math.round(Math.max(0, Math.min(10, overall)) * 10)

/**
 * What the AI score column should say for one candidate.
 *
 * The states are distinct because they call for different things from HR, and
 * collapsing them is how a permanent spinner ends up meaning four different
 * situations:
 *
 *   scored    the number is in. Nothing to wait for.
 *   scoring   the worker is running. Come back in a minute.
 *   failed    the worker gave up. This one needs a human; it will never
 *             resolve on its own, and showing it as pending would be a lie
 *             that never expires.
 *   awaiting  the interview exists but the candidate hasn't submitted it.
 *             Waiting on THEM, not on us.
 *   none      no interview at all.
 *
 * `scored` wins over every status, deliberately: `needs_review` carries a real
 * rollup, and a re-score that fails after an earlier success must not blank a
 * number HR has already seen.
 */
export type AiScoreState =
  | { kind: "scored"; value: number }
  | { kind: "scoring" }
  | { kind: "failed" }
  | { kind: "awaiting" }
  | { kind: "none" }

export const aiScoreState = (
  interview: CandidateListInterview | null | undefined
): AiScoreState => {
  if (!interview) return { kind: "none" }

  const overall = interview.scores?.overall
  if (typeof overall === "number" && Number.isFinite(overall)) {
    return { kind: "scored", value: toDisplayScore(overall) }
  }

  switch (interview.scoringStatus) {
    case "queued":
    case "processing":
      return { kind: "scoring" }
    case "failed":
      return { kind: "failed" }
    default:
      // `idle` (never queued), or `done`/`needs_review` with no rollup — which
      // shouldn't happen, but reads correctly as "nothing to show yet" either
      // way. `submitted` with idle scoring means the queue hasn't picked it up.
      return interview.status === "submitted"
        ? { kind: "scoring" }
        : { kind: "awaiting" }
  }
}
