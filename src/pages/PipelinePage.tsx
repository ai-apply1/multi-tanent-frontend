import { useMemo, useState, type CSSProperties } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import toast from "react-hot-toast"
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  GitBranch,
  GripVertical,
  Loader2,
  Lock,
  Pencil,
  Plus,
  RotateCw,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  deleteStatusColumn,
  listCandidateStatuses,
  reorderStatusColumns,
} from "@/features/pipeline/pipelineApi"
import type { CandidateStatus } from "@/features/candidates/types"
import { StatusDialog } from "@/features/pipeline/components/StatusDialog"
import { STAGE_ORDER_STEP } from "@/features/pipeline/types"
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
 *
 * Reordering is drag-and-drop over `stageOrder`. The drop writes the new
 * order straight into the query cache so the row settles where it was
 * dropped, then sends the whole ordered catalog to
 * `PATCH /admin/statuses/reorder` — one atomic request whose response is
 * the confirmed board.
 */
export function PipelinePage() {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<CandidateStatus | null>(null)

  const {
    data: statuses,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["candidateStatuses"],
    queryFn: listCandidateStatuses,
  })

  // The backend already returns board order, but sorting here keeps the page
  // correct if that ever changes and re-sorts the optimistic reorder below.
  const ordered = useMemo(
    () => [...(statuses ?? [])].sort((a, b) => a.stageOrder - b.stageOrder),
    [statuses],
  )

  const sensors = useSensors(
    // 6px before a drag starts, so a click on Edit/Delete inside the row is
    // never swallowed as a micro-drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const reorderMutation = useMutation({
    mutationFn: reorderStatusColumns,
    onSuccess: (saved) => {
      // The endpoint returns the reordered catalog, so this is the final
      // truth — no invalidate, no refetch round trip.
      queryClient.setQueryData(["candidateStatuses"], saved)
      toast.success("Order saved.")
    },
    onError: (err) => {
      // The write is atomic, so nothing landed — but the 409 case means the
      // catalog itself moved under us (a column added or deleted mid-drag),
      // and only a refetch resolves that. Refetching also restores the
      // pre-drag order after any other failure.
      toast.error(errorMessage(err, "Could not save the new order."))
      queryClient.invalidateQueries({ queryKey: ["candidateStatuses"] })
    },
  })

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

  const busy = reorderMutation.isPending || deleteMutation.isPending

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = ordered.findIndex((s) => s._id === active.id)
    const newIndex = ordered.findIndex((s) => s._id === over.id)
    if (oldIndex < 0 || newIndex < 0) return

    // Mirror the server's numbering (10/20/30…) locally so the optimistic
    // list below sorts into the shape the response will confirm.
    const moved = arrayMove(ordered, oldIndex, newIndex).map(
      (status, index) => ({
        ...status,
        stageOrder: (index + 1) * STAGE_ORDER_STEP,
      }),
    )

    // Optimistic write into the query cache itself — no local draft mirror
    // to keep in sync, and the Candidates page's filter (same query key)
    // reorders with it. `cancelQueries` first so an in-flight background
    // refetch can't land on top of this and snap the row back.
    void queryClient.cancelQueries({ queryKey: ["candidateStatuses"] })
    queryClient.setQueryData(["candidateStatuses"], moved)

    // The WHOLE catalog, in order — the server derives every stageOrder and
    // rejects a set that no longer matches its own (a column added or
    // deleted mid-drag).
    reorderMutation.mutate(moved.map((s) => s._id))
  }

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
            The candidate board's columns, in order. Drag to reorder, rename
            and recolour any column — including the built-ins — or add your
            own. A column's key is permanent, because the hiring automations
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
            {reorderMutation.isPending ? (
              <span className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                Saving order…
              </span>
            ) : null}
          </div>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={ordered.map((s) => s._id)}
              strategy={verticalListSortingStrategy}
            >
              {ordered.map((status) => (
                <SortableStatusRow
                  key={status._id}
                  status={status}
                  disabled={busy}
                  onEdit={() => openEdit(status)}
                  onDelete={() => handleDelete(status)}
                  deleting={
                    deleteMutation.isPending &&
                    deleteMutation.variables === status._id
                  }
                />
              ))}
            </SortableContext>
          </DndContext>
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
  disabled: boolean
  onEdit: () => void
  onDelete: () => void
  deleting: boolean
}

/** Sortable wrapper: feeds dnd-kit's refs/listeners into the visual row. */
function SortableStatusRow(props: StatusRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.status._id, disabled: props.disabled })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    // Lift the dragged row above its neighbours; without it the rows below
    // paint over it as they shift.
    zIndex: isDragging ? 1 : undefined,
    position: isDragging ? "relative" : undefined,
  }
  return (
    <StatusRow
      {...props}
      sortableRef={setNodeRef}
      style={style}
      isDragging={isDragging}
      dragHandleRef={setActivatorNodeRef}
      dragHandleListeners={listeners}
      dragHandleAttributes={attributes}
    />
  )
}

interface StatusRowViewProps extends StatusRowProps {
  sortableRef?: (node: HTMLElement | null) => void
  style?: CSSProperties
  isDragging?: boolean
  dragHandleRef?: (node: HTMLElement | null) => void
  dragHandleListeners?: ReturnType<typeof useSortable>["listeners"]
  dragHandleAttributes?: ReturnType<typeof useSortable>["attributes"]
}

function StatusRow({
  status,
  disabled,
  onEdit,
  onDelete,
  deleting,
  sortableRef,
  style,
  isDragging,
  dragHandleRef,
  dragHandleListeners,
  dragHandleAttributes,
}: StatusRowViewProps) {
  const color = status.color ?? FALLBACK_COLOR
  return (
    <div
      ref={sortableRef}
      style={style}
      className={`flex flex-wrap items-center gap-3 border-b border-line bg-surface px-5 py-3.5 last:border-b-0 ${
        isDragging ? "rounded-lg shadow-lg" : ""
      }`}
    >
      <button
        type="button"
        ref={dragHandleRef}
        {...dragHandleAttributes}
        {...dragHandleListeners}
        disabled={disabled}
        aria-label={`Reorder ${status.label}`}
        className="inline-flex h-7 w-5 shrink-0 cursor-grab items-center justify-center text-ink-subtle hover:text-ink-muted disabled:cursor-not-allowed disabled:opacity-40"
      >
        <GripVertical className="h-4 w-4" strokeWidth={1.8} />
      </button>
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
          disabled={deleting || disabled}
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
          <div className="h-4 w-4 rounded bg-surface-3" />
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
