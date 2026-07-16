import { useEffect, useState } from "react"
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient
} from "@tanstack/react-query"
import {
  AlertTriangle,
  ArrowRight,
  Loader2,
  Paperclip,
  Search,
  Send,
  X
} from "lucide-react"
import toast from "react-hot-toast"
import axios from "axios"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { Combobox } from "@/components/ui/combobox"
import {
  listInterviewQuestions,
  listQuestionDifficultyOptions,
  listQuestionEnvironmentOptions,
  listQuestionTypeOptions
} from "@/features/interview-questions/interviewQuestionsApi"
import {
  QUESTION_ENVIRONMENT_LABELS,
  formatTypeLabel,
  type InterviewQuestionDifficulty,
  type QuestionEnumOption,
  type QuestionEnvironment
} from "@/features/interview-questions/types"
import { sendTechnicalInvite } from "@/features/applicants/applicantsApi"
import type { TechnicalInviteSummary } from "@/features/applicants/types"

interface SendTechnicalInviteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  applicant: {
    applicationId: string
    name?: string
    email?: string
    technicalInvite?: TechnicalInviteSummary | null
  } | null
}

const apiError = (err: unknown, fallback: string) =>
  axios.isAxiosError(err) &&
  (err.response?.data as { message?: string } | undefined)?.message
    ? (err.response!.data as { message: string }).message
    : fallback

/** The backend refuses a resend while the candidate's attempt is still live
 *  (recent activity within its time window). We detect that specific 400 to
 *  offer a "resend anyway" force, rather than just toasting the error. */
const isLiveAttemptError = (err: unknown) =>
  axios.isAxiosError(err) &&
  err.response?.status === 400 &&
  /currently taking the technical round/i.test(
    (err.response?.data as { message?: string } | undefined)?.message ?? ""
  )

const difficultyVariant: Record<
  InterviewQuestionDifficulty,
  "success" | "warning" | "destructive"
> = {
  easy: "success",
  medium: "warning",
  hard: "destructive"
}

const ALL = "all"
const PAGE_SIZE = 25

/**
 * One picked question, with enough display detail to render the review
 * pipeline. Fresh picks carry everything from the catalog row; resend
 * preselects come from the invite snapshot (no difficulty/timeLimit — those
 * chips simply don't render for them).
 */
interface SelectedQuestion {
  id: string
  environment: string
  name: string
  type: string
  difficultyLevel?: InterviewQuestionDifficulty
  timeLimit?: number
}

/**
 * The review step's pipeline: the picked questions as a numbered vertical
 * timeline, in the exact order the candidate will face them. Questions only —
 * the per-question AI discussions are deliberately not shown.
 */
