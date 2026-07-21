import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Star, X } from "lucide-react"
import toast from "react-hot-toast"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle
} from "@/components/ui/dialog"
import { VariantAudioStatus } from "@/features/screening-questions/components/VariantAudioStatus"
import { VariantAudioPlayer } from "@/features/screening-questions/components/VariantAudioPlayer"
import {
  generateQuestionAudio,
  getScreeningQuestion
} from "@/features/screening-questions/screeningQuestionsApi"
import {
  DIFFICULTY_LABELS,
  generatingVariants,
  variantAudioState,
  type DifficultyLevel,
  type ScreeningQuestion
} from "@/features/screening-questions/types"
import { errorMessage as apiError } from "@/lib/errors"

/** How often to re-check while a clip is still being generated. */
const AUDIO_POLL_MS = 2000

interface QuestionPreviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** `null` while the parent hasn't picked a row — the body then doesn't render. */
  question: ScreeningQuestion | null
  /**
   * Fires from the "+" button in the synonyms header and the "Generate synonyms"
   * footer CTA — the parent wires it to open the existing edit dialog on the
   * same question. This dialog closes as a side effect of that swap.
   */
  onEdit: (q: ScreeningQuestion) => void
}

/** Difficulty pill colors mirror the bank row's `DIFFICULTY_PILL`. */
const DIFFICULTY_PILL: Record<DifficultyLevel, string> = {
  easy: "bg-[var(--success-soft)] text-[var(--success)]",
  medium: "bg-[var(--warning-soft)] text-[var(--warning)]",
  hard: "bg-[var(--danger-soft)] text-[var(--danger)]"
}

/**
 * Preview of a bank question: the canonical wording plus every still-askable
 * synonym, each showing whether its voice clip is ready and offering a play
 * button (when ready) or a regenerate (when missing / failed).
 *
 * The `question` prop is a snapshot from the list, which is stale the moment
 * a clip finishes generating — so, exactly like the edit dialog, this fetches
 * the live row and polls it while anything is still generating. Editing the
 * wording itself stays deferred to the edit dialog (`onEdit`); only audio is
 * actionable here.
 */
export function QuestionPreviewDialog({
  open,
  onOpenChange,
  question,
  onEdit
}: QuestionPreviewDialogProps) {
  const queryClient = useQueryClient()

  // Live audio state. Seeded from the prop so the body renders instantly, then
  // polled only while a clip is mid-flight (an idle preview costs nothing).
  const liveQuery = useQuery({
    queryKey: ["screeningQuestion", question?._id],
    queryFn: () => getScreeningQuestion(question!._id),
    enabled: open && Boolean(question),
    initialData: question ?? undefined,
    refetchInterval: (q) => {
      const data = q.state.data
      return data && generatingVariants(data).length > 0 ? AUDIO_POLL_MS : false
    }
  })

  const generateMutation = useMutation({
    mutationFn: (variantIds?: string[]) =>
      generateQuestionAudio(question!._id, variantIds),
    onSuccess: (updated) => {
      queryClient.setQueryData(["screeningQuestion", updated._id], updated)
      queryClient.invalidateQueries({ queryKey: ["screeningQuestions"] })
      toast.success("Generating voice audio…")
    },
    onError: (err) =>
      toast.error(apiError(err, "Could not start audio generation."))
  })

  // Nothing to render without a question — but Radix still needs the Dialog
  // root mounted so the open/close transition stays owned by this component.
  if (!question) {
    return <Dialog open={open} onOpenChange={onOpenChange} />
  }

  // Prefer the live copy; fall back to the prop until the first fetch lands.
  const live = liveQuery.data ?? question

  // variants[0] (first still-askable) is the canonical wording; the rest are
  // the synonyms. Retired wordings are hidden — neither served nor generated.
  const askable = live.variants.filter((v) => !v.retired)
  const canonical = askable[0]
  const synonyms = askable.slice(1)

  const handleEdit = () => {
    onEdit(question)
  }

  const generatePending = generateMutation.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideCloseButton className="max-w-[540px] gap-0 p-0">
        {/* Header — custom layout, not the default DialogHeader. Uses the
            Radix DialogTitle/Description elements to satisfy a11y while
            still matching the design's spacing/typography. */}
        <div className="flex items-start justify-between gap-4 px-6 pb-[14px] pt-[22px]">
          <div>
            <DialogTitle className="text-[18px] font-semibold text-ink">
              Question
            </DialogTitle>
            <DialogDescription className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
              This is your canonical question. Each interview asks an
              AI-paraphrased synonym below.
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <button
              type="button"
              aria-label="Close"
              className="inline-flex text-ink-muted hover:text-ink"
            >
              <X className="h-5 w-5" strokeWidth={1.7} />
            </button>
          </DialogClose>
        </div>

        {/* Body */}
        <div className="scroll overflow-auto px-6 pb-5">
          {/* Canonical question card */}
          {canonical ? (
            <div className="mb-4 flex gap-3 rounded-xl border border-line bg-surface-2 p-4">
              <span className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
                <Star className="h-4 w-4" strokeWidth={1.7} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold leading-snug text-ink">
                  {canonical.text}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${
                      DIFFICULTY_PILL[live.difficultyLevel]
                    }`}
                  >
                    {DIFFICULTY_LABELS[live.difficultyLevel]}
                  </span>
                  <VariantAudioStatus
                    variant={canonical}
                    retired={false}
                    busy={generatePending}
                    onRetry={() => generateMutation.mutate([canonical._id])}
                  />
                  {variantAudioState(canonical) === "ready" ? (
                    <VariantAudioPlayer
                      questionId={live._id}
                      variantId={canonical._id}
                    />
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {/* Synonyms header */}
          <div className="mb-2.5 flex items-center gap-2">
            <button
              type="button"
              onClick={handleEdit}
              aria-label="Add synonym"
              title="Add synonym"
              className="flex h-5 w-5 items-center justify-center rounded-md bg-accent text-[15px] leading-none text-primary hover:bg-primary hover:text-white"
            >
              <Plus className="h-3 w-3" strokeWidth={2.2} />
            </button>
            <span className="text-[12px] font-bold uppercase tracking-[0.04em] text-ink-subtle">
              Synonyms
            </span>
            <span className="mono text-[11.5px] text-ink-muted">
              {synonyms.length}
            </span>
          </div>

          {/* Synonyms list / empty state */}
          {synonyms.length > 0 ? (
            <div className="grid gap-2">
              {synonyms.map((variant, i) => (
                <div
                  key={variant._id}
                  className="flex items-start gap-3 rounded-[10px] border border-line p-3"
                >
                  <span className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full bg-surface-3 text-[11px] font-bold text-ink-2">
                    {i + 1}
                  </span>
                  <span className="flex-1 text-[13.5px] leading-snug text-ink-2">
                    {variant.text}
                  </span>
                  <div className="flex flex-shrink-0 items-center gap-1.5">
                    <VariantAudioStatus
                      variant={variant}
                      retired={false}
                      busy={generatePending}
                      onRetry={() => generateMutation.mutate([variant._id])}
                    />
                    {variantAudioState(variant) === "ready" ? (
                      <VariantAudioPlayer
                        questionId={live._id}
                        variantId={variant._id}
                      />
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-line-2 py-7 text-center text-[13px] text-ink-muted">
              No synonyms yet. Generate some from the edit screen.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2.5 border-t border-line px-6 py-4">
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button size="sm" onClick={handleEdit}>
            Generate synonyms
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
