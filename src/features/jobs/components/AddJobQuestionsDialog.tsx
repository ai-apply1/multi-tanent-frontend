import { useEffect, useState } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Loader2, Plus, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { listBankQuestions } from "@/features/jobs/jobsApi"
import {
  DIFFICULTY_LABELS,
  type BankQuestion,
  type DifficultyLevel,
} from "@/features/jobs/types"

const ALL = "all"
const PAGE_SIZE = 25

const DIFFICULTIES = Object.keys(DIFFICULTY_LABELS) as DifficultyLevel[]

const difficultyVariant: Record<
  DifficultyLevel,
  "success" | "warning" | "destructive"
> = {
  easy: "success",
  medium: "warning",
  hard: "destructive",
}

interface AddJobQuestionsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Already-attached bank ids — the same question twice is a 422. */
  attachedIds: string[]
  /** Appends the picks to the job's list, in the order they were selected. */
  onAdd: (questions: BankQuestion[]) => void
  saving: boolean
}

/**
 * Pick questions from the org's bank to append to a job's interview script.
 * Already-attached rows are shown as disabled rather than hidden, so the
 * absence of a question you expected reads as "already on this job" instead
 * of a broken filter.
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
  const [page, setPage] = useState(1)
  // Ordered picks — they're appended to the script in this order.
  const [selected, setSelected] = useState<BankQuestion[]>([])

  useEffect(() => {
    if (!open) return
    setSearch("")
    setDifficulty(ALL)
    setPage(1)
    setSelected([])
  }, [open])

  const questionsQuery = useQuery({
    queryKey: ["screeningQuestions", { search, difficulty, page }],
    queryFn: () =>
      listBankQuestions({
        page,
        limit: PAGE_SIZE,
        search: search.trim() || undefined,
        difficultyLevel:
          difficulty !== ALL ? (difficulty as DifficultyLevel) : undefined,
      }),
    enabled: open,
    placeholderData: keepPreviousData,
  })

  const attached = new Set(attachedIds)
  const selectedIds = selected.map((q) => q._id)
  const rows = questionsQuery.data?.data ?? []
  const total = questionsQuery.data?.count ?? 0

  const toggle = (question: BankQuestion) =>
    setSelected((prev) =>
      prev.some((q) => q._id === question._id)
        ? prev.filter((q) => q._id !== question._id)
        : [...prev, question],
    )

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && saving) return
        onOpenChange(next)
      }}
    >
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>Add questions</DialogTitle>
          <DialogDescription>
            Pick from your question bank. They're appended to the end of this
            job's script — you can reorder them afterwards.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 py-2">
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
                placeholder="Search questions…"
                className="pl-9"
              />
            </div>
            <Select
              value={difficulty}
              onValueChange={(v) => {
                setDifficulty(v)
                setPage(1)
              }}
            >
              <SelectTrigger
                aria-label="Filter by difficulty"
                className="w-full sm:w-40"
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
          </div>

          <div className="min-h-48 flex-1 overflow-y-auto rounded-lg border border-border">
            {questionsQuery.isLoading ? (
              <p className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading questions…
              </p>
            ) : questionsQuery.isError ? (
              <p className="py-12 text-center text-sm text-destructive">
                Could not load questions.{" "}
                <button
                  onClick={() => questionsQuery.refetch()}
                  className="underline"
                >
                  Retry
                </button>
              </p>
            ) : rows.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                No questions match these filters.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {rows.map((question) => {
                  const order = selectedIds.indexOf(question._id)
                  const isSelected = order >= 0
                  const isAttached = attached.has(question._id)
                  return (
                    <li key={question._id}>
                      <button
                        type="button"
                        disabled={isAttached}
                        title={
                          isAttached ? "Already attached to this job" : undefined
                        }
                        onClick={() => toggle(question)}
                        className={`flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent ${
                          isSelected ? "bg-primary/10" : ""
                        }`}
                      >
                        <span
                          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[11px] font-semibold ${
                            isSelected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-muted-foreground/40"
                          }`}
                        >
                          {isSelected ? order + 1 : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="line-clamp-2 block text-sm font-medium">
                            {question.text}
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-1.5">
                            <Badge
                              variant={difficultyVariant[question.difficultyLevel]}
                              className="capitalize"
                            >
                              {question.difficultyLevel}
                            </Badge>
                            {question.tags.map((tag) => (
                              <Badge key={tag} variant="secondary">
                                {tag}
                              </Badge>
                            ))}
                            {isAttached ? (
                              <span className="text-xs text-muted-foreground">
                                Already attached
                              </span>
                            ) : null}
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {total > 0 ? (
            <div className="flex shrink-0 items-center justify-between text-xs text-muted-foreground">
              <span>
                {total} question{total === 1 ? "" : "s"} · page {page}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || questionsQuery.isFetching}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={
                    !questionsQuery.data?.nextPage || questionsQuery.isFetching
                  }
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        {/* Selection tray — the picks stay visible regardless of filters/paging. */}
        {selected.length > 0 ? (
          <div className="shrink-0">
            <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
              <div className="flex max-h-21 flex-wrap content-start items-start gap-1.5 overflow-y-auto">
                {selected.map((question, i) => (
                  <span
                    key={question._id}
                    className="inline-flex h-6 max-w-56 items-center gap-1.5 rounded-md border border-primary/25 bg-primary/5 pl-1 pr-0.5 text-xs shadow-sm"
                  >
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-primary/15 text-[10px] font-semibold tabular-nums text-primary">
                      {i + 1}
                    </span>
                    <span
                      className="truncate text-foreground/90"
                      title={question.text}
                    >
                      {question.text}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggle(question)}
                      aria-label="Remove from selection"
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-primary/20 hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="mt-2.5 flex items-center justify-between gap-2">
                <p className="text-[11px] text-muted-foreground">
                  Appended to the script in this order
                </p>
                <button
                  type="button"
                  onClick={() => setSelected([])}
                  className="shrink-0 text-[11px] font-medium text-muted-foreground underline-offset-2 transition-colors hover:text-destructive hover:underline"
                >
                  Clear all
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <DialogFooter className="shrink-0 border-t border-border pt-4">
          <Button
            type="button"
            variant="outline"
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
                <Plus className="h-4 w-4" />
                Add {selected.length > 0 ? `(${selected.length})` : ""}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