function InvitePipeline({ questions }: { questions: SelectedQuestion[] }) {
  const totalMin = questions.reduce((sum, q) => sum + (q.timeLimit ?? 0), 0)
  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col">
        {questions.map((q, i) => (
          <li key={q.id} className="relative flex gap-3 pb-5 last:pb-0">
            {/* Connector to the next step */}
            {i < questions.length - 1 ? (
              <span
                aria-hidden
                className="absolute bottom-0 left-4 top-9 w-px -translate-x-1/2 bg-border"
              />
            ) : null}
            <span className="z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-primary bg-background text-sm font-bold text-primary">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
              <p className="truncate text-sm font-medium">
                {q.name || "Untitled question"}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Badge variant="outline">
                  {QUESTION_ENVIRONMENT_LABELS[
                    q.environment as QuestionEnvironment
                  ] ?? q.environment}
                </Badge>
                {q.type ? (
                  <Badge variant="secondary">{formatTypeLabel(q.type)}</Badge>
                ) : null}
                {q.difficultyLevel ? (
                  <Badge
                    variant={difficultyVariant[q.difficultyLevel]}
                    className="capitalize"
                  >
                    {q.difficultyLevel}
                  </Badge>
                ) : null}
                {q.timeLimit ? (
                  <span className="text-xs text-muted-foreground">
                    {q.timeLimit} min
                  </span>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ol>
      <p className="text-xs text-muted-foreground">
        {questions.length} question{questions.length === 1 ? "" : "s"}
        {totalMin > 0 ? ` · ~${totalMin} min total` : ""} — presented to the
        candidate in this order.
      </p>
    </div>
  )
}

/**
 * Pick the questions for a technical-round invite (filtered by environment,
 * type + difficulty via the enum endpoints), review the resulting assessment
 * pipeline, and email the candidate the invite. Mirrors the AI-invite
 * action's mutation + toast posture.
 */
export function SendTechnicalInviteDialog({
  open,
  onOpenChange,
  applicant
}: SendTechnicalInviteDialogProps) {
  const queryClient = useQueryClient()
  const [environmentFilter, setEnvironmentFilter] = useState<string>(ALL)
  const [typeFilter, setTypeFilter] = useState("")
  const [difficulty, setDifficulty] = useState<string>(ALL)
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  // Ordered list of picked questions (with display detail for the review
  // pipeline), shown to the candidate in this order. Tracking `environment`
  // lets us cap NOTEBOOK picks at one — the notebook round's browser workspace
  // is one-per-session, so a second notebook question can't be presented.
  // Code-editor and canvas rounds are per-question scoped, so any number of
  // them may be picked.
  const [selected, setSelected] = useState<SelectedQuestion[]>([])
  const selectedIds = selected.map((s) => s.id)
  const notebookSelected = selected.some((s) => s.environment === "notebook")
  // Total budget of the picked set (resend preselects carry no timeLimit, so
  // they simply don't count — the tray omits the total when it works out to 0).
  const selectedTotalMin = selected.reduce(
    (sum, s) => sum + (s.timeLimit ?? 0),
    0
  )
  // Two-step flow: pick the questions, then review the resulting assessment
  // pipeline before the send actually fires.
  const [step, setStep] = useState<"pick" | "review">("pick")
  // Set when the backend refuses because the attempt is still live — reveals the
  // "resend anyway" force confirmation.
  const [liveBlocked, setLiveBlocked] = useState(false)

  // Already-sent → resend (which is a full reset). The admin still sees the
  // picker, preloaded with the previously-sent questions, and may keep them or
  // swap in a different set — resending always allows changing the questions.
  const sentInvite = applicant?.technicalInvite
  const alreadySent = Boolean(sentInvite?.inviteSentAt)
  const sentQuestions = sentInvite?.questions ?? []
  // Stable key for the sent list so the reset effect doesn't loop on a fresh
  // array identity each render. The backend snapshot now carries `environment`,
  // so preselected sent questions participate in the one-per-environment dedup.
  const sentKey = sentQuestions
    .map((q) => `${q.questionId}:${q.environment ?? ""}`)
    .join(",")

  // Add/remove a question. Only NOTEBOOK is capped at one per invite — its
  // in-browser workspace is one-per-session, so a second notebook question
  // can't be presented. Code-editor and canvas questions may repeat freely.
  // (The backend enforces the same rules.)
  const toggleQuestion = (q: SelectedQuestion) =>
    setSelected((prev) => {
      if (prev.some((s) => s.id === q.id)) {
        return prev.filter((s) => s.id !== q.id)
      }
      if (
        q.environment === "notebook" &&
        prev.some((s) => s.environment === "notebook")
      ) {
        toast.error("You can pick only one Notebook question per invite.")
        return prev
      }
      return [...prev, q]
    })

  // Reset state each time the dialog opens. When an invite was already
  // sent, preselect the previously-sent questions (the only choice).
  useEffect(() => {
    if (!open) return
    setEnvironmentFilter(ALL)
    setTypeFilter("")
    setDifficulty(ALL)
    setSearch("")
    setPage(1)
    // On resend, preselect the previously-sent questions so the admin sees
    // what's currently assigned. The backend snapshot carries `environment`
    // (a previously-sent notebook question correctly holds the one notebook
    // slot) plus name/type for the review pipeline — but not difficulty or
    // time limit, so those chips simply don't render for preselects.
    setSelected(
      alreadySent
        ? sentQuestions.map((q) => ({
            id: q.questionId,
            environment: q.environment ?? "",
            name: q.name ?? "",
            type: q.type ?? ""
          }))
        : []
    )
    setStep("pick")
    setLiveBlocked(false)
  }, [open, alreadySent, sentKey])

  const environmentOptionsQuery = useQuery({
    queryKey: ["questionEnums", "environments"],
    queryFn: listQuestionEnvironmentOptions,
    enabled: open,
    staleTime: Infinity
  })
  const difficultyOptionsQuery = useQuery({
    queryKey: ["questionEnums", "difficulties"],
    queryFn: listQuestionDifficultyOptions,
    enabled: open,
    staleTime: Infinity
  })
  const typeOptionsQuery = useQuery({
    queryKey: ["questionEnums", "types"],
    queryFn: listQuestionTypeOptions,
    enabled: open,
    staleTime: Infinity
  })
  const typeSuggestions: QuestionEnumOption[] = typeOptionsQuery.data ?? []

  const questionsQuery = useQuery({
    queryKey: [
      "techInviteQuestions",
      { environment: environmentFilter, type: typeFilter, difficulty, search, page }
    ],
    queryFn: () =>
      listInterviewQuestions({
        page,
        limit: PAGE_SIZE,
        search: search.trim() || undefined,
        environment:
          environmentFilter !== ALL
            ? (environmentFilter as QuestionEnvironment)
            : undefined,
        type: typeFilter.trim() || undefined,
        difficultyLevel:
          difficulty !== ALL
            ? (difficulty as InterviewQuestionDifficulty)
            : undefined
      }),
    enabled: open,
    placeholderData: keepPreviousData
  })

  const mutation = useMutation({
    mutationFn: (force: boolean) => {
      if (!applicant || selectedIds.length === 0) {
        throw new Error("Pick at least one question first.")
      }
      return sendTechnicalInvite(applicant.applicationId, {
        questionIds: selectedIds,
        force
      })
    },
    onSuccess: () => {
      toast.success(
        alreadySent
          ? "Technical invite re-sent. The candidate should get the email shortly."
          : "Technical invite sent. The candidate should get the email shortly."
      )
      queryClient.invalidateQueries({ queryKey: ["applicants"] })
      // Refresh any open interview-detail drawer (L15): a (re)send resets the
      // candidate's technical round, so its embedded technicalSession is now
      // stale. Invalidate the detail + list queries so the drawer reflects it.
      queryClient.invalidateQueries({ queryKey: ["interview"] })
      queryClient.invalidateQueries({ queryKey: ["interviews"] })
      onOpenChange(false)
    },
    onError: (err) => {
      // Attempt still looks live → don't error out; reveal the force confirm so
      // the admin can override once they've confirmed the candidate is inactive.
      if (isLiveAttemptError(err)) {
        setLiveBlocked(true)
        return
      }
      toast.error(apiError(err, "Could not send technical invite."))
    }
  })

  const rows = questionsQuery.data?.data ?? []
  const total = questionsQuery.data?.count ?? 0
  const nextPage = questionsQuery.data?.nextPage ?? null
  const busy = mutation.isPending

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (busy) return
        onOpenChange(o)
      }}
    >
      {/* Flex column capped at 90vh: header + footer are pinned (shrink-0) and
          only the middle region scrolls, so the action buttons stay visible no
          matter how long the question list / pipeline gets. `flex` overrides
          the dialog box's default `grid` via tailwind-merge. */}
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {step === "review"
              ? "Review assessment pipeline"
              : alreadySent
                ? "Resend technical invite"
                : "Send technical invite"}
          </DialogTitle>
          <DialogDescription>
            {step === "review" ? (
              <>
                This is the exact sequence{" "}
                <strong>{applicant?.email || "the candidate"}</strong> will walk
                through. Confirm to {alreadySent ? "resend" : "send"} the
                invite, or go back to change the questions.
              </>
            ) : alreadySent ? (
              <>
                A technical invite was already sent to{" "}
                <strong>{applicant?.email || "the candidate"}</strong>. Resending
                resets their round — keep the same questions or pick new ones
                below.
              </>
            ) : (
              <>
                Filter the question bank and pick the questions for this
                candidate. They&apos;re shown to{" "}
                <strong>{applicant?.email || "the candidate"}</strong> in the
                order you select them.
              </>
            )}
          </DialogDescription>
          {/* Resend = reset, compressed to a chip; the full consequence text
              lives in the hover tooltip and is repeated as a banner on the
              review step, where the destructive click actually happens. */}
          {alreadySent && step === "pick" ? (
            <span
              title="Resending resets this candidate's technical round. Their previous session — including any in-progress or already-submitted attempt — is cleared, the old link stops working, and they start over from the new email."
              className="mt-1 inline-flex w-fit cursor-help items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-300"
            >
              <AlertTriangle className="h-3 w-3 shrink-0" />
              Resets current round
              {sentInvite?.inviteSentAt
                ? ` · last sent ${new Date(
                    sentInvite.inviteSentAt
                  ).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric"
                  })}`
                : ""}
            </span>
          ) : null}
        </DialogHeader>

        {/* Middle region — header/footer are pinned; in the pick step only the
            question LIST scrolls (it gets all free vertical space), in the
            review step the pipeline scrolls. */}
        <div className="flex min-h-0 flex-1 flex-col">
        {step === "review" ? (
          <div className="flex min-w-0 flex-col gap-4 overflow-y-auto py-2">
            {/* Resend = reset — repeat the warning right where the admin
                confirms, since THIS click is the destructive one. */}
            {alreadySent ? (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
                <strong className="font-semibold">Heads up:</strong> Confirming
                resets this candidate&apos;s technical round — any previous
                attempt is cleared and they start over from the new email.
              </div>
            ) : null}
            <InvitePipeline questions={selected} />
          </div>
        ) : (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 py-2">
          {/* Toolbar — search + compact filters on one row; the dropdowns'
              placeholder text does the labelling. */}
          <div className="flex shrink-0 flex-col gap-2 lg:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
                placeholder="Search question name…"
                className="pl-9"
              />
            </div>
            <div className="grid grid-cols-3 gap-2 lg:flex">
              <Select
                value={environmentFilter}
                onValueChange={(v) => {
                  setEnvironmentFilter(v)
                  setPage(1)
                }}
              >
                <SelectTrigger
                  aria-label="Filter by environment"
                  className="w-full lg:w-40"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All environments</SelectItem>
                  {(environmentOptionsQuery.data ?? []).map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="w-full lg:w-40">
                <Combobox
                  id="ti-type"
                  value={typeFilter}
                  onValueChange={(v) => {
                    setTypeFilter(v.toLowerCase())
                    setPage(1)
                  }}
                  options={typeSuggestions}
                  placeholder="All types"
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
                  className="w-full lg:w-40"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All difficulties</SelectItem>
                  {(difficultyOptionsQuery.data ?? []).map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Selectable question list — the tallest thing in the dialog: it
              takes all the vertical space the pinned chrome doesn't need.
              Vertical scroll only; long names truncate (full name on hover). */}
          <div className="min-h-48 flex-1 overflow-y-auto rounded-lg border border-border">
            {questionsQuery.isLoading ? (
              <p className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading questions…
              </p>
            ) : questionsQuery.isError ? (
              <p className="py-12 text-center text-sm text-destructive">
                Failed to load questions.{" "}
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
                {rows.map((q) => {
                  const order = selectedIds.indexOf(q.id)
                  const isSelected = order >= 0
                  // One-notebook cap: greyed out + unclickable when another
                  // notebook question is already picked. Code-editor and canvas
                  // questions may repeat, so they are never blocked.
                  const blockedByNotebook =
                    !isSelected &&
                    q.environment === "notebook" &&
                    notebookSelected
                  return (
                    <li key={q.id}>
                      <button
                        type="button"
                        onClick={() =>
                          toggleQuestion({
                            id: q.id,
                            environment: q.environment,
                            name: q.name,
                            type: q.type,
                            difficultyLevel: q.difficultyLevel,
                            timeLimit: q.timeLimit
                          })
                        }
                        disabled={blockedByNotebook}
                        title={
                          blockedByNotebook
                            ? "Only one Notebook question per invite"
                            : undefined
                        }
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
                          <span
                            className="block truncate text-sm font-medium"
                            title={q.name}
                          >
                            {q.name}
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-1.5">
                            <Badge variant="outline">
                              {QUESTION_ENVIRONMENT_LABELS[
                                q.environment as QuestionEnvironment
                              ] ?? q.environment}
                            </Badge>
                            {q.type ? (
                              <Badge variant="secondary">
                                {formatTypeLabel(q.type)}
                              </Badge>
                            ) : null}
                            <Badge
                              variant={difficultyVariant[q.difficultyLevel]}
                              className="capitalize"
                            >
                              {q.difficultyLevel}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {q.timeLimit} min
                            </span>
                            {q.fileCount > 0 ? (
                              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                <Paperclip className="h-3 w-3" />
                                {q.fileCount}
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

          {/* Pagination */}
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
                  disabled={!nextPage || questionsQuery.isFetching}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </div>
        )}

        {liveBlocked && step === "review" ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs leading-relaxed text-destructive">
            <strong className="font-semibold">
              This candidate&apos;s attempt still looks active.
            </strong>{" "}
            We won&apos;t interrupt someone who&apos;s mid-assessment. If
            you&apos;ve confirmed they&apos;re no longer taking it (e.g. they
            closed the browser), you can resend anyway — their current attempt
            and all of its recording/files will be permanently discarded.
          </div>
        ) : null}
        </div>
        {/* End scroll region */}

        {/* Selection tray — the picked questions in send order, permanently
            visible regardless of list filters/paging. Chips remove on click;
            the notebook rule lives here as a one-liner instead of a banner
            (the disabled rows' tooltip covers the moment it actually bites). */}
        {step === "pick" && selected.length > 0 ? (
          <div className="shrink-0">
            {/* The picked set as a self-contained card: clear breathing room
                on all four sides so it reads as a distinct "about to send"
                zone, instead of a full-bleed bar jammed against the dialog
                edges. */}
            <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
              {/* Chips are a fixed h-6 and the cap is exactly 3 rows
                  (3×24px + 2×6px gaps = 84px), so the cut-off never slices
                  through a row; beyond 3 rows the tray scrolls internally and
                  a big selection can never crowd out the question list. */}
              <div className="flex max-h-21 flex-wrap content-start items-start gap-1.5 overflow-y-auto">
                {selected.map((s, i) => (
                  <span
                    key={s.id}
                    className="inline-flex h-6 max-w-56 items-center gap-1.5 rounded-md border border-primary/25 bg-primary/5 pl-1 pr-0.5 text-xs shadow-sm"
                  >
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-primary/15 text-[10px] font-semibold tabular-nums text-primary">
                      {i + 1}
                    </span>
                    <span
                      className="truncate text-foreground/90"
                      title={s.name || undefined}
                    >
                      {s.name || "Untitled question"}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleQuestion(s)}
                      aria-label={`Remove ${s.name || "question"}`}
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-primary/20 hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="mt-2.5 flex items-center justify-between gap-2">
                <p className="text-[11px] text-muted-foreground">
                  Sent to the candidate in this order
                  {selectedTotalMin > 0
                    ? ` · ~${selectedTotalMin} min total`
                    : ""}
                  {" · at most one Notebook question per invite"}
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
          {step === "review" ? (
            <>
              <Button
                variant="outline"
                onClick={() => setStep("pick")}
                disabled={busy}
              >
                Back
              </Button>
              {liveBlocked ? (
                <Button
                  variant="destructive"
                  onClick={() => mutation.mutate(true)}
                  disabled={selectedIds.length === 0 || busy}
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  Resend anyway
                </Button>
              ) : (
                <Button
                  onClick={() => mutation.mutate(false)}
                  disabled={selectedIds.length === 0 || busy}
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  {alreadySent ? "Resend invite" : "Send invite"}
                </Button>
              )}
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              {/* The send itself only fires from the review step — this just
                  advances to the pipeline preview. */}
              <Button
                onClick={() => setStep("review")}
                disabled={selectedIds.length === 0}
              >
                Review &amp; send
                {selectedIds.length > 0 ? ` (${selectedIds.length})` : ""}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
