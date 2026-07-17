import { Plus, Star, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle
} from "@/components/ui/dialog"
import {
  askableCount,
  DIFFICULTY_LABELS,
  questionLabel,
  type DifficultyLevel,
  type ScreeningQuestion
} from "@/features/screening-questions/types"

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
 * Read-only preview of a bank question: the canonical wording plus every
 * still-askable synonym. Editing is intentionally elsewhere — the "+" and
 * "Generate synonyms" affordances defer to the parent's edit dialog rather
 * than duplicating its form here.
 */
export function QuestionPreviewDialog({
  open,
  onOpenChange,
  question,
  onEdit
}: QuestionPreviewDialogProps) {
  // Nothing to render without a question — but Radix still needs the Dialog
  // root mounted so the open/close transition stays owned by this component.
  if (!question) {
    return <Dialog open={open} onOpenChange={onOpenChange} />
  }

  const canonical = questionLabel(question)
  // variants[0] is the canonical wording; the rest (still askable) are the
  // synonyms the design surfaces below. Retired wordings are hidden — they
  // are neither served to candidates nor useful for a preview.
  const synonyms = question.variants
    .filter((v) => !v.retired)
    .slice(1)
    .map((v) => v.text)
  const synonymCount = Math.max(0, askableCount(question) - 1)

  const handleEdit = () => {
    onEdit(question)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideCloseButton
        className="max-w-[540px] gap-0 p-0"
      >
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
          <div className="mb-4 flex gap-3 rounded-xl border border-line bg-surface-2 p-4">
            <span className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
              <Star className="h-4 w-4" strokeWidth={1.7} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold leading-snug text-ink">
                {canonical}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${
                    DIFFICULTY_PILL[question.difficultyLevel]
                  }`}
                >
                  {DIFFICULTY_LABELS[question.difficultyLevel]}
                </span>
              </div>
            </div>
          </div>

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
              {synonymCount}
            </span>
          </div>

          {/* Synonyms list / empty state */}
          {synonyms.length > 0 ? (
            <div className="grid gap-2">
              {synonyms.map((text, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 rounded-[10px] border border-line p-3"
                >
                  <span className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full bg-surface-3 text-[11px] font-bold text-ink-2">
                    {i + 1}
                  </span>
                  <span className="flex-1 text-[13.5px] leading-snug text-ink-2">
                    {text}
                  </span>
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
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
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
