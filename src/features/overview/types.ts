/**
 * Types for the admin Overview tab: admin-defined applicant stat cards whose
 * counts are recomputed by the backend on every fetch. Mirrors the shapes
 * returned by `/admin/overview/*` (see the backend `admin/overview` module).
 */

/** One pickable filter dimension (from `GET /admin/overview/filter-options`). */
export interface OverviewFilterOption {
  /** Stable key persisted on a card, e.g. "status:ai_pass". */
  key: string
  /** Human label shown in the dropdown and on the card. */
  label: string
  /** Group header used to section the dropdown. */
  group: string
}

/** A resolved criterion as echoed back on a saved card. */
export interface OverviewStatCriterion {
  key: string
  label: string
  group: string
}

/**
 * A saved stat card. Two kinds share the dashboard:
 *  - `filter`: `count` is recomputed live from `criteria` on every fetch.
 *  - `manual`: the admin typed a fixed number; `count` equals `value`, and the
 *    card carries no filters and ignores the page Source overlay.
 */
export interface OverviewStat {
  id: string
  kind: "filter" | "manual"
  title: string
  /** Filters ANDed together to produce `count` (empty for manual cards). */
  criteria: OverviewStatCriterion[]
  /** The fixed number for a manual card (0 for filter cards). */
  value: number
  count: number
  createdAt: string
}

/** Payload for a live filter-based metric card. */
export interface CreateOverviewStatPayload {
  title: string
  criteria: string[]
}

/** Payload for a manual card: a title plus the fixed number to display. */
export interface CreateManualOverviewStatPayload {
  title: string
  value: number
}
