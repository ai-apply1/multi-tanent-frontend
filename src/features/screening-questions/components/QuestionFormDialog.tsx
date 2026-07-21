import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangle,
  Loader2,
  Minus,
  Plus,
  Sparkles,
  Trash2,
  Undo2,
  Volume2
} from "lucide-react"
import toast from "react-hot-toast"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { ErrorBoundary } from "@/components/common/ErrorBoundary"
import { CategoryPicker } from "@/features/question-categories/components/CategoryPicker"
import { TagsInput } from "@/features/screening-questions/components/TagsInput"
import { VariantAudioStatus } from "@/features/screening-questions/components/VariantAudioStatus"
import {
  createScreeningQuestion,
  generateQuestionAudio,
  getScreeningQuestion,
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
  generatingVariants,
  needsAllAudio,
  type DifficultyLevel,
  type QuestionVariant,
  type ScreeningQuestion
} from "@/features/screening-questions/types"
import { errorMessage as apiError } from "@/lib/errors"

/** How often to re-check while a clip is still being generated. */
const AUDIO_POLL_MS = 2000

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
 * The canonical wording (`variants[0]`) is what the top textarea edits — the
 * "question" the operator thinks in. Extra wordings live below as a list of
 * synonyms; the AI drafts them into a local pool, and the operator picks the
 * ones worth keeping before they land in `variants[]`.
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
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [tags, setTags] = useState<string[]>([])
  /** How many drafts to ask for. Fewer may come back — see the suggest call. */
  const [suggestCount, setSuggestCount] = useState(DEFAULT_SUGGEST_COUNT)
  /**
   * Pool of AI-drafted wordings the reviewer hasn't decided on yet — kept
   * separate from `variants[]` so nothing is committed until "Add selected"
   * fires. `sel` is the tick state, keyed by draft index.
   */
  const [drafts, setDrafts] = useState<string[]>([])
  const [draftSel, setDraftSel] = useState<Record<number, boolean>>({})
  // A failed save is shown INLINE on the dialog (and kept until the next
  // attempt) rather than in a toast that pops outside the modal and vanishes —
  // the error belongs where the action that caused it is.
  const [saveError, setSaveError] = useState<string | null>(null)

  const isEdit = Boolean(question)

  // Seed on open; reset to blanks for a fresh create.
  useEffect(() => {
    if (!open) return
    setTouched(false)
    setSaveError(null)
    setVariants(
      // `?? []` is defensive: a malformed row with no `variants` would
      // otherwise throw here on open and blank the whole app. An empty list
      // just falls back to one blank wording below.
      question && Array.isArray(question.variants) && question.variants.length
        ? question.variants.map((v) => ({
            _id: v._id,
            text: v.text,
            retired: v.retired
          }))
        : [{ text: "", retired: false }]
    )
    setDifficulty(question?.difficultyLevel ?? "")
    setCategoryId(question?.categoryId ?? null)
    setTags(question?.tags ?? [])
    setSuggestCount(DEFAULT_SUGGEST_COUNT)
    setDrafts([])
    setDraftSel({})
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
          categoryId: categoryId ?? null,
          tags,
        })
      }
      return createScreeningQuestion({
        // Create has no retired concept: a brand-new question's wordings are
        // all live, and the UI doesn't offer the toggle before first save.
        variants: drafts.map((v) => v.text.trim()),
        difficultyLevel: difficulty,
        ...(categoryId ? { categoryId } : {}),
        tags,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["screeningQuestions"] })
      toast.success(isEdit ? "Question saved." : "Question created.")
      onOpenChange(false)
    },
    onError: (err) =>
      setSaveError(
        apiError(
          err,
          isEdit ? "Could not update question." : "Could not create question."
        )
      )
  })

  /*
   * Live AUDIO state for the saved question.
   *
   * A separate query rather than the `question` prop because generation
   * happens in a worker: the prop is a snapshot from whenever the list last
   * loaded, and the clips land seconds later. Polls only while something is
   * actually generating, so an idle dialog costs one request.
   *
   * Create mode has nothing to poll — the row does not exist yet.
   */
  const audioQuery = useQuery({
    queryKey: ["screeningQuestion", question?._id],
    queryFn: () => getScreeningQuestion(question!._id),
    enabled: open && Boolean(question),
    initialData: question ?? undefined,
    refetchInterval: (q) => {
      const data = q.state.data
      return data && generatingVariants(data).length > 0
        ? AUDIO_POLL_MS
        : false
    }
  })

  /**
   * Server-side wordings by `_id`, so each draft row can find its own audio
   * state. Drafts with no `_id` (unsaved appends) simply miss, which is the
   * correct answer — they have no clip.
   */
  const audioByVariantId = useMemo(() => {
    const map = new Map<string, QuestionVariant>()
    for (const v of audioQuery.data?.variants ?? []) map.set(v._id, v)
    return map
  }, [audioQuery.data])

  const generateMutation = useMutation({
    mutationFn: (variantIds?: string[]) =>
      generateQuestionAudio(question!._id, variantIds),
    onSuccess: (updated) => {
      // The response already carries the "generating" stamps, so writing it
      // straight into the cache re-arms the poll immediately instead of
      // waiting a refetch to notice work started.
      queryClient.setQueryData(["screeningQuestion", updated._id], updated)
      queryClient.invalidateQueries({ queryKey: ["screeningQuestions"] })
      toast.success("Generating voice audio…")
    },
    onError: (err) =>
      toast.error(apiError(err, "Could not start audio generation."))
  })

  /** Which draft row is mid-request, so only that one shows a spinner. */
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const retryAudio = (variantId: string) => {
    setRetryingId(variantId)
    generateMutation.mutate([variantId], {
      onSettled: () => setRetryingId(null)
    })
  }

  const showGenerateAll =
    isEdit && audioQuery.data ? needsAllAudio(audioQuery.data) : false
  const audioGenerating = audioQuery.data
    ? generatingVariants(audioQuery.data).length
    : 0

  const room = QUESTION_VARIANTS_MAX - variants.length

  // Two independent ceilings: what one suggest call may return, and how many
  // wordings this question can still hold. Offering a number the save would
  // then refuse is worse than a short menu.
  const maxSuggest = Math.min(VARIANT_SUGGEST_MAX, Math.max(room, 0))
  // Clamp for DISPLAY too, not just on send: a picked 5 that silently becomes
  // 2 because rows were added afterwards would look like the AI ignored them.
  const askFor = Math.min(
    Math.max(suggestCount, VARIANT_SUGGEST_MIN),
    Math.max(maxSuggest, VARIANT_SUGGEST_MIN)
  )

  const suggestMutation = useMutation({
    mutationFn: () =>
      suggestQuestionVariants({
        sourceText: variants[0]?.text.trim() ?? "",
        ...(difficulty ? { difficultyLevel: difficulty } : {}),
        count: askFor
      }),
    onSuccess: (fresh) => {
      // Guard the shape: the endpoint is documented as `string[]`, but an
      // unexpected body (e.g. an error envelope that slipped through as 200)
      // would throw on `.filter` below and, unhandled, blank the app.
      const list = Array.isArray(fresh) ? fresh : []
      // Dedupe against wordings already committed AND against drafts already
      // sitting in the pool — the server hasn't seen either.
      const seen = new Set([
        ...variants.map((v) => normalize(v.text)),
        ...drafts.map(normalize)
      ])
      const kept = list
        .filter((text) => typeof text === "string" && !seen.has(normalize(text)))
        .slice(0, room)
      if (kept.length === 0) {
        toast("No new wordings came back — try rephrasing the original.")
        return
      }
      setDrafts(kept)
      setDraftSel({})
      toast.success(
        `Drafted ${kept.length} wording${kept.length === 1 ? "" : "s"} — pick the ones worth keeping.`
      )
    },
    onError: (err) => toast.error(apiError(err, "Could not draft variants."))
  })

  const acceptSelectedDrafts = () => {
    const picked = drafts.filter((_, i) => draftSel[i])
    if (picked.length === 0) {
      toast("Tick at least one wording to add.")
      return
    }
    setVariants((prev) => [
      ...prev,
      ...picked.slice(0, room).map((text) => ({ text, retired: false }))
    ])
    setDrafts([])
    setDraftSel({})
    toast.success(
      `Added ${picked.length} wording${picked.length === 1 ? "" : "s"}.`
    )
  }

  const extras = variants.slice(1)
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
    // Drop a stale failure line before the retry — it may well succeed now.
    setSaveError(null)
    saveMutation.mutate(variants)
  }

  const questionText = variants[0]?.text ?? ""

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && saveMutation.isPending) return
        onOpenChange(next)
      }}
    >
      <DialogContent
        hideCloseButton
        className="max-w-[580px] gap-0 border-line bg-surface p-0 sm:max-w-[580px]"
      >
        <form onSubmit={handleSubmit} className="flex flex-col">
          {/* Head */}
          <div className="flex items-start justify-between gap-4 px-6 pt-[22px] pb-[14px]">
            <div>
              <h3 className="text-[18px] font-semibold text-ink">
                {isEdit ? "Edit question" : "Add question"}
              </h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
                Jobs draw their screening questions from this bank. Editing the
                wording here never changes a job that already uses the question.
              </p>
            </div>
            <button
              type="button"
              onClick={() => !saveMutation.isPending && onOpenChange(false)}
              className="inline-flex text-ink-muted hover:text-ink"
              aria-label="Close"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.7}
                strokeLinecap="round"
              >
                <path d="M5 5l10 10M15 5 5 15" />
              </svg>
            </button>
          </div>

          {/* Body + foot are wrapped so a crash inside the form (a bad
              response, an unexpected shape) degrades to a recoverable message
              instead of tearing down the whole app. `resetKeys` clears it when
              the dialog reopens, so a past crash never sticks. */}
          <ErrorBoundary
            resetKeys={[open, question?._id]}
            fallback={(reset) => (
              <div className="px-6 py-12 text-center">
                <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-[var(--danger-soft)] text-[var(--danger)]">
                  <AlertTriangle className="h-5 w-5" strokeWidth={1.8} />
                </div>
                <p className="text-[14px] font-semibold text-ink">
                  Something went wrong
                </p>
                <p className="mx-auto mt-1.5 max-w-[360px] text-[13px] text-ink-muted">
                  This form hit an unexpected error. Nothing was saved — try
                  again, or close and reopen the dialog.
                </p>
                <div className="mt-4 flex justify-center gap-2.5">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => onOpenChange(false)}
                  >
                    Close
                  </Button>
                  <Button type="button" size="sm" onClick={reset}>
                    Try again
                  </Button>
                </div>
              </div>
            )}
          >
          {/* Body */}
          <div className="scroll grid max-h-[70vh] gap-4 overflow-y-auto px-6 pb-5">
            {/* Question textarea */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label
                  htmlFor="q-canonical"
                  className="text-[13px] font-semibold text-ink"
                >
                  Question
                </label>
                <div className="flex items-center gap-3">
                  {isEdit && variants[0]?._id ? (
                    <VariantAudioStatus
                      variant={audioByVariantId.get(variants[0]._id)}
                      retired={variants[0].retired}
                      busy={retryingId === variants[0]._id}
                      onRetry={() => retryAudio(variants[0]._id!)}
                    />
                  ) : null}
                  <span className="text-[12px] text-ink-subtle tabular-nums">
                    {questionText.length}/{QUESTION_TEXT_MAX_LENGTH}
                  </span>
                </div>
              </div>
              <textarea
                id="q-canonical"
                value={questionText}
                rows={3}
                maxLength={QUESTION_TEXT_MAX_LENGTH}
                placeholder="Walk me through how you would design a rate limiter for a public API."
                onChange={(e) => {
                  setTouched(true)
                  patch(0, { text: e.target.value })
                }}
                aria-invalid={touched && originalEmpty}
                className="scroll w-full resize-y rounded-lg border border-[var(--field-border)] bg-surface px-3.5 py-3 text-[14px] text-ink outline-none placeholder:text-ink-subtle focus:border-primary focus:shadow-[0_0_0_3px_var(--accent-ring)]"
              />
              <p className="mt-1.5 text-[12px] text-ink-muted">
                The canonical wording. Each interview asks an AI-paraphrased
                variant of it.
              </p>
            </div>

            {/* Existing extra wordings (edit mode) — kept minimal so retire is
                available without dominating the dialog. */}
            {extras.length > 0 ? (
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-ink">
                    Additional wordings{" "}
                    <span className="font-normal text-ink-subtle">
                      · {extras.length}/{QUESTION_VARIANTS_MAX - 1}
                    </span>
                  </span>
                </div>
                <div className="grid gap-2">
                  {extras.map((v, idx) => {
                    const i = idx + 1
                    return (
                      <div
                        key={v._id ?? `extra-${i}`}
                        className={`flex items-start gap-2 rounded-lg border border-line px-3 py-2.5 ${
                          v.retired ? "bg-surface-2" : "bg-surface"
                        }`}
                      >
                        <AutoGrowTextarea
                          value={v.text}
                          maxLength={QUESTION_TEXT_MAX_LENGTH}
                          disabled={v.retired}
                          onChange={(e) => {
                            setTouched(true)
                            patch(i, { text: e.target.value })
                          }}
                          aria-invalid={touched && v.text.trim().length === 0}
                          className="scroll min-h-9 flex-1 resize-none rounded-md border-none bg-transparent px-0 py-1 text-[13px] leading-snug text-ink outline-none disabled:text-ink-muted"
                        />
                        <div className="flex items-center gap-1">
                          {isEdit ? (
                            <VariantAudioStatus
                              variant={
                                v._id ? audioByVariantId.get(v._id) : undefined
                              }
                              retired={v.retired}
                              busy={retryingId === v._id}
                              onRetry={() => v._id && retryAudio(v._id)}
                            />
                          ) : null}
                          {v._id ? (
                            <button
                              type="button"
                              onClick={() =>
                                patch(i, { retired: !v.retired })
                              }
                              disabled={saveMutation.isPending}
                              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-semibold text-ink-muted hover:bg-surface-3"
                            >
                              {v.retired ? (
                                <>
                                  <Undo2
                                    className="h-3.5 w-3.5"
                                    strokeWidth={1.8}
                                  />
                                  Restore
                                </>
                              ) : (
                                "Retire"
                              )}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                setVariants((prev) =>
                                  prev.filter((_, j) => j !== i)
                                )
                              }
                              disabled={saveMutation.isPending}
                              aria-label={`Delete wording ${i + 1}`}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--danger)] hover:bg-[var(--danger-soft)]"
                            >
                              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : null}

            {/* Inline validation */}
            {touched && anyEmpty ? (
              <p className="-mt-2 text-[12px] text-[var(--danger)]">
                Every wording needs text. Delete the ones you don't want.
              </p>
            ) : null}
            {duplicate ? (
              <p className="-mt-2 text-[12px] text-[var(--danger)]">
                Two wordings are identical. Duplicates double one wording's odds
                of being picked while looking like variety.
              </p>
            ) : null}
            {allRetired ? (
              <p className="-mt-2 text-[12px] text-[var(--danger)]">
                At least one wording must stay askable — a question with nothing
                to ask can't be served to a candidate.
              </p>
            ) : null}

            {/* Category + Difficulty — 2-col row per the DevExcel design. */}
            <div className="grid gap-3.5 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-[13px] font-semibold text-ink">
                  Category{" "}
                  <span className="font-normal text-ink-subtle">· optional</span>
                </label>
                <CategoryPicker
                  value={categoryId}
                  onChange={(id) => setCategoryId(id)}
                  disabled={saveMutation.isPending}
                />
              </div>

              <div>
                <label className="mb-1.5 block text-[13px] font-semibold text-ink">
                  Difficulty{" "}
                  <span className="font-normal text-ink-subtle">
                    · required
                  </span>
                </label>
                <div className="flex gap-2">
                  {DIFFICULTY_LEVELS.map((d) => {
                    const active = difficulty === d
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setDifficulty(d)}
                        className={`flex-1 rounded-lg border py-2.5 text-[13px] font-semibold transition-colors ${
                          active
                            ? "border-primary bg-accent text-primary"
                            : "border-line-2 bg-surface text-ink-2 hover:bg-surface-3"
                        }`}
                      >
                        {DIFFICULTY_LABELS[d]}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Tags */}
            <div>
              <label
                htmlFor="q-tags"
                className="mb-1.5 block text-[13px] font-semibold text-ink"
              >
                Tags{" "}
                <span className="font-normal text-ink-subtle">· optional</span>
              </label>
              <TagsInput
                id="q-tags"
                value={tags}
                onChange={setTags}
                suggestions={tagSuggestions}
                placeholder="Type a tag and press Enter"
              />
            </div>

            {/* Generate synonyms */}
            <div className="rounded-xl border border-line bg-surface-2 p-4">
              <div className="mb-1 flex items-center gap-2">
                <span className="inline-flex text-primary">
                  <Sparkles className="h-[13px] w-[13px]" strokeWidth={1.8} />
                </span>
                <span className="text-[13.5px] font-semibold text-ink">
                  Generate synonyms
                </span>
              </div>
              <p className="mb-3 text-[12px] text-ink-muted">
                Create reworded variants of this question. Pick the ones you
                like and add them to the bank.
              </p>

              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-[13px] text-ink-2">How many?</span>
                <div className="flex h-10 items-center overflow-hidden rounded-lg border border-[var(--field-border)]">
                  <button
                    type="button"
                    onClick={() =>
                      setSuggestCount((n) =>
                        Math.max(VARIANT_SUGGEST_MIN, n - 1)
                      )
                    }
                    disabled={
                      askFor <= VARIANT_SUGGEST_MIN ||
                      suggestMutation.isPending ||
                      saveMutation.isPending
                    }
                    aria-label="Fewer wordings"
                    className="h-full w-[38px] cursor-pointer border-x border-line bg-surface-3 text-[16px] text-ink disabled:opacity-40"
                  >
                    <Minus
                      className="mx-auto h-4 w-4"
                      strokeWidth={2}
                    />
                  </button>
                  <input
                    value={askFor}
                    readOnly
                    className="mono h-full w-[44px] border-none bg-transparent text-center text-[14px] font-semibold text-ink outline-none"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setSuggestCount((n) => Math.min(maxSuggest, n + 1))
                    }
                    disabled={
                      askFor >= maxSuggest ||
                      suggestMutation.isPending ||
                      saveMutation.isPending
                    }
                    aria-label="More wordings"
                    className="h-full w-[38px] cursor-pointer border-x border-line bg-surface-3 text-[16px] text-ink disabled:opacity-40"
                  >
                    <Plus className="mx-auto h-4 w-4" strokeWidth={2} />
                  </button>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={drafts.length > 0 ? "secondary" : "default"}
                  disabled={
                    originalEmpty ||
                    room <= 0 ||
                    suggestMutation.isPending ||
                    saveMutation.isPending
                  }
                  onClick={() => suggestMutation.mutate()}
                  title={
                    originalEmpty
                      ? "Write the original wording first"
                      : "Draft alternatives with AI — nothing is saved until you press Add selected variants"
                  }
                >
                  {suggestMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {suggestMutation.isPending
                    ? "Drafting…"
                    : drafts.length > 0
                      ? "Regenerate"
                      : "Generate"}
                </Button>
                {room <= 0 ? (
                  <span className="text-[12px] text-ink-muted">
                    Limit of {QUESTION_VARIANTS_MAX} wordings reached.
                  </span>
                ) : null}
              </div>

              {drafts.length > 0 ? (
                <>
                  <div className="mt-3 grid gap-2">
                    {drafts.map((s, i) => {
                      const selected = !!draftSel[i]
                      return (
                        <label
                          key={`${i}-${s.slice(0, 12)}`}
                          className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 text-[13px] transition-colors ${
                            selected
                              ? "border-primary bg-accent"
                              : "border-line bg-surface hover:bg-surface-3"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() =>
                              setDraftSel((prev) => ({
                                ...prev,
                                [i]: !prev[i]
                              }))
                            }
                            className="mt-0.5 h-4 w-4 accent-primary"
                          />
                          <span className="flex-1 leading-relaxed text-ink">
                            {s}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                  <div className="mt-3">
                    <Button
                      type="button"
                      size="sm"
                      onClick={acceptSelectedDrafts}
                      disabled={saveMutation.isPending}
                    >
                      <Plus className="h-4 w-4" />
                      Add selected variants
                    </Button>
                  </div>
                </>
              ) : null}
            </div>
          </div>

          {/* Foot */}
          <div className="border-t border-line px-6 py-4">
            {saveError ? (
              <div className="mb-3 flex items-start gap-2 rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-[12.5px] text-[var(--danger)]">
                <AlertTriangle
                  className="mt-[1px] h-3.5 w-3.5 flex-shrink-0"
                  strokeWidth={1.9}
                />
                <span>{saveError}</span>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center justify-end gap-2.5">
              {/* Only when NOTHING is generated — a question with some clips
                  shows per-wording retries instead, so this never re-queues
                  work that already succeeded. */}
              {showGenerateAll ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="mr-auto"
                  disabled={generateMutation.isPending || audioGenerating > 0}
                  onClick={() => generateMutation.mutate(undefined)}
                  title="Generate the voice clip for the question and every synonym."
                >
                  {generateMutation.isPending || audioGenerating > 0 ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Volume2 className="h-4 w-4" />
                  )}
                  {audioGenerating > 0
                    ? "Generating audio…"
                    : "Generate all audio"}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={saveMutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!canSubmit}>
                {saveMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                {saveMutation.isPending
                  ? isEdit
                    ? "Saving…"
                    : "Creating…"
                  : isEdit
                    ? "Save question"
                    : "Create question"}
              </Button>
            </div>
          </div>
          </ErrorBoundary>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * A textarea that grows with its content up to `maxHeight`, then scrolls.
 *
 * The additional-wording rows were a fixed one-row box, so anything past the
 * first line was trapped behind a cramped internal scrollbar (the "weird
 * scroll") and wrapped text read as clipped. Sizing to `scrollHeight` on every
 * value change shows the whole wording; the `maxHeight` cap stops one very long
 * wording from swallowing the dialog — past it, the box scrolls instead of
 * growing forever. `resize-none` is expected on these (height is managed here).
 */
function AutoGrowTextarea({
  value,
  maxHeight = 160,
  className,
  ...props
}: React.ComponentPropsWithoutRef<"textarea"> & { maxHeight?: number }) {
  const ref = useRef<HTMLTextAreaElement | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // Reset to `auto` first so a delete is measured too, not just growth —
    // scrollHeight never reports smaller than the element's current height.
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden"
  }, [value, maxHeight])

  return <textarea ref={ref} value={value} className={className} {...props} />
}
