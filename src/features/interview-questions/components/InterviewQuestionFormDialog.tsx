import { useEffect, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Download,
  FileText,
  Loader2,
  Maximize2,
  Save,
  Upload,
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
import { Combobox } from "@/components/ui/combobox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Markdown } from "@/components/Markdown"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import {
  completeInterviewQuestionUpload,
  createInterviewQuestion,
  getInterviewQuestion,
  initInterviewQuestionUpload,
  listQuestionDifficultyOptions,
  listQuestionEnvironmentOptions,
  listQuestionTypeOptions,
  removeInterviewQuestionFile,
  updateInterviewQuestion,
  uploadToPresignedUrl
} from "@/features/interview-questions/interviewQuestionsApi"
import { ATTACHMENT_RULES } from "@/features/interview-questions/attachmentRules"
import {
  CODE_WEIGHT_PCT_DEFAULTS,
  CODE_WEIGHT_PCT_MAX,
  CODE_WEIGHT_PCT_MIN,
  CODE_WEIGHT_PCT_PRESETS,
  FOLLOWUP_COUNT_DEFAULT,
  FOLLOWUP_COUNT_MAX,
  FOLLOWUP_COUNT_MIN,
  QUESTION_DIFFICULTIES,
  QUESTION_ENVIRONMENTS,
  QUESTION_ENVIRONMENT_LABELS,
  type InterviewQuestion,
  type InterviewQuestionDifficulty,
  type InterviewQuestionFileView,
  type InterviewQuestionListItem,
  type QuestionEnvironment,
  type QuestionEnumOption
} from "@/features/interview-questions/types"

/**
 * Suggested time budget (minutes) per difficulty. Used to prefill the
 * time-limit field on create; the admin can still override it.
 */
const DIFFICULTY_TIME_LIMITS: Record<InterviewQuestionDifficulty, number> = {
  easy: 30,
  medium: 45,
  hard: 60
}


/** Humanize a fallback enum value, e.g. "easy" -> "Easy". */
const humanize = (value: string) =>
  value
    .split(/[_-]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")

interface InterviewQuestionFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Pass an existing question row to edit it; omit/null to create a new one. */
  question?: InterviewQuestionListItem | null
}

const apiError = (err: unknown, fallback: string) =>
  axios.isAxiosError(err) && (err.response?.data as { message?: string } | undefined)?.message
    ? (err.response!.data as { message: string }).message
    : fallback

