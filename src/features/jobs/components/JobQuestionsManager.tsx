import { useEffect, useMemo, useState, type CSSProperties } from "react"
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
  Plus,
  Scale,
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { AddJobQuestionsDialog } from "@/features/jobs/components/AddJobQuestionsDialog"
import { setJobQuestions } from "@/features/jobs/jobsApi"
import type {
  Job,
  JobQuestionItemPayload,
  JobQuestionView,
} from "@/features/jobs/types"
import {
  askableCount,
  difficultyVariant,
  questionLabel,
  type ScreeningQuestion,
} from "@/features/screening-questions/types"
import { errorMessage } from "@/lib/errors"
import { cn } from "@/lib/utils"

/**
 * The presented questions as a PUT payload. `orderIndex` is re-derived from
 * array position, which is what makes it unique (a duplicate is a 422) and
 * makes "reorder" just "re-send in the new order".
 */
const toItems = (questions: JobQuestionView[]): JobQuestionItemPayload[] =>
  questions.map((q, index) => ({
    questionId: q.questionId,
    orderIndex: index,
    weightPct: q.weightPct,
  }))

/** Even split of 100, remainder to the earliest rows (3 → 34/33/33). */
const splitEvenly = (n: number): number[] => {
  if (n <= 0) return []
  const base = Math.floor(100 / n)
  const remainder = 100 - base * n
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0))
}

/**
 * Scale `weights` so they total exactly 100 while keeping their RATIOS —
 * used when adding or removing a row changes the denominator. 50/30 losing
 * its 20 becomes 63/37, not 34/33/33: the intent that the first question
 * matters most survives.
 *
 * Largest-remainder rounding, so the parts are integers that really sum to
 * 100 rather than 99 or 101 (`weightPct` is `@IsInt()` and the backend's
 * check is an exact `=== 100`).
 */
const rescaleToHundred = (weights: number[]): number[] => {
  if (weights.length === 0) return []
  const total = weights.reduce((sum, w) => sum + w, 0)
  // Nothing to preserve the ratio OF — fall back to an even split.
  if (total <= 0) return splitEvenly(weights.length)

  const exact = weights.map((w) => (w * 100) / total)
  const floors = exact.map(Math.floor)
  const short = 100 - floors.reduce((sum, w) => sum + w, 0)
  // Hand the leftover points to whoever was rounded down hardest.
  const byRemainder = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac)
  for (let i = 0; i < short; i++) floors[byRemainder[i].index] += 1
  return floors
}

const withWeights = (
  rows: JobQuestionView[],
  weights: number[],
): JobQuestionView[] => rows.map((q, i) => ({ ...q, weightPct: weights[i] }))

interface JobQuestionsManagerProps {
  job: Job
}

/**
 * The job's interview script: which questions, in what order, worth what
 * share of the score. The WORDING is not here — it lives in the bank, and
 * each candidate is served one of a question's variants at random.
 *
 * Edits are STAGED, unlike the rest of the app's save-on-change surfaces,
 * and that isn't a style choice: `weightPct` must total exactly 100, so
 * "typing 40 into one box" is a state the server must reject. Nothing is
 * sent until the numbers add up and you press Save.
 */
