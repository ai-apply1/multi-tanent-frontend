import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import toast from "react-hot-toast"
import { GitBranch, Lock, Pencil, Plus, RotateCw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  deleteStatusColumn,
  listCandidateStatuses,
} from "@/features/pipeline/pipelineApi"
import type { CandidateStatus } from "@/features/candidates/types"
import { StatusDialog } from "@/features/pipeline/components/StatusDialog"
import { errorMessage } from "@/lib/errors"

const FALLBACK_COLOR = "#64748B"

/**
 * Pipeline configuration — the org's candidate-status catalog.
 *
 * The catalog is FLAT and ordered by `stageOrder`; that is the whole model,
 * both here and in the backend. Every org is seeded with the 8 built-in
 * columns at provisioning and may add custom ones on top.
 *
 * What is editable is bounded by what the funnel depends on:
 *   - `label` / `color` / `stageOrder` — editable on every row, built-ins
 *     included. Automations never read them.
 *   - `key` — immutable. The vetting engine, the interview lifecycle, the
 *     scoring finalizer and every activity row address a column by key.
 *   - built-in rows cannot be deleted (403), and no row can be deleted
 *     while a candidate still sits in it (409). Both messages are shown
 *     verbatim rather than flattened into a generic failure.
 */
export function PipelinePage() {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<CandidateStatus | null>(null)

  const {
    data: statuses = [],
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["candidateStatuses"],
    queryFn: listCandidateStatuses,
  })

  // The backend already returns board order, but sorting here keeps the page
  // correct if that ever changes and makes a just-edited stageOrder land in
  // the right place on the optimistic refetch.
  const ordered = useMemo(
    () => [...statuses].sort((a, b) => a.stageOrder - b.stageOrder),
    [statuses],
  )

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteStatusColumn(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["candidateStatuses"] })
      toast.success("Status deleted.")
    },
    onError: (err) => {
      // 403 (protected built-in) and 409 (column still occupied) both carry
      // a message naming the actual reason — surface it as-is.
      toast.error(errorMessage(err, "Could not delete status."))
    },
  })

  const openCreate = () => {
    setEditTarget(null)
    setDialogOpen(true)
  }

  const openEdit = (status: CandidateStatus) => {
    setEditTarget(status)
    setDialogOpen(true)
  }

  const handleDelete = (status: CandidateStatus) => {
    if (status.isProtected) return
    if (
      window.confirm(
        `Delete the “${status.label}” column? This cannot be undone.`,
      )
    ) {
      deleteMutation.mutate(status._id)
    }
  }

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-6 lg:px-8 lg:py-8">
      {/* Page header */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="inline-flex text-primary">
              <GitBranch className="h-[18px] w-[18px]" strokeWidth={1.7} />
            </span>
            <h1 className="text-[23px] font-semibold tracking-tight text-ink">
              Pipeline
            </h1>
          </div>
          <p className="mt-1.5 max-w-[620px] text-[13.5px] text-ink-muted">
            The candidate board's columns, in order. Rename, recolour and
            reorder any column — including the built-ins — or add your own.
            A column's key is permanent, because the hiring automations
            reference it.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" strokeWidth={2.2} />
            New status
          </Button>
        </div>
      </div>

      {/* Body */}
      {isLoading ? (
        <LoadingSkeleton />
      ) : error ? (
        <ErrorState onRetry={() => refetch()} loading={isFetching} />
      ) : ordered.length === 0 ? (
        <EmptyState onCreate={openCreate} />
      ) : (
        <div className="rounded-2xl border border-line bg-surface">
          <div className="flex items-center gap-3 border-b border-line px-5 py-3">
            <span className="text-[12.5px] font-semibold uppercase tracking-wide text-ink-subtle">
              {ordered.length} columns
            </span>
          </div>
          {ordered.map((status) => (
            <StatusRow
              key={status._id}
              status={status}
              onEdit={() => openEdit(status)}
              onDelete={() => handleDelete(status)}
              deleting={
                deleteMutation.isPending &&
                deleteMutation.variables === status._id
              }
            />
          ))}
        </div>
      )}

      <StatusDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        status={editTarget}
        existing={ordered}
      />
    </div>
  )
}

// ---------------------------------------------------------------------
// Status row
// ---------------------------------------------------------------------

interface StatusRowProps {
  status: CandidateStatus
  onEdit: () => void
  onDelete: () => void
  deleting: boolean
}

function StatusRow({ status, onEdit, onDelete, deleting }: StatusRowProps) {
  const color = status.color ?? FALLBACK_COLOR
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5 last:border-b-0">
      <span className="w-9 shrink-0 text-[12.5px] tabular-nums text-ink-subtle">
        {status.stageOrder}
      </span>
      <span
        className="inline-flex items-center rounded-full px-2.5 py-1 text-[12.5px] font-semibold"
        style={{
          background: `color-mix(in oklab, ${color}, white 88%)`,
          color,
        }}
      >
        {status.label}
      </span>
      <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11.5px] text-ink-muted">
        {status.key}
      </code>
      {status.builtin ? (
        <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-ink-muted">
          Built-in
        </span>
      ) : null}
      {status.isTerminal ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-ink-faint px-2 py-0.5 text-[11px] font-semibold text-ink-2">
          <Lock className="h-[10px] w-[10px]" strokeWidth={1.9} />
          Terminal
        </span>
      ) : null}
      <div className="flex-1" />
      <button
        type="button"
        onClick={onEdit}
        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-semibold text-ink-muted hover:bg-surface-3"
      >
        <Pencil className="h-[13px] w-[13px]" strokeWidth={1.9} />
        Edit
      </button>
      {/* Protected rows have no delete affordance at all — the server would
          403 it, and offering a button that always fails is worse than
          not offering one. */}
      {status.isProtected ? null : (
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          aria-label={`Delete ${status.label}`}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--line-2)] bg-surface text-[var(--danger)] hover:bg-[var(--danger-soft)] disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" strokeWidth={1.8} />
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------
// Loading / empty / error states
// ---------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-line bg-surface">
      <div className="border-b border-line px-5 py-3">
        <div className="h-3 w-24 rounded bg-surface-3" />
      </div>
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="flex items-center gap-3 border-b border-line px-5 py-3.5 last:border-b-0"
        >
          <div className="h-3 w-6 rounded bg-surface-3" />
          <div className="h-6 w-28 rounded-full bg-surface-3" />
          <div className="h-4 w-20 rounded bg-surface-3" />
          <div className="flex-1" />
          <div className="h-7 w-16 rounded-full bg-surface-3" />
        </div>
      ))}
    </div>
  )
}

interface EmptyStateProps {
  onCreate: () => void
}

function EmptyState({ onCreate }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-line bg-surface px-6 py-14 text-center">
      <p className="text-[13.5px] text-ink-muted">
        No statuses in this organisation's catalog yet.
      </p>
      <Button size="sm" onClick={onCreate}>
        <Plus className="h-4 w-4" strokeWidth={2.2} />
        New status
      </Button>
    </div>
  )
}

interface ErrorStateProps {
  onRetry: () => void
  loading: boolean
}

function ErrorState({ onRetry, loading }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-line bg-surface px-6 py-14 text-center">
      <p className="text-[13.5px] text-[var(--danger)]">
        Failed to load the status catalog. Try refreshing.
      </p>
      <Button variant="secondary" size="sm" onClick={onRetry} disabled={loading}>
        <RotateCw className="h-4 w-4" strokeWidth={1.9} />
        Refresh
      </Button>
    </div>
  )
}
