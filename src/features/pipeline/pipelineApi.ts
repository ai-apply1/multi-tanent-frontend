/**
 * Pipeline data layer.
 *
 * The backend has NO dedicated pipeline endpoints — statuses live in a flat
 * catalog under `/admin/statuses` (managed by `candidatesApi`). The Pipeline
 * page's design expects a two-level model (groups → statuses) plus gating
 * and auto-seed rules that the backend simply doesn't model today. So:
 *
 *   1. `listPipelineGroups()` READS the real catalog and derives groups by
 *      bucketing `stageOrder`. If the shape doesn't fit any of the buckets
 *      (older org, custom-only catalog) we degrade to a single "Statuses"
 *      group so the page still renders something useful.
 *
 *   2. The four mutations are STUBS. They resolve immediately and log a
 *      warning — swap them out the moment a real endpoint lands. The page's
 *      onSuccess handlers should show a "(dummy)" toast so operators aren't
 *      surprised when their edits don't persist.
 */

import { listCandidateStatuses } from "@/features/candidates/candidatesApi"
import type { CandidateStatus } from "@/features/candidates/types"
import type {
  CreateGroupPayload,
  CreateStatusPayload,
  PipelineGroup,
  PipelineStatus,
} from "./types"

/**
 * Bucket definitions in `stageOrder` order. Kept as a small data table so
 * the group split stays reviewable — the shape is "0..1 → Candidate
 * Response", "2 → Screening", "3..4 → Interview", "5+ → Decision".
 *
 * `builtin: true` matches every bucket because the source catalog rows all
 * carry `builtin` today; if a custom column ever lands in one, we flip
 * `builtin` for the group off in the transform below.
 */
interface Bucket {
  id: string
  name: string
  description: string
  match: (stageOrder: number) => boolean
}

const BUCKETS: Bucket[] = [
  {
    id: "response",
    name: "Candidate Response",
    description:
      "Applications land here. Statuses in this group are set by the applicant or by initial screening.",
    match: (s) => s <= 1,
  },
  {
    id: "screening",
    name: "Screening",
    description:
      "AI-driven pre-screening. Candidates move on once they've passed or been rejected here.",
    match: (s) => s === 2,
  },
  {
    id: "interview",
    name: "Interview",
    description:
      "The interview loop — invited, in progress, and scored candidates live here.",
    match: (s) => s >= 3 && s <= 4,
  },
  {
    id: "decision",
    name: "Decision",
    description:
      "Terminal outcomes. Once a candidate reaches this group, they've exited the funnel one way or the other.",
    match: (s) => s >= 5,
  },
]

/**
 * Gating hints for the eight builtin statuses. Kept UI-only until the
 * backend grows a real `gate` field — swapping this map is how we'd retire
 * the stub.
 */
const GATE_BY_KEY: Record<string, string | null> = {
  applied: null,
  prescreened: "After Initial Pass",
  invited: "After Initial Pass",
  interviewing: "After Invite",
  scored: "After AI interview",
  shortlisted: "After Manual Pass",
  hired: "After Manual Pass",
  rejected: null,
}

/**
 * Statuses that fire automatically — the small "system" hint on the row is
 * driven off this set, not off `builtin`, so a builtin that a human still
 * clicks (e.g. `shortlisted`) doesn't read as automated.
 */
const SYSTEM_KEYS = new Set(["scored", "interviewing"])

const FALLBACK_COLOR = "#64748B"

function toPipelineStatus(row: CandidateStatus): PipelineStatus {
  return {
    id: row._id,
    key: row.key,
    label: row.label,
    color: row.color ?? FALLBACK_COLOR,
    system: SYSTEM_KEYS.has(row.key) || undefined,
    gate: GATE_BY_KEY[row.key] ?? null,
  }
}

export async function listPipelineGroups(): Promise<PipelineGroup[]> {
  const raw = await listCandidateStatuses()

  // Sort by the catalog's own order so grouping is stable — the backend
  // returns rows without a guaranteed order otherwise.
  const sorted = [...raw].sort((a, b) => a.stageOrder - b.stageOrder)

  // Distribute rows into buckets. Rows that don't match any bucket (a
  // theoretical stageOrder < 0) go into a spare "Other" group so nothing is
  // silently dropped.
  const bucketed = new Map<string, CandidateStatus[]>()
  const orphans: CandidateStatus[] = []
  for (const row of sorted) {
    const bucket = BUCKETS.find((b) => b.match(row.stageOrder))
    if (!bucket) {
      orphans.push(row)
      continue
    }
    const list = bucketed.get(bucket.id) ?? []
    list.push(row)
    bucketed.set(bucket.id, list)
  }

  // Degraded fallback: no bucket matched any row (e.g. empty catalog, or
  // heuristics are wrong for this org). Return one flat group so the page
  // still shows the raw catalog rather than a mystifying blank state.
  const anyBucketHit = bucketed.size > 0
  if (!anyBucketHit) {
    return [
      {
        id: "all",
        name: "Statuses",
        builtin: false,
        description:
          "Every status in your catalog. Grouping will appear once your pipeline shape is recognised.",
        statuses: sorted.map(toPipelineStatus),
      },
    ]
  }

  const groups: PipelineGroup[] = BUCKETS
    .map((b) => {
      const rows = bucketed.get(b.id) ?? []
      const builtin = rows.every((r) => r.builtin)
      return {
        id: b.id,
        name: b.name,
        builtin,
        description: b.description,
        statuses: rows.map(toPipelineStatus),
      }
    })
    .filter((g) => g.statuses.length > 0)

  if (orphans.length > 0) {
    groups.push({
      id: "other",
      name: "Other",
      builtin: false,
      description: "Custom statuses that don't fit the standard buckets.",
      statuses: orphans.map(toPipelineStatus),
    })
  }

  return groups
}

// ---------------------------------------------------------------------
// Mutations
//
// TODO: no backend — these are stubs. Every one just resolves; the caller
// still invalidates the react-query cache so the UI re-fetches (which will
// simply return the same data). Swap the bodies once the backend gains a
// real pipeline schema.
// ---------------------------------------------------------------------

export async function createPipelineGroup(payload: CreateGroupPayload): Promise<void> {
  // TODO: no backend
  console.warn("[pipelineApi] createPipelineGroup is a stub — backend not implemented.", payload)
  return Promise.resolve()
}

export async function createPipelineStatus(
  groupId: string,
  payload: CreateStatusPayload,
): Promise<void> {
  // TODO: no backend
  console.warn(
    "[pipelineApi] createPipelineStatus is a stub — backend not implemented.",
    { groupId, payload },
  )
  return Promise.resolve()
}

export async function updatePipelineGroup(
  id: string,
  payload: { name: string },
): Promise<void> {
  // TODO: no backend
  console.warn("[pipelineApi] updatePipelineGroup is a stub — backend not implemented.", {
    id,
    payload,
  })
  return Promise.resolve()
}

export async function deletePipelineGroup(id: string): Promise<void> {
  // TODO: no backend
  console.warn("[pipelineApi] deletePipelineGroup is a stub — backend not implemented.", id)
  return Promise.resolve()
}
