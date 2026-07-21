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
import { AlertTriangle, Loader2, Plus, Scale, Star } from "lucide-react"
import toast from "react-hot-toast"
import { Button } from "@/components/ui/button"
import { AddJobQuestionsDialog } from "@/features/jobs/components/AddJobQuestionsDialog"
import { setJobQuestions } from "@/features/jobs/jobsApi"
import type {
  Job,
  JobQuestionItemPayload,
  JobQuestionView,
} from "@/features/jobs/types"
import {
  allAudioReady,
  askableCount,
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

const DIFFICULTY_CHIP: Record<string, string> = {
  easy: "bg-[var(--success-soft)] text-[var(--success)]",
  medium: "bg-[var(--warning-soft)] text-[var(--warning)]",
  hard: "bg-[var(--danger-soft)] text-[var(--danger)]",
}

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
    // Backstop the dialog's own gate: a stale list (a clip that failed
    // generation after the picker loaded) must not slip a silent question
    // onto the job. Skip any pick that isn't fully voiced and say which.
    const ready = picks.filter(allAudioReady)
    const skipped = picks.length - ready.length
    if (skipped > 0) {
      toast.error(
        `Skipped ${skipped} question${skipped === 1 ? "" : "s"} whose audio isn't ready yet.`,
      )
    }
    if (ready.length === 0) {
      setAddOpen(false)
      return
    }
    setDraft((prev) => {
      const added: JobQuestionView[] = ready.map((pick) => ({
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

  /**
   * Split 100% across every question as evenly as an integer split allows.
   * `rescaleToHundred` handles the drift — for N=3 the raw shares are 33.33
   * each, this hands them 33/33/34 in a stable order so the total still lands
   * on the exact 100 the backend requires.
   */
  const handleDistributeEvenly = () => {
    if (draft.length === 0) return
    const even = Array(draft.length).fill(100 / draft.length)
    setDraft(withWeights(draft, rescaleToHundred(even)))
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-6">
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Star className="h-[18px] w-[18px] text-primary" strokeWidth={1.7} />
          <h2 className="text-[15px] font-semibold text-ink">Interview questions</h2>
        </div>
        <div className="flex items-center gap-2">
          {/* Distribute evenly — always available when there's more than one
              question. Fires the same draft update path as a manual edit, so
              the Save button still lights up and the total-weight footer
              recomputes without special-casing. */}
          {draft.length > 1 ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={mutation.isPending}
              onClick={handleDistributeEvenly}
              title="Split 100% evenly across every question"
            >
              <Scale className="h-4 w-4" />
              Distribute evenly
            </Button>
          ) : null}
          {dirty ? (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={mutation.isPending}
                onClick={() => setDraft(job.questions)}
              >
                Reset
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!balanced || mutation.isPending || orphaned.length > 0}
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
                {mutation.isPending ? "Saving…" : "Save"}
              </Button>
            </>
          ) : null}
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" />
            Add questions
          </Button>
        </div>
      </div>

      <p className="mt-1 mb-3.5 text-[13px] text-ink-muted">
        {draft.length > 0
          ? `${draft.length} question${draft.length === 1 ? "" : "s"}, asked in this order. Edit each weight (%) — the total should reach 100%.`
          : "No questions yet."}
      </p>

      {orphaned.length > 0 ? (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger-soft)] p-3 text-[12.5px] leading-relaxed text-[var(--danger)]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.7} />
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
        <div className="rounded-xl border border-dashed border-line-2 py-8 text-center text-[13px] text-ink-muted">
          This job has no questions yet. Add some from your bank.
        </div>
      ) : (
        <>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={draft.map((q) => q.questionId)}
              strategy={verticalListSortingStrategy}
            >
              <div className="grid gap-2">
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

          <div className="mt-0.5 flex items-center justify-between border-t border-line px-3.5 py-3">
            <span className="text-[12.5px] font-semibold text-ink-muted">
              Total weight
            </span>
            <span
              className={cn(
                "mono text-[14px] font-bold",
                balanced ? "text-[var(--success)]" : "text-[var(--warning)]",
              )}
            >
              {total}%{balanced ? "" : " — should total 100%"}
            </span>
          </div>
        </>
      )}

      <AddJobQuestionsDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        attachedIds={draft.map((q) => q.questionId)}
        onAdd={handleAdd}
        saving={mutation.isPending}
      />
    </div>
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

  // Arrow-key stepping (↑/↓ by 1, Shift+↑/↓ by 10), like a number spinner.
  // Steps from whatever the box currently shows, falling back to the committed
  // value when it's mid-edit (empty/non-integer). Clamped to 0–100 and pushed
  // straight to the staged list so the total-weight footer updates live.
  const step = (delta: number) => {
    const parsed = Number(weightDraft.trim())
    const base =
      weightDraft.trim() && Number.isInteger(parsed)
        ? parsed
        : question.weightPct
    const next = Math.min(100, Math.max(0, base + delta))
    setWeightDraft(String(next))
    if (next !== question.weightPct) onWeight(next)
  }

  const diffClass = question.difficultyLevel
    ? DIFFICULTY_CHIP[question.difficultyLevel]
    : ""

  return (
    <div
      ref={sortableRef}
      style={style}
      className={cn(
        "flex items-center gap-3 rounded-xl border border-line bg-surface px-3.5 py-3",
        isDragging && "z-10 opacity-60 shadow-lg",
      )}
    >
      <button
        type="button"
        ref={dragHandleRef}
        {...dragHandleAttributes}
        {...dragHandleListeners}
        aria-label={`Drag to reorder question ${index + 1}`}
        title="Drag to reorder"
        className="cursor-grab touch-none border-0 bg-transparent p-0 text-[14px] text-ink-subtle active:cursor-grabbing"
      >
        ⠿
      </button>

      <span className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full bg-surface-3 text-[11px] font-bold text-ink-2">
        {index + 1}
      </span>

      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-medium text-ink">
          {question.text ?? "(removed from the bank)"}
        </div>
        {(question.difficultyLevel ||
          question.tags.length > 0 ||
          question.text === null) && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {question.difficultyLevel ? (
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize",
                  diffClass,
                )}
              >
                {question.difficultyLevel}
              </span>
            ) : null}
            {question.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-ink-2"
              >
                {tag}
              </span>
            ))}
            {question.text === null ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--danger-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--danger)]">
                <AlertTriangle className="h-3 w-3" strokeWidth={1.9} />
                Removed from the bank
              </span>
            ) : null}
          </div>
        )}
      </div>

      <div className="flex flex-col items-end gap-0.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
          Weight
        </span>
        <div className="flex h-8 w-[74px] items-center overflow-hidden rounded-lg border border-[var(--field-border)]">
          <input
            value={weightDraft}
            disabled={disabled}
            aria-label={`Percent of the score for question ${index + 1}`}
            title="Percent of the interview score. All questions must total 100%."
            onChange={(e) =>
              setWeightDraft(e.target.value.replace(/[^0-9]/g, ""))
            }
            onKeyDown={(e) => {
              if (e.key === "ArrowUp") {
                e.preventDefault()
                step(e.shiftKey ? 10 : 1)
              } else if (e.key === "ArrowDown") {
                e.preventDefault()
                step(e.shiftKey ? -10 : -1)
              }
            }}
            onBlur={commitWeight}
            className="mono h-full w-[44px] border-0 bg-transparent px-1 text-right text-[13px] font-bold text-primary outline-none"
            inputMode="numeric"
          />
          <span className="mono px-2.5 text-[12px] text-ink-muted">%</span>
        </div>
      </div>

      <button
        type="button"
        disabled={disabled}
        aria-label={`Remove question ${index + 1}`}
        title="Remove from this job"
        onClick={onRemove}
        className="cursor-pointer border-0 bg-transparent p-0 text-ink-subtle hover:text-[var(--danger)] disabled:cursor-not-allowed"
      >
        ✕
      </button>
    </div>
  )
}