const formatBytes = (bytes: number) => {
  if (!bytes) return "—"
  const units = ["B", "KB", "MB", "GB"]
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`
}

/** One file row in the form — the detail file shape (purpose is edited locally). */
type FileRow = InterviewQuestionFileView

/**
 * Create / edit dialog for an interview question.
 *
 * The backend attaches files per-question (it needs a saved id), so the
 * flow is create-then-attach: save the core fields first, then the file
 * section unlocks. Each file goes straight from the browser to S3 via a
 * presigned PUT (pick → init → PUT → complete) and uploads/removals hit
 * the server immediately. Per-file "purpose" notes are edited inline and
 * persisted into the `metaData` map on "Save changes".
 */
export function InterviewQuestionFormDialog({
  open,
  onOpenChange,
  question
}: InterviewQuestionFormDialogProps) {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // The question id we operate against: the edited row, or the id minted
  // after a successful create. `null` means "core fields not saved yet".
  const [activeId, setActiveId] = useState<string | null>(question?.id ?? null)

  // Behaviour driver (closed enum) + free-form topic label. Environment
  // decides the editor and which attachment rules apply; type is a display
  // tag the admin can type anything into.
  const [environment, setEnvironment] = useState<QuestionEnvironment>("notebook")
  const [type, setType] = useState<string>("")
  // Only show the "topic required" error once the field has been interacted
  // with — a fresh dialog shouldn't open covered in red.
  const [typeTouched, setTypeTouched] = useState(false)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  // Description supports markdown; toggle between the raw editor and a live
  // preview rendered with the SAME pipeline the candidate SPA uses.
  const [descTab, setDescTab] = useState<"write" | "preview">("write")
  // Expand the description into a large split-pane dialog (raw editor + live
  // preview). Shares the same `description` state, so nothing needs syncing.
  const [descExpanded, setDescExpanded] = useState(false)
  const [difficulty, setDifficulty] = useState<InterviewQuestionDifficulty>("easy")
  const [timeLimit, setTimeLimit] = useState("")
  const [followupCount, setFollowupCount] = useState(String(FOLLOWUP_COUNT_DEFAULT))
  // Scoring rubric: % of Technical Depth from the submitted code; the rest
  // (100 − pct) comes from the spoken follow-up answers. Kept as a number —
  // the slider/presets can't produce free text. Default depends on the
  // selected environment (canvas 50/50, others 20/80).
  const [codeWeightPct, setCodeWeightPct] = useState(
    CODE_WEIGHT_PCT_DEFAULTS.notebook
  )
  const [files, setFiles] = useState<FileRow[]>([])
  const [uploadPct, setUploadPct] = useState<number | null>(null)

  const isEdit = Boolean(question)

  // When editing, fetch the full detail (the list row carries no files /
  // presigned URLs). Disabled for fresh creates until an id exists.
  const detailQuery = useQuery({
    queryKey: ["interviewQuestion", question?.id],
    queryFn: () => getInterviewQuestion(question!.id),
    enabled: open && Boolean(question?.id)
  })

  // Dropdown options come from the backend enum endpoints so new enum
  // values surface automatically; static arrays are the offline fallback.
  // Free-form topic suggestions (autocomplete) — distinct labels already used.
  const typeOptionsQuery = useQuery({
    queryKey: ["questionEnums", "types"],
    queryFn: listQuestionTypeOptions,
    enabled: open,
    staleTime: Infinity
  })
  // Fixed environment enum (behaviour driver).
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

  const environmentOptions: QuestionEnumOption[] =
    environmentOptionsQuery.data ??
    QUESTION_ENVIRONMENTS.map((e) => ({
      value: e,
      label: QUESTION_ENVIRONMENT_LABELS[e]
    }))
  const typeSuggestions: QuestionEnumOption[] = typeOptionsQuery.data ?? []
  const difficultyOptions: QuestionEnumOption[] =
    difficultyOptionsQuery.data ??
    QUESTION_DIFFICULTIES.map((d) => ({ value: d, label: humanize(d) }))

  // Seed the form when opening: core fields immediately from the list row
  // (avoids a flash), files once the detail fetch resolves. Reset to blanks
  // for a fresh create.
  useEffect(() => {
    if (!open) return
    setDescTab("write")
    setDescExpanded(false)
    setTypeTouched(false)
    if (question) {
      setActiveId(question.id)
      setEnvironment(question.environment ?? "notebook")
      setType(question.type ?? "")
      setName(question.name)
      setDescription(question.description ?? "")
      setDifficulty(question.difficultyLevel)
      setTimeLimit(String(question.timeLimit ?? ""))
      setFollowupCount(
        String(question.followupCount ?? FOLLOWUP_COUNT_DEFAULT)
      )
      setCodeWeightPct(
        question.codeWeightPct ??
          CODE_WEIGHT_PCT_DEFAULTS[question.environment ?? "notebook"]
      )
    } else {
      setActiveId(null)
      setEnvironment("notebook")
      setType("")
      setName("")
      setDescription("")
      setDifficulty("easy")
      setTimeLimit(String(DIFFICULTY_TIME_LIMITS.easy))
      setFollowupCount(String(FOLLOWUP_COUNT_DEFAULT))
      setCodeWeightPct(CODE_WEIGHT_PCT_DEFAULTS.notebook)
      setFiles([])
    }
    setUploadPct(null)
  }, [open, question])

  // Hydrate files from the fetched detail (edit) or freshly created question.
  useEffect(() => {
    if (open && detailQuery.data) {
      setFiles(detailQuery.data.files)
    }
  }, [open, detailQuery.data])

  // Keyed by the immutable S3 key, not the display name (L11) — names can
  // collide; the backend folds this back onto files[].purpose by key.
  const buildMetaData = (rows: FileRow[]): Record<string, string> =>
    Object.fromEntries(
      rows.filter((f) => f.purpose.trim()).map((f) => [f.key, f.purpose.trim()])
    )

  const applyDetail = (detail: InterviewQuestion) => {
    setActiveId(detail.id)
    setFiles(detail.files)
  }

  const invalidateLists = () =>
    queryClient.invalidateQueries({ queryKey: ["interviewQuestions"] })

  // Save core fields: create (no id yet) keeps the dialog open so files can
  // be attached; update (has id) persists purposes too, then closes.
  const saveMutation = useMutation({
    mutationFn: async () => {
      const base = {
        environment,
        type: type.trim(),
        name: name.trim(),
        description: description.trim() || undefined,
        difficultyLevel: difficulty,
        timeLimit: Number(timeLimit) || 0,
        // Clamp to the backend range so an out-of-bounds typed value can't 400.
        followupCount: Math.min(
          FOLLOWUP_COUNT_MAX,
          Math.max(
            FOLLOWUP_COUNT_MIN,
            Math.round(Number(followupCount) || FOLLOWUP_COUNT_DEFAULT)
          )
        ),
        // Slider/preset value, but clamp anyway so a stale/bad seed can't 400.
        codeWeightPct: Math.min(
          CODE_WEIGHT_PCT_MAX,
          Math.max(CODE_WEIGHT_PCT_MIN, Math.round(codeWeightPct))
        )
      }
      if (activeId) {
        return updateInterviewQuestion(activeId, {
          ...base,
          metaData: buildMetaData(files)
        })
      }
      return createInterviewQuestion(base)
    },
    onSuccess: (detail) => {
      invalidateLists()
      if (isEdit || activeId) {
        toast.success("Question saved.")
        onOpenChange(false)
        return
      }
      // Fresh create: keep open, unlock the file section.
      applyDetail(detail)
      toast.success("Question created. You can now attach files.")
    },
    onError: (err) =>
      toast.error(
        apiError(err, isEdit ? "Could not update question." : "Could not create question.")
      )
  })

  // On create, picking a difficulty prefills its suggested time budget so
  // the admin gets a sensible default; they can still type their own. When
  // editing we leave the saved time limit untouched.
  const handleDifficultyChange = (value: InterviewQuestionDifficulty) => {
    setDifficulty(value)
    if (!isEdit) setTimeLimit(String(DIFFICULTY_TIME_LIMITS[value]))
  }

  // Same prefill pattern for the environment → rubric split (canvas 50/50,
  // others 20/80): on create, switching environment re-seeds the slider; the
  // admin can still override it. When editing we keep the saved split.
  const handleEnvironmentChange = (value: QuestionEnvironment) => {
    setEnvironment(value)
    if (!isEdit) setCodeWeightPct(CODE_WEIGHT_PCT_DEFAULTS[value])
  }

  const handlePickFile = () => fileInputRef.current?.click()

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file || !activeId) return
    // Mirror the backend's per-environment gate with a friendlier, immediate message.
    const rule = ATTACHMENT_RULES[environment]
    if (rule && !rule.uploads) {
      toast.error(rule.hint)
      return
    }
    if (rule?.pattern && !rule.pattern.test(file.name)) {
      toast.error(rule.blocked ?? rule.hint)
      return
    }
    if (rule?.maxFiles !== undefined && files.length >= rule.maxFiles) {
      toast.error(
        rule.maxFiles === 1
          ? "This question already has its starter file — remove it first to replace it."
          : `This type allows at most ${rule.maxFiles} files.`
      )
      return
    }
    setUploadPct(0)
    try {
      const presigned = await initInterviewQuestionUpload(activeId, {
        mimeType: file.type || "application/octet-stream",
        filename: file.name
      })
      await uploadToPresignedUrl(presigned.uploadUrl, file, presigned.contentType, (pct) =>
        setUploadPct(pct)
      )
      const detail = await completeInterviewQuestionUpload(activeId, {
        key: presigned.key,
        mimeType: presigned.contentType,
        sizeBytes: file.size,
        filename: file.name,
        purpose: ""
      })
      applyDetail(detail)
      invalidateLists()
      toast.success("File uploaded.")
    } catch (err) {
      toast.error(apiError(err, "Upload failed."))
    } finally {
      setUploadPct(null)
    }
  }

  const updatePurpose = (idx: number, value: string) =>
    setFiles((prev) => prev.map((f, i) => (i === idx ? { ...f, purpose: value } : f)))

  const removeFile = async (key: string) => {
    if (!activeId) return
    try {
      const detail = await removeInterviewQuestionFile(activeId, key)
      applyDetail(detail)
      invalidateLists()
      toast.success("File removed.")
    } catch (err) {
      toast.error(apiError(err, "Could not remove file."))
    }
  }

  const uploading = uploadPct !== null
  const busy = saveMutation.isPending || uploading
  const canSubmit =
    name.trim().length > 0 &&
    type.trim().length > 0 &&
    Number(timeLimit) > 0 &&
    !busy
  const attachmentRule = ATTACHMENT_RULES[environment]
  const uploadsAllowed = attachmentRule?.uploads !== false
  const atFileLimit =
    attachmentRule?.maxFiles !== undefined &&
    files.length >= attachmentRule.maxFiles
  const filesUnlocked = Boolean(activeId)
  const detailLoading = isEdit && detailQuery.isLoading

  return (
    <>
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (busy) return
        onOpenChange(o)
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (canSubmit) saveMutation.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit question" : "Add question"}</DialogTitle>
            <DialogDescription>
              Configure the question, its difficulty and time limit. Once saved you
              can attach any supporting files the candidate will need.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-5 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2.5">
                <Label htmlFor="q-environment">Environment</Label>
                <Select
                  value={environment}
                  onValueChange={(v) =>
                    handleEnvironmentChange(v as QuestionEnvironment)
                  }
                >
                  <SelectTrigger id="q-environment">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {environmentOptions.map((e) => (
                      <SelectItem key={e.value} value={e.value}>
                        {e.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Sets the candidate&apos;s editor and which files can be attached.
                </p>
              </div>
              <div className="flex flex-col gap-2.5">
                <Label htmlFor="q-difficulty">Difficulty</Label>
                <Select
                  value={difficulty}
                  onValueChange={(v) =>
                    handleDifficultyChange(v as InterviewQuestionDifficulty)
                  }
                >
                  <SelectTrigger id="q-difficulty">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {difficultyOptions.map((d) => (
                      <SelectItem key={d.value} value={d.value}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-2.5">
              <Label htmlFor="q-type">Type / Topic</Label>
              <Combobox
                id="q-type"
                value={type}
                onValueChange={(v) => {
                  setTypeTouched(true)
                  setType(v.toLowerCase())
                }}
                options={typeSuggestions}
                placeholder="e.g. mern, ai/ml, devops"
                aria-invalid={typeTouched && type.trim().length === 0}
              />
              {typeTouched && type.trim().length === 0 ? (
                <p className="text-xs text-destructive">
                  A topic label is required (e.g. mern, ai/ml, devops).
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Free-form topic tag for display and filtering.
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2.5">
              <Label htmlFor="q-name">Name</Label>
              <Input
                id="q-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Build a REST endpoint"
                autoFocus
                required
              />
            </div>

            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="q-description">Description</Label>
                <div className="flex items-center gap-1.5">
                  <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
                    <button
                      type="button"
                      onClick={() => setDescTab("write")}
                      className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                        descTab === "write"
                          ? "bg-accent text-accent-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Write
                    </button>
                    <button
                      type="button"
                      onClick={() => setDescTab("preview")}
                      className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                        descTab === "preview"
                          ? "bg-accent text-accent-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Preview
                    </button>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setDescExpanded(true)}
                    title="Expand editor"
                    aria-label="Expand description editor"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              {descTab === "write" ? (
                <Textarea
                  id="q-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={8}
                  placeholder="What the candidate is asked to do… (Markdown supported: **bold**, lists, `code`, tables)"
                  className="font-mono text-xs"
                />
              ) : (
                <div className="min-h-[9rem] rounded-md border border-input bg-background px-3 py-2">
                  {description.trim() ? (
                    <Markdown content={description} />
                  ) : (
                    <p className="text-sm text-muted-foreground italic">Nothing to preview yet.</p>
                  )}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Markdown is supported — the candidate sees it formatted exactly as previewed.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2.5">
                <Label htmlFor="q-time">Time limit (minutes)</Label>
                <Input
                  id="q-time"
                  type="number"
                  min={1}
                  value={timeLimit}
                  onChange={(e) => setTimeLimit(e.target.value)}
                  placeholder="30"
                  required
                />
              </div>
              <div className="flex flex-col gap-2.5">
                <Label htmlFor="q-followups">Follow-up questions</Label>
                <Input
                  id="q-followups"
                  type="number"
                  min={FOLLOWUP_COUNT_MIN}
                  max={FOLLOWUP_COUNT_MAX}
                  value={followupCount}
                  onChange={(e) => setFollowupCount(e.target.value)}
                  placeholder={String(FOLLOWUP_COUNT_DEFAULT)}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  AI questions asked after this task ({FOLLOWUP_COUNT_MIN}–
                  {FOLLOWUP_COUNT_MAX}).
                </p>
              </div>
            </div>

            {/* Scoring rubric: how this question's Technical Depth is split
                between the submitted work and the spoken follow-up interview.
                Presets for the common splits + a slider for anything custom. */}
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="q-code-weight">Scoring rubric</Label>
                <div className="flex items-center gap-1">
                  {CODE_WEIGHT_PCT_PRESETS.map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => setCodeWeightPct(pct)}
                      className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                        codeWeightPct === pct
                          ? "bg-accent text-accent-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {pct}/{100 - pct}
                    </button>
                  ))}
                </div>
              </div>
              <input
                id="q-code-weight"
                type="range"
                min={CODE_WEIGHT_PCT_MIN}
                max={CODE_WEIGHT_PCT_MAX}
                step={5}
                value={codeWeightPct}
                onChange={(e) => setCodeWeightPct(Number(e.target.value))}
                className="w-full accent-primary"
              />
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">
                  Submitted work {codeWeightPct}%
                </span>
                <span className="font-medium">
                  Follow-up interview {100 - codeWeightPct}%
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                How this question&apos;s Technical Depth score is split between
                the submitted code/design and the candidate&apos;s spoken
                follow-up answers. Defaults by environment: Canvas 50/50;
                Code Editor and Notebook 20/80 (the unrehearsed follow-up is
                the harder-to-fake signal).
              </p>
            </div>

            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <Label>Files</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handlePickFile}
                  disabled={
                    !filesUnlocked || !uploadsAllowed || atFileLimit || uploading
                  }
                  title={
                    !uploadsAllowed
                      ? attachmentRule?.hint
                      : atFileLimit
                        ? "This question already has its starter file — remove it to replace it."
                        : filesUnlocked
                          ? undefined
                          : "Save the question first"
                  }
                >
                  {uploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  {uploading ? `Uploading ${uploadPct}%` : "Add file"}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={attachmentRule?.accept}
                  className="hidden"
                  onChange={handleFileChange}
                />
              </div>

              {/* What the candidate will (and won't) see for this type. */}
              {attachmentRule?.hint ? (
                <p className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  {attachmentRule.hint}
                </p>
              ) : null}

              {!filesUnlocked ? (
                <p className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-4 text-center text-xs text-muted-foreground">
                  Save the question first, then attach supporting files here.
                </p>
              ) : detailLoading ? (
                <p className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-4 text-center text-xs text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading files…
                </p>
              ) : files.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-4 text-center text-xs text-muted-foreground">
                  No files attached. Use "Add file" to upload supporting material.
                </p>
              ) : (
                <div className="space-y-2">
                  {files.map((file, idx) => (
                    <div
                      key={file.key}
                      className="rounded-lg border border-border bg-card p-3"
                    >
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 shrink-0 text-primary" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{file.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatBytes(file.size)} · {file.mimeType || "unknown"}
                          </p>
                        </div>
                        {file.url ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            asChild
                            title="Download file"
                          >
                            <a href={file.url} target="_blank" rel="noreferrer">
                              <Download className="h-4 w-4" />
                            </a>
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeFile(file.key)}
                          title="Remove file"
                          aria-label={`Remove ${file.name}`}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                      <Input
                        value={file.purpose}
                        onChange={(e) => updatePurpose(idx, e.target.value)}
                        placeholder="What is this file for? (saved on Save changes)"
                        className="mt-2 h-8 text-xs"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              {filesUnlocked ? "Close" : "Cancel"}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {saveMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {activeId ? "Save changes" : "Create question"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    {/* Expanded editor: raw markdown (left) + live preview (right), sharing the
        same `description` state so edits flow straight back to the main form. */}
    <Dialog open={descExpanded} onOpenChange={setDescExpanded}>
      <DialogContent className="flex h-[80vh] max-w-4xl flex-col gap-3 sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Description</DialogTitle>
          <DialogDescription>
            Edit the markdown on the left; the candidate sees the preview on the right.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What the candidate is asked to do… (Markdown supported)"
            className="h-full resize-none font-mono text-xs"
          />
          <div className="h-full overflow-y-auto rounded-md border border-input bg-background px-3 py-2">
            {description.trim() ? (
              <Markdown content={description} />
            ) : (
              <p className="text-sm text-muted-foreground italic">Nothing to preview yet.</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" onClick={() => setDescExpanded(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}