export function JobQuestionsManager({ job }: JobQuestionsManagerProps) {
  const queryClient = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [draft, setDraft] = useState<JobQuestionView[]>(job.questions)

  // Re-seed when the server's copy changes (save response, refetch, another
  // tab). Keyed on the server data itself, so a local edit doesn't trip it.
  useEffect(() => {
    setDraft(job.questions)
  }, [job.questions])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const mutation = useMutation({
    mutationFn: (items: JobQuestionItemPayload[]) =>
      setJobQuestions(job._id, items),
    onError: (err) => toast.error(errorMessage(err, "Could not save the questions.")),
    onSuccess: (saved) => {
      // The server response is the only correct picture (it re-reads the
      // bank for each slot's label + variant count), so take it wholesale.
      queryClient.setQueryData(["job", saved._id], saved)
      // The list page shows questionCount.
      queryClient.invalidateQueries({ queryKey: ["jobs"] })
      setAddOpen(false)
      toast.success("Questions saved.")
    },
  })

  const total = draft.reduce((sum, q) => sum + q.weightPct, 0)
  const balanced = draft.length === 0 || total === 100

  const dirty = useMemo(
    () =>
      JSON.stringify(toItems(draft)) !== JSON.stringify(toItems(job.questions)),
    [draft, job.questions],
  )

  // A slot whose bank row is gone can't be re-sent: the PUT resolves every
  // questionId org-scoped and 404s the WHOLE payload on any unknown id. So
  // the list is frozen until it's removed — say so instead of letting every
  // later edit fail with a raw id list.
  const orphaned = draft.filter((q) => q.text === null)

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = draft.findIndex((q) => q.questionId === active.id)
    const newIndex = draft.findIndex((q) => q.questionId === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    // Weights travel with their rows — reordering changes the running order,
    // never who is worth what.
    setDraft((prev) => arrayMove(prev, oldIndex, newIndex))
  }

  const handleAdd = (picks: ScreeningQuestion[]) => {
    setDraft((prev) => {
      const added: JobQuestionView[] = picks.map((pick) => ({
        questionId: pick._id,
        orderIndex: 0, // re-derived from array position on save
        // Provisional: an equal share of the current pie, then everything is
        // rescaled back to 100 below.
        weightPct: prev.length > 0 ? Math.round(100 / prev.length) : 100,
        text: questionLabel(pick),
        variantCount: askableCount(pick),
        difficultyLevel: pick.difficultyLevel,
        tags: pick.tags,
      }))
      const next = [...prev, ...added]
      return withWeights(next, rescaleToHundred(next.map((q) => q.weightPct)))
    })
    setAddOpen(false)
  }

  const handleRemove = (questionId: string) =>
    setDraft((prev) => {
      const next = prev.filter((q) => q.questionId !== questionId)
      // The removed row's share has to go somewhere; spread it over the
      // survivors in proportion so the remaining intent is preserved.
      return withWeights(next, rescaleToHundred(next.map((q) => q.weightPct)))
    })

  const handleWeight = (questionId: string, weightPct: number) =>
    setDraft((prev) =>
      prev.map((q) => (q.questionId === questionId ? { ...q, weightPct } : q)),
    )

  const handleDistribute = () =>
    setDraft((prev) => withWeights(prev, splitEvenly(prev.length)))

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
              {draft.length > 0
                ? `${draft.length} question${draft.length === 1 ? "" : "s"}, asked in this order. Every candidate gets the same order, in different words.`
                : "No questions attached — this job can't interview anyone yet."}
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
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
              No further change to this list can be saved until{" "}
              {orphaned.length === 1 ? "it is" : "they are"} removed.
            </span>
          </div>
        ) : null}

        {draft.length === 0 ? (
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
                items={draft.map((q) => q.questionId)}
                strategy={verticalListSortingStrategy}
              >
                <div className="flex flex-col gap-2">
                  {draft.map((question, index) => (
                    <SortableQuestionRow
                      key={question.questionId}
                      question={question}
                      index={index}
                      disabled={mutation.isPending}
                      onRemove={() => handleRemove(question.questionId)}
                      onWeight={(weightPct) =>
                        handleWeight(question.questionId, weightPct)
                      }
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </TooltipProvider>
        )}

        {draft.length > 0 ? (
          <div className="mt-4 flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  "text-xs font-medium tabular-nums",
                  balanced ? "text-muted-foreground" : "text-destructive",
                )}
              >
                Total {total}%
                {!balanced && ` — must be 100% (${total > 100 ? `${total - 100} over` : `${100 - total} short`})`}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={handleDistribute}
                disabled={mutation.isPending}
              >
                <Scale className="h-3.5 w-3.5" />
                Distribute evenly
              </Button>
            </div>

            <div className="flex items-center gap-2">
              {dirty ? (
                <span className="text-xs text-muted-foreground">
                  Unsaved changes
                </span>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!dirty || mutation.isPending}
                onClick={() => setDraft(job.questions)}
              >
                Reset
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!dirty || !balanced || mutation.isPending}
                title={
                  !balanced
                    ? "The weights must total 100% before this can be saved"
                    : undefined
                }
                onClick={() => mutation.mutate(toItems(draft))}
              >
                {mutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                {mutation.isPending ? "Saving…" : "Save questions"}
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>

      <AddJobQuestionsDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        attachedIds={draft.map((q) => q.questionId)}
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
  onWeight: (weightPct: number) => void
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
  sortableRef,
  style,
  isDragging,
  dragHandleRef,
  dragHandleListeners,
  dragHandleAttributes,
}: QuestionRowProps) {
  // Free-text draft so the box can be empty mid-typing; it only reaches the
  // staged list on blur, and only when it parsed to something new.
  const [weightDraft, setWeightDraft] = useState(String(question.weightPct))

  useEffect(() => {
    setWeightDraft(String(question.weightPct))
  }, [question.weightPct])

  const commitWeight = () => {
    const parsed = Number(weightDraft.trim())
    if (
      !weightDraft.trim() ||
      !Number.isInteger(parsed) ||
      parsed < 0 ||
      parsed > 100
    ) {
      setWeightDraft(String(question.weightPct))
      return
    }
    if (parsed !== question.weightPct) onWeight(parsed)
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
            {question.text ?? "(removed from the bank)"}
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

            {/* The wording shown above is only the bank's FIRST one. Say how
                many others exist, since that's what stops candidates
                comparing notes — and flag when there are none. */}
            {question.variantCount !== null ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className={cn(
                      "inline-flex cursor-help items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                      question.variantCount === 1
                        ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300"
                        : "border-border text-muted-foreground",
                    )}
                  >
                    {question.variantCount === 1
                      ? "1 wording"
                      : `${question.variantCount} wordings`}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {question.variantCount === 1 ? (
                    <p>
                      Every candidate for this job is asked these exact words.
                      Add wordings in the question bank to vary them.
                    </p>
                  ) : (
                    <p>
                      Each candidate is asked one of {question.variantCount}{" "}
                      wordings, picked at random. The words above are just the
                      first one.
                    </p>
                  )}
                </TooltipContent>
              </Tooltip>
            ) : null}

            {question.text === null ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex cursor-help items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-300">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    Removed from the bank
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>
                    This question no longer exists in the question bank, so it
                    has no wording to ask. Remove this row before saving.
                  </p>
                </TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <label className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">Weight</span>
            <div className="relative">
              <Input
                type="number"
                min={0}
                max={100}
                step={1}
                value={weightDraft}
                disabled={disabled}
                aria-label={`Percent of the score for question ${index + 1}`}
                title="Percent of the interview score. All questions must total 100%."
                onChange={(e) => setWeightDraft(e.target.value)}
                onBlur={commitWeight}
                className="h-8 w-20 pr-5 text-xs"
              />
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
                %
              </span>
            </div>
          </label>
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
