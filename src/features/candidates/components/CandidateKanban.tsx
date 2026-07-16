import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import toast from "react-hot-toast"
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import { GripVertical, Loader2, MapPin, Repeat2 } from "lucide-react"
import {
  getCandidateKanban,
  updateCandidateStatus,
} from "@/features/candidates/candidatesApi"
import type { KanbanBoard, KanbanCard } from "@/features/candidates/types"
import { errorMessage } from "@/lib/errors"
import { cn } from "@/lib/utils"

/** Board query key — scoped per job, since the board only ever is. */
export const kanbanQueryKey = (jobId: string) => ["candidateKanban", jobId] as const

/**
 * Tint a column header / card accent from the catalog row's own hex. Driven by
 * data rather than a theme token on purpose: a custom column the org invented
 * gets its colour with no code change. `color-mix` keeps the fill a light wash
 * of that hue in both themes; the text stays the hue itself.
 */
function tint(color: string | null, pct: number): string | undefined {
  if (!color) return undefined
  return `color-mix(in oklch, ${color} ${pct}%, transparent)`
}

interface Props {
  jobId: string
  /** Opens the detail drawer for a card. */
  onOpenCandidate: (candidateId: string) => void
}

/**
 * Per-job kanban board. There is no cross-job board — the endpoint is
 * `/admin/jobs/:jobId/candidates/kanban` — which is why the page gates the
 * view toggle on a single job being selected.
 *
 * Drag between columns issues `PATCH /admin/candidates/:id/status { statusKey }`
 * with an optimistic move and a rollback on error.
 */
export function CandidateKanban({ jobId, onOpenCandidate }: Props) {
  const queryClient = useQueryClient()
  const [draggingCard, setDraggingCard] = useState<KanbanCard | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: kanbanQueryKey(jobId),
    queryFn: () => getCandidateKanban(jobId),
  })

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  )

  /**
   * Optimistic column move. We rewrite the cached board rather than refetch so
   * the card lands under the cursor instantly; `onSettled` re-syncs because
   * the server also stamps `statusUpdatedAt` and may reject the move.
   *
   * Counts move WITH the card: `count` is the column's true total (not
   * `candidates.length`), so decrementing/incrementing it is the only way the
   * "Showing 25 of N" footers stay truthful mid-drag.
   */
  const moveMutation = useMutation({
    mutationFn: (vars: { candidateId: string; statusKey: string; fromKey: string }) =>
      updateCandidateStatus(vars.candidateId, { statusKey: vars.statusKey }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: kanbanQueryKey(jobId) })
      const previous = queryClient.getQueryData<KanbanBoard>(kanbanQueryKey(jobId))
      if (!previous) return { previous }

      const card = previous.columns
        .find((c) => c.key === vars.fromKey)
        ?.candidates.find((x) => x._id === vars.candidateId)

      queryClient.setQueryData<KanbanBoard>(kanbanQueryKey(jobId), {
        ...previous,
        columns: previous.columns.map((column) => {
          if (column.key === vars.fromKey) {
            return {
              ...column,
              count: Math.max(0, column.count - 1),
              candidates: column.candidates.filter((x) => x._id !== vars.candidateId),
            }
          }
          if (column.key === vars.statusKey && card) {
            return {
              ...column,
              count: column.count + 1,
              candidates: [card, ...column.candidates],
            }
          }
          return column
        }),
      })
      return { previous }
    },
    onError: (err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(kanbanQueryKey(jobId), context.previous)
      }
      toast.error(errorMessage(err, "Could not move the candidate."))
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: kanbanQueryKey(jobId) })
      // The table view reads the same rows through a different key.
      queryClient.invalidateQueries({ queryKey: ["candidates"] })
    },
  })

  const handleDragStart = (event: DragStartEvent) => {
    setDraggingCard((event.active.data.current as { card?: KanbanCard } | undefined)?.card ?? null)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setDraggingCard(null)
    const { active, over } = event
    if (!over) return
    const meta = active.data.current as { card?: KanbanCard; fromKey?: string } | undefined
    const toKey = String(over.id)
    if (!meta?.card || !meta.fromKey || meta.fromKey === toKey) return
    moveMutation.mutate({
      candidateId: meta.card._id,
      statusKey: toKey,
      fromKey: meta.fromKey,
    })
  }

  if (isLoading) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">
        <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-primary" />
        Loading board…
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="py-16 text-center text-sm text-destructive">
        Could not load the board.{" "}
        <button onClick={() => refetch()} className="underline">
          Retry
        </button>
      </div>
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDraggingCard(null)}
    >
      <div className="flex gap-4 overflow-x-auto px-6 pb-4 pt-1">
        {data.columns.map((column) => (
          <KanbanColumnLane
            key={column.key}
            columnKey={column.key}
            label={column.label}
            color={column.color}
            count={column.count}
            cards={column.candidates}
            onOpenCandidate={onOpenCandidate}
          />
        ))}
      </div>
      {/* Rendered in a portal-ish overlay so the dragged card isn't clipped by
          the columns' own horizontal scroll container. */}
      <DragOverlay>
        {draggingCard ? <CardBody card={draggingCard} dragging /> : null}
      </DragOverlay>
    </DndContext>
  )
}

