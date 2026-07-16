import type { InterviewStatus } from "@/features/interviews/types"

export const statusLabels: Record<InterviewStatus, string> = {
  pending: "Pending",
  in_progress: "In progress",
  submitted: "Submitted",
  expired: "Expired"
}

/**
 * `success`/`warning`/`purple` don't adapt to dark mode (see `ui/badge.tsx`),
 * so the drawer's badges stick to variants that do.
 */
export const statusVariant: Record<
  InterviewStatus,
  "default" | "secondary" | "outline" | "muted"
> = {
  pending: "muted",
  in_progress: "default",
  submitted: "secondary",
  expired: "outline"
}

/**
 * AI verdict labels. The band is derived from the JOB's `rejectionThreshold`,
 * not a global constant:
 *   overall×10 ≥ min(threshold + 20, 90) → strong_yes
 *   overall×10 ≥ threshold               → yes
 *   else                                 → no
 */
export const recommendationLabels: Record<string, string> = {
  strong_yes: "Strong yes",
  yes: "Yes",
  no: "No"
}

export function formatRecommendation(rec?: string | null) {
  if (!rec) return "—"
  return recommendationLabels[rec] ?? rec.replace(/_/g, " ")
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

/** Years of experience, trimmed to at most one decimal ("3", "3.5"). */
export function formatYears(years?: number | null) {
  if (years == null || Number.isNaN(years)) return "—"
  const rounded = Math.round(years * 10) / 10
  return `${rounded}`
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

/** Format a recording offset (seconds) as a clock string ("1:23" / "1:02:03"). */
export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`
  }
  return `${m}:${sec.toString().padStart(2, "0")}`
}
