/**
 * Pipeline feature types.
 *
 * The pipeline IS the org's candidate-status catalog — one flat, ordered
 * list of kanban columns under `/admin/statuses`. There is no group layer,
 * no gating field and no auto-seed rule in the backend model, so there is
 * none here either: this file mirrors `CreateStatusDto` / `UpdateStatusDto`
 * exactly and nothing more.
 *
 * The row shape itself is `CandidateStatus` in `@/features/candidates/types`
 * — the same rows the Candidates page filters and the kanban board renders,
 * so it is not duplicated here.
 */

/** Preset colors offered in the status dialog. */
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

/**
 * The 8 builtin columns occupy `stageOrder` 10..80. A custom column is
 * slotted between them (e.g. 65 to sit after Shortlisted), so the dialog
 * defaults new rows past the last builtin rather than to 0.
 */
export const BUILTIN_STAGE_ORDER_MAX = 80

/**
 * `key` must match the backend's slug rule verbatim — lowercase alnum,
 * optionally separated by `-` or `_`, and it is IMMUTABLE once created
 * (activities and funnel automations address columns by key). Validating
 * client-side only saves a round trip; the server rule is the real one.
 */
export const STATUS_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]*$/

/** Body of `POST /admin/statuses` — mirrors `CreateStatusDto`. */
export interface CreateStatusPayload {
  key: string
  label: string
  color?: string
  stageOrder: number
  isTerminal?: boolean
}

/**
 * Body of `PATCH /admin/statuses/:id` — mirrors `UpdateStatusDto`. Display
 * fields only: `key` and the builtin/protected flags are not editable and
 * are stripped server-side by the global `whitelist: true` pipe.
 */
export interface UpdateStatusPayload {
  label?: string
  color?: string
  stageOrder?: number
}

/**
 * Derive a legal `key` from a label: "Reference check" → "reference-check".
 * The dialog seeds the key field with this while the user is still typing
 * the label, and stops the moment they edit the key by hand.
 */
export function slugifyStatusKey(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s_-]/g, "")
    .replace(/[\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+/, "")
    .slice(0, 50)
}
