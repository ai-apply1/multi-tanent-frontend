import { useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2, Plus, Save, Sparkles, Trash2, Undo2 } from "lucide-react"
import toast from "react-hot-toast"
import { Badge } from "@/components/ui/badge"
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
  suggestQuestionVariants,
  updateScreeningQuestion
} from "@/features/screening-questions/screeningQuestionsApi"
import {
  DIFFICULTY_LABELS,
  DIFFICULTY_LEVELS,
  QUESTION_TEXT_MAX_LENGTH,
  QUESTION_VARIANTS_MAX,
  VARIANT_SUGGEST_MAX,
  VARIANT_SUGGEST_MIN,
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
 * One wording being edited. `_id` is the load-bearing bit: it marks a
 * wording the server already knows, which therefore can be edited or
 * retired but NEVER removed or moved (an interview references it by id).
 * A draft without an `_id` has never been served to anyone, so it can be
 * deleted freely — nothing points at it yet.
 */
interface VariantDraft {
  _id?: string
  text: string
  retired: boolean
}

/** Case/space-insensitive — the only difference a candidate would notice. */
const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim()

/** Enough to choose from without burying the reviewer on the first click. */
const DEFAULT_SUGGEST_COUNT = 3

/**
 * Create / edit one bank question and all of its wordings.
 *
 * The list row IS the full record, so there's no detail fetch — everything
 * the form edits comes straight off the row and saves in one request.
 *
 * Variants are what make two candidates for the same job hear different
 * words, so the editor's whole job is to keep them synonyms: same meaning,
 * same difficulty. The AI drafts them; a human approves them.
 */
export function QuestionFormDialog({
  open,
  onOpenChange,
  question,
  tagSuggestions = []
}: QuestionFormDialogProps) {
  const queryClient = useQueryClient()

  const [variants, setVariants] = useState<VariantDraft[]>([
    { text: "", retired: false }
  ])
  // Only red once the field has been interacted with — a fresh dialog
  // shouldn't open covered in errors.
  const [touched, setTouched] = useState(false)
  // "" = nothing picked. Deliberately NOT seeded with a band on create: the
  // backend DTO has no default, so a pre-selected value would silently
  // choose for the user (and the schema default only applies to writes the
  // DTO never lets through).
  const [difficulty, setDifficulty] = useState<DifficultyLevel | "">("")
  const [tags, setTags] = useState<string[]>([])
  /** How many drafts to ask for. Fewer may come back — see the suggest call. */
  const [suggestCount, setSuggestCount] = useState(DEFAULT_SUGGEST_COUNT)

  const isEdit = Boolean(question)

  // Seed on open; reset to blanks for a fresh create.
  useEffect(() => {
    if (!open) return
    setTouched(false)
    setVariants(
      question
        ? question.variants.map((v) => ({
            _id: v._id,
            text: v.text,
            retired: v.retired
          }))
        : [{ text: "", retired: false }]
    )
    setDifficulty(question?.difficultyLevel ?? "")
    setTags(question?.tags ?? [])
    setSuggestCount(DEFAULT_SUGGEST_COUNT)
  }, [open, question])

  const patch = (index: number, next: Partial<VariantDraft>) =>
    setVariants((prev) =>
      prev.map((v, i) => (i === index ? { ...v, ...next } : v))
    )

  const saveMutation = useMutation({
    mutationFn: (drafts: VariantDraft[]) => {
      if (!difficulty) throw new Error("difficulty is required")
      if (question) {
        return updateScreeningQuestion(question._id, {
          // Order and every existing _id are preserved — the backend 422s
          // otherwise, and this array IS that order.
          variants: drafts.map((v) => ({
            ...(v._id ? { _id: v._id } : {}),
            text: v.text.trim(),
            retired: v.retired
          })),
          difficultyLevel: difficulty,
          tags
        })
      }
      return createScreeningQuestion({
        // Create has no retired concept: a brand-new question's wordings are
        // all live, and the UI doesn't offer the toggle before first save.
        variants: drafts.map((v) => v.text.trim()),
        difficultyLevel: difficulty,
        tags
      })
    },
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

  const room = QUESTION_VARIANTS_MAX - variants.length

  // Two independent ceilings: what one suggest call may return, and how many
  // wordings this question can still hold. Offering a number the save would
  // then refuse is worse than a short menu.
  const maxSuggest = Math.min(VARIANT_SUGGEST_MAX, Math.max(room, 0))
  // Clamp for DISPLAY too, not just on send: a picked 5 that silently becomes
  // 2 because rows were added afterwards would look like the AI ignored them.
  const askFor = Math.min(Math.max(suggestCount, VARIANT_SUGGEST_MIN), maxSuggest)

  const suggestMutation = useMutation({
    mutationFn: () =>
      suggestQuestionVariants({
        sourceText: variants[0]?.text.trim() ?? "",
        ...(difficulty ? { difficultyLevel: difficulty } : {}),
        count: askFor
      }),
    onSuccess: (drafts) => {
      // The server already drops drafts that echo the source, but it has
      // never seen the wordings sitting unsaved in this dialog — dedupe
      // against what's actually on screen.
      const seen = new Set(variants.map((v) => normalize(v.text)))
      const fresh = drafts
        .filter((text) => !seen.has(normalize(text)))
        .slice(0, room)
      if (fresh.length === 0) {
        toast("No new wordings came back — try rephrasing the original.")
        return
      }
      setVariants((prev) => [
        ...prev,
        ...fresh.map((text) => ({ text, retired: false }))
      ])
      toast.success(
        `Added ${fresh.length} draft${fresh.length === 1 ? "" : "s"} — edit or delete any that miss the mark.`
      )
    },
    onError: (err) => toast.error(apiError(err, "Could not draft variants."))
  })

  const filled = variants.filter((v) => v.text.trim().length > 0)
  const anyEmpty = variants.some((v) => v.text.trim().length === 0)
  const originalEmpty = (variants[0]?.text.trim().length ?? 0) === 0
  const allRetired = variants.length > 0 && variants.every((v) => v.retired)
  // Mirrors the backend's 422 so the user learns before a round-trip.
  const duplicate =
    new Set(filled.filter((v) => !v.retired).map((v) => normalize(v.text)))
      .size !== filled.filter((v) => !v.retired).length

  const canSubmit =
    !anyEmpty &&
    !duplicate &&
    !allRetired &&
    difficulty !== "" &&
    !saveMutation.isPending

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (!canSubmit) return
    saveMutation.mutate(variants)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && saveMutation.isPending) return
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {isEdit ? "Edit question" : "Add question"}
            </DialogTitle>
            <DialogDescription>
              Jobs draw their screening questions from this bank. Each
              candidate is asked ONE of the wordings below, picked at random —
              so they must all ask the same thing in different words.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-5 py-4">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <Label>Wordings</Label>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {variants.filter((v) => !v.retired).length} askable ·{" "}
                  {variants.length}/{QUESTION_VARIANTS_MAX}
                </span>
              </div>

              {variants.map((v, i) => (
                <div
                  key={v._id ?? `draft-${i}`}
                  className={cn(
                    "flex flex-col gap-2 rounded-md border p-3",
                    v.retired && "bg-muted/40"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium">
                        {i === 0 ? "Original" : `Wording ${i + 1}`}
                      </span>
                      {v.retired && (
                        <Badge variant="secondary" className="text-[10px]">
                          Retired
                        </Badge>
                      )}
                      {!v._id && isEdit && (
                        <Badge variant="outline" className="text-[10px]">
                          New
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      {/* An existing wording can only be retired — some
                          interview may reference it by id. An unsaved draft
                          has no id yet, so it can just go. */}
                      {v._id ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          disabled={saveMutation.isPending}
                          onClick={() => patch(i, { retired: !v.retired })}
                        >
                          {v.retired ? (
                            <>
                              <Undo2 className="h-3.5 w-3.5" />
                              Restore
                            </>
                          ) : (
                            "Retire"
                          )}
                        </Button>
                      ) : (
                        variants.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-destructive"
                            aria-label={`Delete wording ${i + 1}`}
                            disabled={saveMutation.isPending}
                            onClick={() =>
                              setVariants((prev) =>
                                prev.filter((_, j) => j !== i)
                              )
                            }
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )
                      )}
                    </div>
                  </div>

                  <Textarea
                    value={v.text}
                    onChange={(e) => {
                      setTouched(true)
                      patch(i, { text: e.target.value })
                    }}
                    rows={i === 0 ? 4 : 3}
                    maxLength={QUESTION_TEXT_MAX_LENGTH}
                    placeholder={
                      i === 0
                        ? "Walk me through how you would design a rate limiter for a public API."
                        : "Another way of asking exactly the same thing."
                    }
                    autoFocus={i === 0}
                    disabled={v.retired}
                    aria-label={i === 0 ? "Original wording" : `Wording ${i + 1}`}
                    aria-invalid={touched && v.text.trim().length === 0}
                  />
                </div>
              ))}

              {touched && anyEmpty && (
                <p className="text-xs text-destructive">
                  Every wording needs text. Delete the ones you don't want.
                </p>
              )}
              {duplicate && (
                <p className="text-xs text-destructive">
                  Two wordings are identical. Duplicates double one wording's
                  odds of being picked while looking like variety.
                </p>
              )}
              {allRetired && (
                <p className="text-xs text-destructive">
                  At least one wording must stay askable — a question with
                  nothing to ask can't be served to a candidate.
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={room <= 0 || saveMutation.isPending}
                  onClick={() =>
                    setVariants((prev) => [...prev, { text: "", retired: false }])
                  }
                >
                  <Plus className="h-4 w-4" />
                  Add wording
                </Button>
                <div className="flex items-center gap-1.5">
                  <Select
                    value={String(askFor)}
                    onValueChange={(v) => setSuggestCount(Number(v))}
                    disabled={
                      room <= 0 ||
                      suggestMutation.isPending ||
                      saveMutation.isPending
                    }
                  >
                    <SelectTrigger
                      className="h-8 w-[4.25rem]"
                      aria-label="How many wordings to draft"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: maxSuggest }, (_, i) => i + 1).map(
                        (n) => (
                          <SelectItem key={n} value={String(n)}>
                            {n}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={
                      originalEmpty ||
                      room <= 0 ||
                      suggestMutation.isPending ||
                      saveMutation.isPending
                    }
                    title={
                      originalEmpty
                        ? "Write the original wording first"
                        : "Draft alternatives with AI — nothing is saved until you do"
                    }
                    onClick={() => suggestMutation.mutate()}
                  >
                    {suggestMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                    {suggestMutation.isPending
                      ? "Drafting…"
                      : `Suggest ${askFor === 1 ? "a wording" : `${askFor} wordings`} with AI`}
                  </Button>
                </div>
                {room <= 0 && (
                  <span className="text-xs text-muted-foreground">
                    Limit of {QUESTION_VARIANTS_MAX} wordings reached.
                  </span>
                )}
              </div>

              <p className="text-xs text-muted-foreground">
                {isEdit
                  ? "Editing a wording changes what future interviews ask. Interviews already asked keep the exact words they used — which is why a wording is retired, never deleted."
                  : "Add a few wordings so candidates for the same job don't all get identical questions."}{" "}
                AI drafts are proposals: you may get fewer than you asked for
                (any that drift in meaning or length are dropped), and nothing
                is saved until you press {isEdit ? "Save changes" : "Create question"}.
              </p>
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
                Required — there is no default band. Every wording shares it: a
                variant that changes the difficulty is a different question.
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
