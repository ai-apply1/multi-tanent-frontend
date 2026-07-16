import type { InterviewStatus, OverallScores } from "@/features/interviews/types"

export const statusLabels: Record<InterviewStatus, string> = {
  in_progress: "In progress",
  submitted: "Submitted",
  analyzed: "Analyzed"
}

export const statusVariant: Record<InterviewStatus, "default" | "warning" | "success" | "muted"> = {
  in_progress: "warning",
  submitted: "default",
  analyzed: "success"
}

/**
 * Binary recommendation labels — `strong_yes` / `maybe` were
 * retired in the May 2026 simplification (overall >=
 * `APPLICATION_AI_PASS_THRESHOLD` on backend, default 7 → "yes",
 * else "no"). Legacy interview docs scored under the old prompt
 * still get rendered correctly because the backend's
 * `mirrorVerdictToApplicant` overrides their `recommendation`
 * field to the new binary value the next time a scoring job
 * touches the doc.
 */
export const recommendationLabels: Record<string, string> = {
  yes: "Yes",
  no: "No",
  // Defensive fallbacks for legacy records that haven't been
  // re-touched by the scoring worker yet.
  strong_yes: "Yes",
  maybe: "No"
}

export const recommendationVariant: Record<
  string,
  "successSolid" | "default" | "warning" | "destructiveSolid" | "muted"
> = {
  yes: "successSolid",
  no: "destructiveSolid",
  strong_yes: "successSolid",
  maybe: "destructiveSolid"
}

export function formatRecommendation(rec?: string) {
  if (!rec) return "—"
  return recommendationLabels[rec] ?? rec.replace(/_/g, " ").toUpperCase()
}

export function formatRole(role?: string | null) {
  if (!role) return "—"
  return role
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ")
}

export function formatSessionIdTail(id?: string | null, length = 8) {
  if (!id) return ""
  return id.slice(-length)
}

export function formatScore(score?: number | null, opts?: { suffix?: string }) {
  if (score == null || Number.isNaN(score)) return "—"
  const rounded = Math.round(score * 10) / 10
  return `${rounded}${opts?.suffix ?? ""}`
}

export function formatDateTime(value?: string | null) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  })
}

export function durationBetween(start?: string | null, end?: string | null) {
  if (!start || !end) return "—"
  const a = new Date(start).getTime()
  const b = new Date(end).getTime()
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return "—"
  const ms = b - a
  const totalMinutes = Math.floor(ms / 60_000)
  if (totalMinutes < 60) return `${totalMinutes}m`
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

export function overallScoreOf(item: { scores?: { overall?: OverallScores } | undefined }): number | null {
  const v = item.scores?.overall?.overall
  return typeof v === "number" ? v : null
}
