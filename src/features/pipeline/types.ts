/**
 * Pipeline feature types.
 *
 * The backend today stores a FLAT catalog of statuses (`/admin/statuses`)
 * with `stageOrder`, `key`, `label`, `color`. The Pipeline page's design
 * wants a two-level model — groups (single-select stages) that OWN statuses
 * — plus gating and auto-seed rules.
 *
 * Rather than block the UI on backend changes, we synthesise groups from
 * the flat catalog by bucketing `stageOrder`, and keep the extra fields
 * (gate/system/auto-seed) as UI-only stubs. The two shapes below are the
 * page's props; the transform lives in `pipelineApi.ts`.
 */

export interface PipelineStatus {
  /** Stable id — the underlying `CandidateStatus._id` when synthesised. */
  id: string
  /** Immutable machine key from the backend catalog. */
  key: string
  /** Human-readable label. */
  label: string
  /** Hex color, always present (falls back to a slate default upstream). */
  color: string
  /**
   * True when the status is driven by automation (i.e. builtin +
   * non-manual). Rendered as a small muted "system" hint on the row.
   */
  system?: boolean
  /**
   * Gating label — what has to happen before an operator may set this
   * status. UI-only for now: derived from the builtin key.
   */
  gate?: string | null
}

export interface PipelineGroup {
  /** Synthetic id — deterministic per bucket so re-fetches don't remount. */
  id: string
  /** Group name shown as the card heading. */
  name: string
  /** True for the buckets that map to shipped, coded behaviour. */
  builtin: boolean
  /** Sub-line under the card heading. */
  description: string
  /** Statuses inside the group, in the backend's `stageOrder`. */
  statuses: PipelineStatus[]
}

/** Preset colors offered in the New Status dialog. */
export interface StatusColorPreset {
  name: string
  hex: string
}

export const STATUS_COLORS: StatusColorPreset[] = [
  { name: "Blue", hex: "#2563EB" },
  { name: "Slate", hex: "#64748B" },
  { name: "Gray", hex: "#9CA3AF" },
  { name: "Green", hex: "#15803D" },
  { name: "Green solid", hex: "#16A34A" },
  { name: "Amber", hex: "#B45309" },
  { name: "Red", hex: "#B42318" },
  { name: "Red solid", hex: "#DC2626" },
  { name: "Purple", hex: "#7C3AED" },
]

export const STATUS_KINDS = [
  { value: "assignable", label: "Assignable (operator sets it)" },
  { value: "system", label: "System (set by automation)" },
] as const

export const STATUS_GATES = [
  { value: "none", label: "No gating" },
  { value: "initial", label: "After Initial Pass" },
  { value: "ai", label: "After AI interview" },
  { value: "manual", label: "After Manual Pass" },
] as const

export const AUTO_SEED_OPTIONS = [
  "No Reply",
  "Not Interested",
  "Backlog",
  "Manual Decision Pending",
  "Manual Pass",
  "Manual Reject",
]

export interface CreateGroupPayload {
  name: string
}

export interface CreateStatusPayload {
  name: string
  color: string
  kind: (typeof STATUS_KINDS)[number]["value"]
  gate: (typeof STATUS_GATES)[number]["value"]
  autoSeed: string[]
  prerequisites: string[]
}
