import { useEffect, useMemo, useState } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Loader2, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { listScreeningQuestions } from "@/features/screening-questions/screeningQuestionsApi"
import {
  DIFFICULTY_LABELS,
  questionLabel,
  type DifficultyLevel,
  type ScreeningQuestion,
} from "@/features/screening-questions/types"
import { cn } from "@/lib/utils"

const ALL = "all"
const FETCH_LIMIT = 100

const DIFFICULTIES = Object.keys(DIFFICULTY_LABELS) as DifficultyLevel[]

/**
 * The bank has no first-class "category" field — the design's category filter
 * is wired through the `tags` param so a shop that tags its questions with
 * these familiar buckets can still narrow by them.
 */
const CATEGORY_OPTIONS = [
  "Introductory",
  "Behavioral",
  "Technical",
  "System Design",
  "Culture Fit",
  "Situational",
] as const

/** Tone token per difficulty band — the small chip on each row. */
const DIFFICULTY_CHIP: Record<
  DifficultyLevel,
  { bg: string; text: string }
> = {
  easy: {
    bg: "bg-[var(--success-soft)]",
    text: "text-[var(--success)]",
  },
  medium: {
    bg: "bg-[var(--warning-soft)]",
    text: "text-[var(--warning)]",
  },
  hard: {
    bg: "bg-[var(--danger-soft)]",
    text: "text-[var(--danger)]",
  },
}

interface AddJobQuestionsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Already-attached bank ids — the same question twice is a 422. */
  attachedIds: string[]
  /** Appends the picks to the job's list, in the order they were selected. */
  onAdd: (questions: ScreeningQuestion[]) => void
  saving: boolean
}

/**
 * Pick questions from the org's bank to append to a job's interview script.
 * Already-attached rows are shown as disabled rather than hidden — the absence
 * of a question you expected reads as "already on this job" instead of a
 * broken filter.
 *
 * Rows show the bank's FIRST wording. A candidate may be asked any of the
 * question's variants — picking one here picks all of them.
 */