function KanbanColumnLane({
  columnKey,
  label,
  color,
  count,
  cards,
  onOpenCandidate,
}: {
  columnKey: string
  label: string
  color: string | null
  count: number
  cards: KanbanCard[]
  onOpenCandidate: (candidateId: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: columnKey })

  // The endpoint returns at most 25 cards per column while `count` is the
  // TRUE total. Letting the board read as complete would be a lie, so a
  // windowed column says so explicitly.
  const windowed = count > cards.length

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-72 shrink-0 flex-col rounded-xl border border-border bg-muted/30 transition-colors",
        isOver && "border-primary bg-primary/5"
      )}
    >
      <div
        className="flex shrink-0 items-center justify-between gap-2 rounded-t-xl border-b border-border px-3 py-2"
        style={{ backgroundColor: tint(color, 10) }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: color ?? "var(--muted-foreground)" }}
          />
          <span className="truncate text-sm font-semibold" title={label}>
            {label}
          </span>
        </div>
        <span className="shrink-0 rounded-full bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {count}
        </span>
      </div>

      <div className="flex min-h-24 flex-1 flex-col gap-2 p-2">
        {cards.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">Empty</p>
        ) : (
          cards.map((card) => (
            <DraggableCard
              key={card._id}
              card={card}
              fromKey={columnKey}
              // The drawer shows an INTERVIEW. A card with no attempt yet has
              // nothing to open, so it isn't offered as clickable rather than
              // opening an empty drawer.
              onOpen={
                card.latestInterviewId ? () => onOpenCandidate(card._id) : undefined
              }
            />
          ))
        )}
      </div>

      {windowed ? (
        <p className="shrink-0 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
          Showing {cards.length} of {count} — use the table view to see the rest.
        </p>
      ) : null}
    </div>
  )
}

function DraggableCard({
  card,
  fromKey,
  onOpen,
}: {
  card: KanbanCard
  fromKey: string
  onOpen?: () => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: card._id,
    data: { card, fromKey },
  })

  return (
    <div ref={setNodeRef} className={cn(isDragging && "opacity-40")}>
      <CardBody
        card={card}
        onOpen={onOpen}
        handleProps={{ ...attributes, ...listeners }}
      />
    </div>
  )
}

/**
 * The card's visuals, shared by the in-column node and the DragOverlay clone
 * (the overlay must look identical or the card appears to change on pickup).
 */
function CardBody({
  card,
  onOpen,
  handleProps,
  dragging,
}: {
  card: KanbanCard
  onOpen?: () => void
  handleProps?: Record<string, unknown>
  dragging?: boolean
}) {
  return (
    <div
      className={cn(
        "group rounded-lg border border-border bg-card p-2.5 shadow-sm",
        dragging && "cursor-grabbing shadow-lg"
      )}
    >
      <div className="flex items-start gap-1.5">
        {/* Handle-only drag so the card body stays clickable — a whole-card
            drag would swallow the click that opens the drawer. */}
        <button
          type="button"
          aria-label={`Drag ${card.fullName}`}
          title="Drag to another column"
          className="mt-0.5 shrink-0 cursor-grab touch-none text-muted-foreground/50 transition-colors hover:text-muted-foreground active:cursor-grabbing"
          {...handleProps}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onOpen}
          disabled={!onOpen}
          title={onOpen ? "Open the interview result" : undefined}
          className="min-w-0 flex-1 text-left"
        >
          <p
            className={cn(
              "truncate text-sm font-medium leading-tight",
              onOpen && "group-hover:underline"
            )}
          >
            {card.fullName}
          </p>
          <p className="truncate text-xs text-muted-foreground" title={card.email}>
            {card.email}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            {card.city ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {card.city}
              </span>
            ) : null}
            {card.yearsOfExperience !== null ? <span>{card.yearsOfExperience}y</span> : null}
            {card.attemptCount > 0 ? (
              <span className="inline-flex items-center gap-1">
                <Repeat2 className="h-3 w-3" />
                {card.attemptCount} attempt{card.attemptCount === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>
        </button>
      </div>
    </div>
  )
}
