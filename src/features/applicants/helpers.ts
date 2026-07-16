import type { AiDecision, ApplicantStatus, InitialDecision } from "./types"

// ---------------------------------------------------------------------------
// Years-of-experience formatting.
//
// The OpenAI extractor returns `yearsOfExperience` as a free float
// (e.g. `0.75`, `2.33`, `5`, `5.0`) — those raw values look "scraped"
// when rendered as-is in the candidates table or the interview drawer
// ("0.75y experience", "2.33y experience" feel like leaked machine
// output, not curated UI text).
//
// The formatter here rounds to at most ONE decimal place and drops
// trailing zeros, via the Intl locale-aware NumberFormat:
//
//   0.75 → "0.8"
//   2.33 → "2.3"
//   5    → "5"
//   5.0  → "5"
//   0    → "0"   (callers usually filter `> 0` before calling)
//
// Locale is left at the user's browser default so a value like
// `2.5` reads as `"2,5"` on `en-DE` etc. — same posture as the
// other `Intl.*` calls in the dashboard.
// ---------------------------------------------------------------------------
export function formatYearsOfExperience(
  years: number | null | undefined
): string {
  if (years == null || !Number.isFinite(years)) return "—"
  if (years <= 0) return "0"
  try {
    return new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 1
    }).format(years)
  } catch {
    // Defensive: extremely rare Intl crashes on exotic locales. Falls
    // back to a manual one-decimal round so the cell still renders a
    // number instead of an "—".
    return (Math.round(years * 10) / 10).toString()
  }
}


// ---------------------------------------------------------------------------
// Marketing source display.
//
// Sources are the raw first-touch `utm_source` tags stored lowercased on the
// applicant (plus the synthetic "direct" for untagged arrivals). The dropdown
// options + the Source column show them in display case, splitting on the
// common tag separators:
//
//   "direct"     → "Direct"
//   "linkedin"   → "Linkedin"
//   "google_ads" → "Google Ads"
//   "spring-sale"→ "Spring Sale"
// ---------------------------------------------------------------------------
export function formatSourceLabel(source: string): string {
  if (source === "direct") return "Direct"
  return (
    source
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ") || "Direct"
  )
}


// ---------------------------------------------------------------------------
// City display casing.
//
// Cities are stored lowercased in the DB (so location grouping /
// matching is case-insensitive and free of the spelling-case noise the
// old free-text field produced). The admin always renders them in
// display case, "Lahore", never "lahore" or "LAHORE", by re-casing here
// at render time. Rows stored in mixed case (pre-change data) normalise
// the same way because we lowercase first.
//
// Rules:
//   - capitalise the first letter of every word, including a letter
//     that follows an opening bracket: "mingora (swat)" → "Mingora (Swat)".
//   - keep known acronym tokens fully uppercase: "mirpur (ajk)" →
//     "Mirpur (AJK)".
// ---------------------------------------------------------------------------
const CITY_UPPERCASE_TOKENS = new Set(["ajk"])

export function formatCity(city: string | null | undefined): string {
  if (!city) return ""
  return city
    .trim()
    .toLowerCase()
    .replace(/[a-z]+/g, (word) =>
      CITY_UPPERCASE_TOKENS.has(word)
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1)
    )
}

// ---------------------------------------------------------------------------
// Single source of truth for applicant-status presentation in the admin
// dashboard. Both `ApplicantsPage` (table rows) and
// `InterviewDetailDrawer` (focal verdict in the drawer header) read
// from this file, so the colour rule is enforced in one place:
//
//     PASS  → GREEN
//     REJECT → RED
//     PENDING (AI verdict not yet evaluated) → MUTED
//
// "Initial" vs "AI" is a stage marker, not a colour signal. The
// operator only ever needs two bits of information at a glance per
// stage: did this applicant pass the bar at this stage, or didn't
// they. The two stages are rendered side-by-side as a badge pair
// so the operator can see the full journey (Initial pass / AI
// rejection means "we accepted them, the interview didn't work out").
// ---------------------------------------------------------------------------