export function AddJobQuestionsDialog({
  open,
  onOpenChange,
  attachedIds,
  onAdd,
  saving,
}: AddJobQuestionsDialogProps) {
  const [search, setSearch] = useState("")
  const [difficulty, setDifficulty] = useState<string>(ALL)
  const [category, setCategory] = useState<string>(ALL)
  // Ordered picks — they're appended to the script in this order.
  const [selected, setSelected] = useState<ScreeningQuestion[]>([])

  useEffect(() => {
    if (!open) return
    setSearch("")
    setDifficulty(ALL)
    setCategory(ALL)
    setSelected([])
  }, [open])

  const questionsQuery = useQuery({
    queryKey: [
      "screeningQuestions",
      { search, difficulty, category, limit: FETCH_LIMIT },
    ],
    queryFn: () =>
      listScreeningQuestions({
        page: 1,
        limit: FETCH_LIMIT,
        search: search.trim() || undefined,
        difficultyLevel:
          difficulty !== ALL ? (difficulty as DifficultyLevel) : undefined,
        // The bank has no category field of its own; a category filter is
        // sent as a tag narrower, which matches any question tagged with it.
        tags: category !== ALL ? [category] : undefined,
      }),
    enabled: open,
    placeholderData: keepPreviousData,
  })

  const attached = useMemo(() => new Set(attachedIds), [attachedIds])
  const selectedSet = useMemo(
    () => new Set(selected.map((q) => q._id)),
    [selected],
  )
  const rows = questionsQuery.data?.data ?? []

  const toggle = (question: ScreeningQuestion) => {
    if (attached.has(question._id)) return
    setSelected((prev) =>
      prev.some((q) => q._id === question._id)
        ? prev.filter((q) => q._id !== question._id)
        : [...prev, question],
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && saving) return
        onOpenChange(next)
      }}
    >
      <DialogContent className="flex max-h-[90vh] max-w-[560px] flex-col gap-0 p-0">
        <div className="flex items-start justify-between gap-4 px-6 pt-[22px] pb-[14px]">
          <div className="min-w-0">
            <DialogTitle className="text-[18px] font-semibold leading-tight">
              Add questions
            </DialogTitle>
            <DialogDescription className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
              Pick from your bank and set a weight for each. Weights are
              normalised to total 100% when the interview is scored.
            </DialogDescription>
          </div>
        </div>

        <div className="flex gap-2.5 px-6 pt-1 pb-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-ink-subtle" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search questions…"
              className="h-[37px] w-full rounded-[9px] border border-[var(--field-border)] bg-surface pl-9 pr-3 text-[13px] text-ink outline-none placeholder:text-ink-subtle focus:border-primary focus:shadow-[0_0_0_3px_var(--accent-ring)]"
            />
          </div>
          <Select
            value={difficulty}
            onValueChange={(v) => setDifficulty(v)}
          >
            <SelectTrigger
              aria-label="Filter by difficulty"
              className="h-[37px] w-[140px] shrink-0 rounded-[9px]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All difficulties</SelectItem>
              {DIFFICULTIES.map((d) => (
                <SelectItem key={d} value={d}>
                  {DIFFICULTY_LABELS[d]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={category} onValueChange={(v) => setCategory(v)}>
            <SelectTrigger
              aria-label="Filter by category"
              className="h-[37px] w-[150px] shrink-0 rounded-[9px]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All categories</SelectItem>
              {CATEGORY_OPTIONS.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid max-h-[420px] min-h-0 flex-1 gap-2 overflow-auto px-6 py-2">
          {questionsQuery.isLoading ? (
            <QuestionPickerSkeleton />
          ) : questionsQuery.isError ? (
            <p className="py-12 text-center text-[13px] text-[var(--danger)]">
              Could not load questions.{" "}
              <button
                onClick={() => questionsQuery.refetch()}
                className="underline"
              >
                Retry
              </button>
            </p>
          ) : rows.length === 0 ? (
            <p className="py-12 text-center text-[13px] text-ink-muted">
              No questions match these filters.
            </p>
          ) : (
            rows.map((question) => {
              const isAttached = attached.has(question._id)
              const isSelected = selectedSet.has(question._id)
              const chip = DIFFICULTY_CHIP[question.difficultyLevel]
              return (
                <label
                  key={question._id}
                  className={cn(
                    "flex items-start gap-2.5 rounded-lg border border-line p-3",
                    isAttached
                      ? "cursor-default opacity-55"
                      : "cursor-pointer hover:border-primary/40",
                    isSelected && !isAttached ? "bg-accent border-primary" : "",
                  )}
                >
                  <input
                    type="checkbox"
                    disabled={isAttached}
                    checked={isAttached || isSelected}
                    onChange={() => toggle(question)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent-solid,var(--accent))]"
                    style={{ accentColor: "var(--accent, currentColor)" }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-medium text-ink">
                      {questionLabel(question)}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-semibold capitalize",
                          chip.bg,
                          chip.text,
                        )}
                      >
                        {question.difficultyLevel}
                      </span>
                      {question.tags.slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center rounded-full bg-surface-3 px-2 py-0.5 text-[11.5px] font-medium text-ink-2"
                        >
                          {tag}
                        </span>
                      ))}
                      {isAttached ? (
                        <span className="text-[11.5px] text-ink-subtle">
                          · already attached
                        </span>
                      ) : null}
                    </div>
                  </div>
                </label>
              )
            })
          )}
        </div>

        <div className="flex justify-end gap-2.5 border-t border-line px-6 py-4">
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            onClick={() => onAdd(selected)}
            disabled={selected.length === 0 || saving}
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Adding…
              </>
            ) : (
              <>
                Add selected
                {selected.length > 0 ? ` (${selected.length})` : ""}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Loading placeholder for the question picker. Mirrors a real option row —
 * a checkbox, the question text and a chip row (difficulty + tags) inside a
 * bordered card — so the list keeps its shape while the bank loads.
 */
function QuestionPickerSkeleton() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="flex items-start gap-2.5 rounded-lg border border-line p-3"
        >
          <Skeleton className="mt-0.5 h-4 w-4 shrink-0 rounded" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3.5 w-3/4 max-w-full" />
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-12 rounded-full" />
              <Skeleton className="h-5 w-14 rounded-full" />
            </div>
          </div>
        </div>
      ))}
    </>
  )
}
