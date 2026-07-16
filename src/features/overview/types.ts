/**
 * Types for the admin Overview tab: admin-defined candidate stat cards whose
 * counts are recomputed by the backend on every fetch. Mirrors the shapes
 * returned by `/admin/overview/*` (see the backend `overview` module).
 */

/** One pickable filter dimension (from `GET /admin/overview/filter-options`). */
export interface OverviewFilterOption {
  /** Stable key persisted on a card, e.g. "status:prescreened". */
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
 *    card carries no filters and ignores the page Job overlay.
 */
export interface OverviewStat {
  id: string
  kind: "filter" | "manual"
  title: string
  /**
   * The filters producing `count` (empty for manual cards, and empty on a
   * filter card means "count every candidate"). Criteria in the SAME group are
   * ORed; different groups are ANDed. The page-level `jobId` overlay ANDs on
   * top of all of it.
   */
  criteria: OverviewStatCriterion[]
  /** The fixed number for a manual card (0 for filter cards). */
  value: number
  count: number
  /** The card's index in the board's drag order (server-owned). */
  position: number
  createdAt: string
}

/** Payload for a live filter-based metric card. */
export interface CreateOverviewStatPayload {
  title: string
  /**
   * The full criterion objects, not just their keys: the backend snapshots the
   * label/group so a chip still renders after the job or status it points at is
   * renamed or deleted.
   */
  criteria: OverviewStatCriterion[]
}

/** Payload for a manual card: a title plus the fixed number to display. */
export interface CreateManualOverviewStatPayload {
  title: string
  value: number
}
