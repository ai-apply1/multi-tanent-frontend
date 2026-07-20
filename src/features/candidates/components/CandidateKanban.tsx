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
import { Loader2 } from "lucide-react"
import {
  getCandidateKanban,
  updateCandidateStatus,
} from "@/features/candidates/candidatesApi"
import { invalidateCandidateData } from "@/features/candidates/candidatesCache"
import type { KanbanBoard, KanbanCard } from "@/features/candidates/types"
import { errorMessage } from "@/lib/errors"
import { cn } from "@/lib/utils"

/** Board query key — scoped per job, since the board only ever is. */
export const kanbanQueryKey = (jobId: string) => ["candidateKanban", jobId] as const

const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()

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
      // The board, the table view, and Overview's awaiting/KPI panels all read
      // candidate-derived rows through different keys — fan out to every one.
      invalidateCandidateData(queryClient)
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
      <div className="overflow-x-auto scroll">
        <div className="flex min-w-max gap-3 pb-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex w-[280px] flex-shrink-0 flex-col rounded-2xl border border-line bg-surface"
            >
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <div className="h-3 w-24 animate-pulse rounded bg-surface-3" />
                <div className="h-4 w-6 animate-pulse rounded-md bg-surface-3" />
              </div>
              <div className="flex flex-1 flex-col gap-2 bg-surface-2 px-3 py-3">
                {[0, 1].map((j) => (
                  <div
                    key={j}
                    className="h-[76px] animate-pulse rounded-xl border border-line bg-surface"
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-center gap-2 text-[12.5px] text-ink-muted">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          Loading board…
        </div>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="py-16 text-center text-[13px] text-[var(--danger)]">
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
      <div className="overflow-x-auto scroll">
        <div className="flex min-w-max gap-3 pb-2">
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
        "flex w-[280px] flex-shrink-0 flex-col rounded-2xl border border-line bg-surface transition-colors",
        isOver && "border-primary"
      )}
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: color ?? "var(--ink-muted)" }}
          />
          <span
            className="truncate text-[13px] font-semibold text-ink"
            title={label}
          >
            {label}
          </span>
        </div>
        <span className="mono shrink-0 rounded-md bg-surface-3 px-2 py-0.5 text-[11.5px] font-semibold text-ink-muted">
          {count}
        </span>
      </div>

      <div className="scroll min-h-[200px] flex-1 space-y-2 overflow-y-auto bg-surface-2 px-3 py-3">
        {cards.length === 0 ? (
          <p className="py-6 text-center text-[12.5px] text-ink-subtle">
            No candidates here yet.
          </p>
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
        <p className="shrink-0 border-t border-line px-3 py-2 text-[11px] text-ink-muted">
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
  // Row 2 chips derived from what a KanbanCard actually carries. No interview
  // status/score is projected onto the card, so we surface the proxies we do
  // have: whether an interview exists, attempt count, city, and years.
  const chips: Array<{ key: string; label: string; className: string }> = []
  if (card.latestInterviewId) {
    chips.push({
      key: "interviewed",
      label: "Interviewed",
      className: "bg-accent text-primary",
    })
  }
  if (card.attemptCount > 0) {
    chips.push({
      key: "attempts",
      label: `${card.attemptCount} attempt${card.attemptCount === 1 ? "" : "s"}`,
      className: "mono bg-surface-3 text-ink-muted",
    })
  }
  if (card.city) {
    chips.push({
      key: "city",
      label: card.city,
      className: "bg-surface-3 text-ink-muted",
    })
  }
  if (card.yearsOfExperience !== null) {
    chips.push({
      key: "yoe",
      label: `${card.yearsOfExperience}y`,
      className: "mono bg-surface-3 text-ink-muted",
    })
  }

  return (
    <div
      role={onOpen ? "button" : undefined}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (!onOpen) return
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onOpen()
        }
      }}
      tabIndex={onOpen ? 0 : -1}
      title={onOpen ? "Open the interview result" : undefined}
      {...(handleProps ?? {})}
      className={cn(
        "cursor-grab touch-none select-none rounded-xl border border-line bg-surface p-3 transition-colors hover:border-line-2 hover:shadow-md active:cursor-grabbing",
        dragging && "cursor-grabbing shadow-lg"
      )}
    >
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-primary"
        >
          {initials(card.fullName)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-semibold text-ink leading-tight">
            {card.fullName}
          </p>
          <p
            className="truncate text-[11px] text-ink-muted"
            title={card.email}
          >
            {card.email}
          </p>
        </div>
      </div>

      {chips.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {chips.map((c) => (
            <span
              key={c.key}
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
                c.className
              )}
            >
              {c.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
