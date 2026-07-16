import type { ListApplicantsParams } from "@/features/applicants/types"

/**
 * Types for admin-defined saved filter views: named snapshots of the
 * Applicants filter state, shared across all admins and re-applied on click.
 * Mirrors the shapes returned by `/admin/saved-filters/*`.
 */

/**
 * A stored filter snapshot = the Applicants list params minus pagination (a
 * saved view pins WHAT to show, not WHICH page). Round-trips 1:1 back into the
 * Applicants filter state.
 */
export type SavedFilterCriteria = Omit<ListApplicantsParams, "page" | "limit">

export interface SavedFilter {
  id: string
  name: string
  criteria: SavedFilterCriteria
  createdAt: string
}

export interface CreateSavedFilterPayload {
  name: string
  criteria: SavedFilterCriteria
}

export interface UpdateSavedFilterPayload {
  name?: string
  criteria?: SavedFilterCriteria
}
