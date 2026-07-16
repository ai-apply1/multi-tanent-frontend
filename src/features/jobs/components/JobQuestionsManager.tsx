import { useEffect, useState, type CSSProperties } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
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
  AlertTriangle,
  GripVertical,
  ListChecks,
  Loader2,
  Pencil,
  Plus,
  X,
} from "lucide-react"
import toast from "react-hot-toast"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { AddJobQuestionsDialog } from "@/features/jobs/components/AddJobQuestionsDialog"
import { setJobQuestions } from "@/features/jobs/jobsApi"
import type {
  BankQuestion,
  DifficultyLevel,
  Job,
  JobQuestionItemPayload,
  JobQuestionView,
} from "@/features/jobs/types"
import { errorMessage } from "@/lib/errors"
import { cn } from "@/lib/utils"

const difficultyVariant: Record<
  DifficultyLevel,
  "success" | "warning" | "destructive"
> = {
  easy: "success",
  medium: "warning",
  hard: "destructive",
}

/**
 * The presented questions as a PUT payload. `orderIndex` is re-derived from
 * array position, which is what makes it unique (a duplicate is a 422) and
 * makes "reorder" just "re-send in the new order".
 */
const toItems = (questions: JobQuestionView[]): JobQuestionItemPayload[] =>
  questions.map((q, index) => ({
    questionId: q.questionId,
    orderIndex: index,
    weight: q.weight,
    ...(q.textOverride ? { textOverride: q.textOverride } : {}),
  }))

interface JobQuestionsManagerProps {
  job: Job
}

/**
 * The job's interview script. Every edit here — reorder, reweight, reword,
 * add, remove — is the same REPLACE call carrying the complete desired end
 * state, so there is one mutation and one failure mode.
 */