/** Human-readable label rendered inside the legacy combined status badge. */
export const APPLICANT_STATUS_LABEL: Record<ApplicantStatus, string> = {
  initial_pass: "Initial pass",
  initial_rejection: "Initial rejection",
  ai_pass: "AI pass",
  ai_rejection: "AI rejection"
}

/** Pre-screen stage labels (rendered as the FIRST badge in the pair). */
export const INITIAL_DECISION_LABEL: Record<InitialDecision, string> = {
  pass: "Initial pass",
  rejection: "Initial rejection"
}

/**
 * AI stage labels. `null` (the candidate hasn't been scored yet)
 * gets the dedicated "AI pending" label so a reviewer can tell the
 * "not done" rows apart from "done and failed" at a glance.
 */
export const AI_DECISION_LABEL: Record<AiDecision | "pending", string> = {
  pass: "AI pass",
  rejection: "AI rejection",
  pending: "AI pending"
}

/**
 * Returns true for any "pass" status. The classification is the
 * only place we hard-code which of the four enum values belong to
 * the green half of the chart — every other helper derives from
 * this set, so flipping a status from pass→reject in the future is
 * a single-line change.
 */
const PASS_STATUSES = new Set<ApplicantStatus>(["initial_pass", "ai_pass"])

export const isApplicantPassStatus = (status: ApplicantStatus): boolean =>
  PASS_STATUSES.has(status)

// ---------------------------------------------------------------------------
// Badge variants
// ---------------------------------------------------------------------------
// Two flavours, picked by context:
//
//   SOFT  (`success` / `destructive` / `muted`)
//     Pale tinted background. Used in dense table rows where many
//     badges share the viewport — saturation that high in every
//     cell turns the table into noise.
//
//   SOLID (`successSolid` / `destructiveSolid` / `muted`)
//     Filled bright background. Used in single-focal-point UI like
//     the interview drawer header — the verdict needs to pop the
//     moment the drawer opens. `muted` stays soft on the SOLID
//     surface so a still-pending AI verdict reads as "not yet" rather
//     than competing visually with a settled red/green decision.
//
// Both variants encode the SAME pass/reject decision: green for
// pass, red for reject, muted for "no verdict yet". The variant
// choice only changes how loud the badge is, not its meaning.

type SoftApplicantBadgeVariant = "success" | "destructive" | "muted"
type SolidApplicantBadgeVariant =
  | "successSolid"
  | "destructiveSolid"
  | "muted"

export function applicantStatusVariant(
  status: ApplicantStatus
): "success" | "destructive" {
  return isApplicantPassStatus(status) ? "success" : "destructive"
}

export function applicantStatusVariantSolid(
  status: ApplicantStatus
): "successSolid" | "destructiveSolid" {
  return isApplicantPassStatus(status) ? "successSolid" : "destructiveSolid"
}

/**
 * Variant for the FIRST (pre-screen) badge in the two-badge pair.
 * Same green/red mapping as the combined helpers above — pre-screen
 * always has a decided verdict, so we never return `muted` here.
 */
export function initialDecisionVariant(
  decision: InitialDecision
): SoftApplicantBadgeVariant {
  return decision === "pass" ? "success" : "destructive"
}

export function initialDecisionVariantSolid(
  decision: InitialDecision
): SolidApplicantBadgeVariant {
  return decision === "pass" ? "successSolid" : "destructiveSolid"
}

/**
 * Variant for the SECOND (AI-scoring) badge. Accepts `null` for the
 * pending case so the caller doesn't have to branch — `null` maps
 * to the same muted soft pill in both the table and drawer
 * contexts.
 */
export function aiDecisionVariant(
  decision: AiDecision | null
): SoftApplicantBadgeVariant {
  if (decision == null) return "muted"
  return decision === "pass" ? "success" : "destructive"
}

export function aiDecisionVariantSolid(
  decision: AiDecision | null
): SolidApplicantBadgeVariant {
  if (decision == null) return "muted"
  return decision === "pass" ? "successSolid" : "destructiveSolid"
}

/** Human-readable label for a (possibly null) AI verdict. */
export function aiDecisionLabel(decision: AiDecision | null): string {
  if (decision == null) return AI_DECISION_LABEL.pending
  return AI_DECISION_LABEL[decision]
}
