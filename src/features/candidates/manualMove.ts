import type { CandidateStatus, ManualMovePolicy } from "@/features/candidates/types"

/**
 * Which kanban columns a HUMAN may move a candidate into — the client half of
 * the backend's `manualMovePolicy` guard, so the three surfaces that offer a
 * status change (the row menu, the board's drag-and-drop, the interview
 * drawer's decision buttons) can grey the illegal targets out instead of
 * letting someone click and collect a 409.
 *
 * The board's columns are two different kinds of claim. Some state a FACT about
 * what the candidate did — an invite went out, they started their interview,
 * the AI graded it — and dragging a card cannot make any of that true, it can
 * only make the board contradict the interview records. Others record a
 * DECISION we made: shortlisted, rejected, finalized. Only the second kind is
 * ours to set by hand, and that includes every custom column an org invents,
 * because only they know what theirs mean.
 *
 * ADVISORY ONLY. The server is the gate — it re-checks with the authoritative
 * signal (an interview document's `startedAt`), while this reads the
 * denormalised `attemptCount` off the row we already have. They agree in
 * practice (nothing writes that counter but the begin-time ratchet), and if
 * they ever didn't, the worst case is an enabled option the server refuses,
 * which surfaces as the existing error toast. Never the reverse: this file
 * cannot authorise anything.
 */

/**
 * The minimum a candidate row must expose to be checked. Deliberately just the
 * counter: it is present on BOTH the list row (`CandidateBase`) and the slim
 * kanban card (`KanbanCard`), which the populated interview pointer is not, so
 * one helper serves every surface.
 */
export interface ManualMoveEvidence {
  /** Interview attempts actually STARTED. `>= 1` ⇒ they have interviewed. */
  attemptCount: number
}

/** Just enough of a column to judge it — so a `KanbanColumn` fits too. */
export type ManualMoveTarget = Pick<CandidateStatus, "key" | "label"> & {
  manualMovePolicy?: ManualMovePolicy
}

/**
 * Why this manual move is refused, or `null` when it's allowed. The string is
 * written to read as a tooltip on a disabled menu item, so it says what the
 * column means and what to do instead — not "forbidden".
 *
 * An absent `manualMovePolicy` counts as `"manual"`: a tenant whose catalog
 * predates the field must keep behaving exactly as it does today rather than
 * having its menu mysteriously lock up. The backend's schema default reads it
 * the same way, and reconciles the builtins on the next catalog load.
 */
export function manualMoveBlocker(
  target: ManualMoveTarget,
  candidate: ManualMoveEvidence
): string | null {
  const policy = target.manualMovePolicy ?? "manual"

  if (policy === "system") {
    // Each system column has its own "do this instead". `invited` and
    // `interviewing` share one action; `applied` has none — it only ever means
    // "this application just arrived", and Needs Review is the re-triage column.
    let hint = ""
    if (target.key === "invited" || target.key === "interviewing") {
      hint = ` Use "Send Interview invite" — it re-sends their current link, or opens a new attempt if they already sat one.`
    } else if (target.key === "applied") {
      hint = ` Move them to "Needs Review" to look at them again.`
    }
    return `Candidates reach "${target.label}" on their own — it can't be set by hand.${hint}`
  }

  const interviewed = (candidate.attemptCount ?? 0) >= 1

  if (policy === "pre_interview" && interviewed) {
    const hint =
      target.key === "rejected"
        ? ` Use "Final Rejection" for someone you interviewed and turned down.`
        : ""
    return `"${target.label}" is for candidates who haven't interviewed yet, and this one already has.${hint}`
  }

  if (policy === "post_interview" && !interviewed) {
    return `"${target.label}" is for candidates who have actually sat their interview, and this one hasn't started it yet.`
  }

  return null
}