export function JobQuestionsManager({ job }: JobQuestionsManagerProps) {
  const queryClient = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const questions = job.questions

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const mutation = useMutation({
    mutationFn: (items: JobQuestionItemPayload[]) =>
      setJobQuestions(job._id, items),
    onMutate: async (items) => {
      await queryClient.cancelQueries({ queryKey: ["job", job._id] })
      const previous = queryClient.getQueryData<Job>(["job", job._id])
      if (previous) {
        // Optimistically apply order/weight/override so a drag doesn't snap
        // back under the cursor. Freshly added ids have nothing to project
        // from, so they're left to the server response a moment later.
        const byId = new Map(previous.questions.map((q) => [q.questionId, q]))
        const next = items.flatMap((item) => {
          const existing = byId.get(item.questionId)
          if (!existing) return []
          const override = item.textOverride ?? null
          return [
            {
              ...existing,
              orderIndex: item.orderIndex,
              weight: item.weight,
              textOverride: override,
              effectiveText: override ?? existing.textSnapshot,
            },
          ]
        })
        queryClient.setQueryData<Job>(["job", job._id], {
          ...previous,
          questions: next,
        })
      }
      return { previous }
    },
    onError: (err, _items, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(["job", job._id], ctx.previous)
      }
      toast.error(errorMessage(err, "Could not save the questions."))
    },
    onSuccess: (saved) => {
      // The server re-freezes every snapshot and recomputes the drift flags,
      // so its response is the only correct picture — don't just keep ours.
      queryClient.setQueryData(["job", saved._id], saved)
      // The list page shows questionCount.
      queryClient.invalidateQueries({ queryKey: ["jobs"] })
      setAddOpen(false)
    },
  })

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = questions.findIndex((q) => q.questionId === active.id)
    const newIndex = questions.findIndex((q) => q.questionId === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    mutation.mutate(toItems(arrayMove(questions, oldIndex, newIndex)))
  }

  const handleAdd = (picks: BankQuestion[]) => {
    const appended: JobQuestionItemPayload[] = [
      ...toItems(questions),
      ...picks.map((pick, i) => ({
        questionId: pick._id,
        orderIndex: questions.length + i,
        // Required on every item — the backend has no default here.
        weight: 1,
      })),
    ]
    mutation.mutate(appended)
  }

  const handleRemove = (questionId: string) =>
    mutation.mutate(toItems(questions.filter((q) => q.questionId !== questionId)))

  const handleWeight = (questionId: string, weight: number) =>
    mutation.mutate(
      toItems(
        questions.map((q) => (q.questionId === questionId ? { ...q, weight } : q)),
      ),
    )

  const handleOverride = (questionId: string, textOverride: string | null) =>
    mutation.mutate(
      toItems(
        questions.map((q) =>
          q.questionId === questionId ? { ...q, textOverride } : q,
        ),
      ),
    )

  // A slot whose bank row is gone can't be re-sent: the PUT resolves every
  // questionId org-scoped and 404s the WHOLE payload on any unknown id. So
  // the list is frozen until it's removed — say so instead of letting every
  // later edit fail with a raw id list.
  const orphaned = questions.filter((q) => q.currentBankText === null)

  return (
    <Card>
      <CardHeader className="border-b border-border">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-primary" />
              Interview questions
            </CardTitle>
            <CardDescription>
              {questions.length > 0
                ? `${questions.length} question${questions.length === 1 ? "" : "s"}, asked in this order.`
                : "No questions attached — this job can't interview anyone yet."}
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {mutation.isPending ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Saving…
              </span>
            ) : null}
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" />
              Add questions
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4">
        {orphaned.length > 0 ? (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs leading-relaxed text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {orphaned.length === 1
                ? "A question below no longer exists in the bank."
                : `${orphaned.length} questions below no longer exist in the bank.`}{" "}
              The saved wording still works for anyone interviewing now, but no
              further change to this list can be saved until{" "}
              {orphaned.length === 1 ? "it is" : "they are"} removed.
            </span>
          </div>
        ) : null}

        {questions.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-10 text-center text-sm text-muted-foreground">
            No questions yet. Click "Add questions" to pick some from your bank.
          </p>
        ) : (
          <TooltipProvider delayDuration={300}>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={questions.map((q) => q.questionId)}
                strategy={verticalListSortingStrategy}
              >
                <div className="flex flex-col gap-2">
                  {questions.map((question, index) => (
                    <SortableQuestionRow
                      key={question.questionId}
                      question={question}
                      index={index}
                      disabled={mutation.isPending}
                      onRemove={() => handleRemove(question.questionId)}
                      onWeight={(weight) =>
                        handleWeight(question.questionId, weight)
                      }
                      onOverride={(text) =>
                        handleOverride(question.questionId, text)
                      }
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </TooltipProvider>
        )}
      </CardContent>

      <AddJobQuestionsDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        attachedIds={questions.map((q) => q.questionId)}
        onAdd={handleAdd}
        saving={mutation.isPending}
      />
    </Card>
  )
}

interface SortableQuestionRowProps {
  question: JobQuestionView
  index: number
  disabled: boolean
  onRemove: () => void
  onWeight: (weight: number) => void
  onOverride: (text: string | null) => void
}

