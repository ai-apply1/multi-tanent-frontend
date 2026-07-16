import { useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2, Save } from "lucide-react"
import toast from "react-hot-toast"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { TagsInput } from "@/features/screening-questions/components/TagsInput"
import {
  createScreeningQuestion,
  updateScreeningQuestion
} from "@/features/screening-questions/screeningQuestionsApi"
import {
  DIFFICULTY_LABELS,
  DIFFICULTY_LEVELS,
  QUESTION_TEXT_MAX_LENGTH,
  type CreateScreeningQuestionPayload,
  type DifficultyLevel,
  type ScreeningQuestion
} from "@/features/screening-questions/types"
import { errorMessage as apiError } from "@/lib/errors"
import { cn } from "@/lib/utils"

interface QuestionFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Pass an existing row to edit it; omit/null to create a new one. */
  question?: ScreeningQuestion | null
  /** Tags already in use, offered as suggestions (see `TagsInput`). */
  tagSuggestions?: string[]
}

/**
 * Create / edit one bank question.
 *
 * The list row IS the full record, so there's no detail fetch — everything
 * the form edits (`text` / `difficultyLevel` / `tags`) comes straight off the
 * row and saves in a single request.
 */
export function QuestionFormDialog({
  open,
  onOpenChange,
  question,
  tagSuggestions = []
}: QuestionFormDialogProps) {
  const queryClient = useQueryClient()

  const [text, setText] = useState("")
  // Only red once the field has been interacted with — a fresh dialog
  // shouldn't open covered in errors.
  const [textTouched, setTextTouched] = useState(false)
  // "" = nothing picked. Deliberately NOT seeded with a band on create: the
  // backend DTO has no default, so a pre-selected value would silently
  // choose for the user (and the schema default only applies to writes the
  // DTO never lets through).
  const [difficulty, setDifficulty] = useState<DifficultyLevel | "">("")
  const [tags, setTags] = useState<string[]>([])

  const isEdit = Boolean(question)

  // Seed on open; reset to blanks for a fresh create.
  useEffect(() => {
    if (!open) return
    setTextTouched(false)
    setText(question?.text ?? "")
    setDifficulty(question?.difficultyLevel ?? "")
    setTags(question?.tags ?? [])
  }, [open, question])

  const saveMutation = useMutation({
    mutationFn: (payload: CreateScreeningQuestionPayload) =>
      question
        ? updateScreeningQuestion(question._id, payload)
        : createScreeningQuestion(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["screeningQuestions"] })
      toast.success(isEdit ? "Question saved." : "Question created.")
      onOpenChange(false)
    },
    onError: (err) =>
      toast.error(
        apiError(
          err,
          isEdit ? "Could not update question." : "Could not create question."
        )
      )
  })

  const textEmpty = text.trim().length === 0
  const canSubmit = !textEmpty && difficulty !== "" && !saveMutation.isPending

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // `!difficulty` re-checks what `canSubmit` already covers — it's what
    // narrows the union to `DifficultyLevel` for the payload.
    if (!canSubmit || !difficulty) return
    saveMutation.mutate({
      text: text.trim(),
      difficultyLevel: difficulty,
      tags
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && saveMutation.isPending) return
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {isEdit ? "Edit question" : "Add question"}
            </DialogTitle>
            <DialogDescription>
              Jobs draw their screening questions from this bank. Editing the
              wording here never changes a job that already uses the question.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-5 py-4">
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="q-text">Question</Label>
                <span
                  className={cn(
                    "text-xs tabular-nums",
                    text.length >= QUESTION_TEXT_MAX_LENGTH
                      ? "text-destructive"
                      : "text-muted-foreground"
                  )}
                >
                  {text.length}/{QUESTION_TEXT_MAX_LENGTH}
                </span>
              </div>
              <Textarea
                id="q-text"
                value={text}
                onChange={(e) => {
                  setTextTouched(true)
                  setText(e.target.value)
                }}
                rows={6}
                maxLength={QUESTION_TEXT_MAX_LENGTH}
                placeholder="Walk me through how you would design a rate limiter for a public API."
                autoFocus
                aria-invalid={textTouched && textEmpty}
              />
              {textTouched && textEmpty ? (
                <p className="text-xs text-destructive">
                  Question text is required.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  The canonical wording. Each interview asks an AI-paraphrased
                  variant of it.
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2.5">
              <Label htmlFor="q-difficulty">Difficulty</Label>
              <Select
                // `undefined` (not "") keeps Radix showing the placeholder —
                // it forbids an empty-string value.
                value={difficulty || undefined}
                onValueChange={(v) => setDifficulty(v as DifficultyLevel)}
              >
                <SelectTrigger id="q-difficulty">
                  <SelectValue placeholder="Select a difficulty" />
                </SelectTrigger>
                <SelectContent>
                  {DIFFICULTY_LEVELS.map((d) => (
                    <SelectItem key={d} value={d}>
                      {DIFFICULTY_LABELS[d]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Required — there is no default band.
              </p>
            </div>

            <div className="flex flex-col gap-2.5">
              <Label htmlFor="q-tags">Tags</Label>
              <TagsInput
                id="q-tags"
                value={tags}
                onChange={setTags}
                suggestions={tagSuggestions}
                placeholder="Type a tag and press Enter"
              />
              <p className="text-xs text-muted-foreground">
                Optional labels (topic, role, round…) for filtering the bank.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saveMutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {saveMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {saveMutation.isPending
                ? isEdit
                  ? "Saving…"
                  : "Creating…"
                : isEdit
                  ? "Save changes"
                  : "Create question"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
