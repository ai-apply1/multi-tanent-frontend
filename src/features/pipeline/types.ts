/**
 * Types for the runtime hiring-pipeline catalog (built-in core + admin-defined
 * config). Mirrors the backend `/admin/pipeline` shapes (ResolvedGroup /
 * ResolvedStatus). The pipeline drives the applicant status chips, the
 * status-setting actions, and the status filters.
 */

export type PipelineStatusKind = "done" | "pending" | "system"

export type PipelineSideEffect =
  | "schedule_denorm"
  | "roster_mirror"
  | "followup_close"

export interface PipelineGroup {
  key: string
  label: string
  stageOrder: number
  /** Protected groups (scheduling, activation, email, response) are read-only. */
  protected: boolean
  /** Setting a status here requires a scored AI interview. */
  requiresAiScore: boolean
  builtin: boolean
}

export interface PipelineStatus {
  key: string
  label: string
  groupKey: string
  /** Badge variant. */
  color: string
  kind: PipelineStatusKind
  /** Directly admin-assignable (kind === 'done'). */
  assignable: boolean
  stageOrder: number
  unlockedByKey: string | null
  autoSeedKeys: string[]
  clearsKeys: string[]
  prerequisiteKeys: string[]
  /** A coded side effect (built-ins only); null otherwise. */
  sideEffect: PipelineSideEffect | null
  /** Typed fields captured on assign (built-ins only): scheduledAt / link. */
  fields: string[]
  terminal: boolean
  /** Protected statuses are display-edit-only and cannot be deleted. */
  protected: boolean
  builtin: boolean
}

export interface PipelineCatalog {
  groups: PipelineGroup[]
  statuses: PipelineStatus[]
}

export interface CreatePipelineGroupPayload {
  label: string
  stageOrder?: number
}

export interface UpdatePipelineGroupPayload {
  label?: string
  stageOrder?: number
}

export interface CreatePipelineStatusPayload {
  label: string
  groupKey: string
  color?: string
  kind?: "done" | "pending"
  stageOrder?: number
  unlockedByKey?: string | null
  autoSeedKeys?: string[]
  clearsKeys?: string[]
  prerequisiteKeys?: string[]
}

export interface UpdatePipelineStatusPayload {
  label?: string
  groupKey?: string
  color?: string
  stageOrder?: number
  unlockedByKey?: string | null
  autoSeedKeys?: string[]
  clearsKeys?: string[]
  prerequisiteKeys?: string[]
}