/** Sortable wrapper: feeds dnd-kit's refs/listeners into the visual row. */
function SortableQuestionRow(props: SortableQuestionRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.question.questionId })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }
  return (
    <QuestionRow
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

interface QuestionRowProps extends SortableQuestionRowProps {
  sortableRef?: (node: HTMLElement | null) => void
  style?: CSSProperties
  isDragging?: boolean
  dragHandleRef?: (node: HTMLElement | null) => void
  dragHandleListeners?: ReturnType<typeof useSortable>["listeners"]
  dragHandleAttributes?: ReturnType<typeof useSortable>["attributes"]
}

function QuestionRow({
  question,
  index,
  disabled,
  onRemove,
  onWeight,
  onOverride,
  sortableRef,
  style,
  isDragging,
  dragHandleRef,
  dragHandleListeners,
  dragHandleAttributes,
}: QuestionRowProps) {
  // Weight is a free-text draft so the box can be empty mid-typing; it only
  // persists on blur, and only when it actually parsed to something new.
  const [weightDraft, setWeightDraft] = useState(String(question.weight))
  const [editing, setEditing] = useState(false)
  const [overrideDraft, setOverrideDraft] = useState(question.textOverride ?? "")

  useEffect(() => {
    setWeightDraft(String(question.weight))
  }, [question.weight])

  const commitWeight = () => {
    const parsed = Number(weightDraft.trim())
    if (!weightDraft.trim() || !Number.isFinite(parsed) || parsed < 0) {
      setWeightDraft(String(question.weight))
      return
    }
    if (parsed !== question.weight) onWeight(parsed)
  }

  const startEditing = () => {
    setOverrideDraft(question.textOverride ?? "")
    setEditing(true)
  }

  const commitOverride = () => {
    const value = overrideDraft.trim()
    onOverride(value || null)
    setEditing(false)
  }

  return (
    <div
      ref={sortableRef}
      style={style}
      className={cn(
        "rounded-lg border border-border bg-card p-3",
        isDragging && "z-10 opacity-60 shadow-lg",
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          ref={dragHandleRef}
          {...dragHandleAttributes}
          {...dragHandleListeners}
          className="mt-0.5 cursor-grab touch-none rounded p-1 text-muted-foreground/70 transition-colors hover:text-foreground active:cursor-grabbing"
          aria-label={`Drag to reorder question ${index + 1}`}
          title="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted text-[11px] font-semibold tabular-nums text-muted-foreground">
          {index + 1}
        </span>

        <div className="min-w-0 flex-1">
          <p className="whitespace-pre-wrap text-sm leading-snug">
            {question.effectiveText}
          </p>

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {question.difficultyLevel ? (
              <Badge
                variant={difficultyVariant[question.difficultyLevel]}
                className="capitalize"
              >
                {question.difficultyLevel}
              </Badge>
            ) : null}
            {question.tags.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
            {question.textOverride ? (
              <Badge variant="outline">Reworded for this job</Badge>
            ) : null}

            {/* Drift hints. Both are INFORMATIONAL — the frozen snapshot is
                what the interview actually uses, so neither is an error. */}
            {question.currentBankText === null ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex cursor-help items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-300">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    Removed from the bank
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>
                    This question no longer exists in the question bank. The
                    wording saved on this job still works, but the list can't be
                    saved again until you remove this row.
                  </p>
                </TooltipContent>
              </Tooltip>
            ) : question.bankTextChanged === true ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex cursor-help items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-300">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    Bank wording changed since attach
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p className="mb-1.5 font-medium">The bank now reads:</p>
                  <p className="whitespace-pre-wrap">
                    {question.currentBankText}
                  </p>
                  <p className="mt-2 text-muted-foreground">
                    This job keeps the wording above until the next change to
                    this list — any save re-freezes it from the bank.
                  </p>
                </TooltipContent>
              </Tooltip>
            ) : null}
          </div>

          {editing ? (
            <div className="mt-2.5 flex flex-col gap-2">
              <Textarea
                value={overrideDraft}
                maxLength={2000}
                rows={3}
                autoFocus
                onChange={(e) => setOverrideDraft(e.target.value)}
                placeholder="Reword this question for this job…"
                className="text-xs"
              />
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-muted-foreground">
                  Empty clears the rewording and falls back to the bank.
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setEditing(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={disabled}
                    onClick={commitOverride}
                  >
                    Save wording
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <label className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">Weight</span>
            <Input
              type="number"
              min={0}
              step="any"
              value={weightDraft}
              disabled={disabled}
              aria-label={`Weight for question ${index + 1}`}
              title="1 = neutral"
              onChange={(e) => setWeightDraft(e.target.value)}
              onBlur={commitWeight}
              className="h-8 w-16 text-xs"
            />
          </label>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            aria-label={`Reword question ${index + 1}`}
            title="Reword for this job"
            onClick={startEditing}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            aria-label={`Remove question ${index + 1}`}
            title="Remove from this job"
            onClick={onRemove}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
