import type { ReactNode } from "react"
import {
  AudioLines,
  Calculator,
  Gauge,
  Layers,
  Mic,
  ShieldCheck,
  Timer,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatScore } from "@/features/interviews/helpers"
import type {
  DisfluencyRating,
  InterviewScores,
  ScoringWeights,
} from "@/features/interviews/types"

/**
 * The job's fold weights when a scored row predates the snapshot
 * (`scores.scoringWeights`). Mirrors the backend's
 * `SCORING_WEIGHT_DEFAULTS` — 0–100, summing to 100.
 */
const WEIGHT_DEFAULTS: ScoringWeights = { technical: 60, communication: 40 }

/**
 * The communication-fold + fluency weights, shown only as LABELS next to the
 * plugged-in numbers so a reviewer can see HOW the score was combined.
 */
const W_FLUENCY = 0.85
const W_SUBSTANCE = 1 - W_FLUENCY
const W_TEMPORAL = 0.35
const W_LLM = 0.65

/** How far above the cut line an overall must land to earn a `strong_yes`. */
const STRONG_YES_MARGIN = 20
const STRONG_YES_CAP = 90

/** 1-decimal score or an em-dash for missing/NaN. */
function s1(n?: number | null): string {
  return formatScore(n ?? undefined, { suffix: "" })
}

/** A weight coefficient like `0.85`. */
function w(n: number): string {
  return n.toFixed(2)
}

function pct(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—"
  return `${Math.round(n * 100)}%`
}

function secs(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—"
  if (n < 60) return `${Math.round(n)}s`
  const m = Math.floor(n / 60)
  const rem = Math.round(n % 60)
  return rem ? `${m}m ${rem}s` : `${m}m`
}

/** Section shell — the token-based card wrapper used by every group. */
function Section({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-xl border border-line bg-surface-2 p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-subtle">
          {title}
        </h4>
        {action}
      </div>
      {children}
    </section>
  )
}

/** A 0–10 score with a slim proportional bar underneath. */
function ScoreBar({
  label,
  value,
  hint,
  tone = "primary",
}: {
  label: string
  value?: number | null
  hint?: string
  tone?: "primary" | "muted"
}) {
  const pctWidth =
    value == null || Number.isNaN(value)
      ? 0
      : Math.max(0, Math.min(100, value * 10))
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-medium text-ink-muted">{label}</span>
        <span className="mono text-[13px] font-semibold text-ink">
          {s1(value)}
          <span className="text-[10px] font-normal text-ink-subtle">
            {" "}
            / 10
          </span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            tone === "primary" ? "bg-primary" : "bg-ink-subtle",
          )}
          style={{ width: `${pctWidth}%` }}
        />
      </div>
      {hint ? (
        <p className="mt-1 text-[10.5px] leading-tight text-ink-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

/** A single "raw metric" tile (non-0-10 numbers: WPM, ratios, counts). */
function MetricTile({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-ink-subtle">
        {label}
      </p>
      <p className="mono mt-0.5 text-[13px] font-semibold text-ink">{value}</p>
      {hint ? (
        <p className="mt-0.5 text-[10.5px] leading-tight text-ink-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

/**
 * A "formula card" — headline result on the left, the combination it came
 * from on the right (`result = wA·A + wB·B`), with the real plugged-in values
 * in muted text below.
 */
function FormulaCard({
  icon: Icon,
  title,
  result,
  suffix = " / 10",
  formula,
  note,
}: {
  icon: LucideIcon
  title: string
  result?: number | null
  suffix?: string
  formula?: ReactNode
  note?: string
}) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink">
          <Icon
            className="h-3.5 w-3.5 text-ink-subtle"
            strokeWidth={1.7}
          />
          {title}
        </span>
        <span className="mono text-[16px] font-semibold text-ink">
          {s1(result)}
          <span className="text-[11px] font-normal text-ink-subtle">
            {suffix}
          </span>
        </span>
      </div>
      {formula ? (
        <div className="mono mt-2 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[11px] leading-relaxed text-ink-muted">
          {formula}
        </div>
      ) : null}
      {note ? (
        <p className="mt-1.5 text-[11.5px] leading-snug text-ink-muted">
          {note}
        </p>
      ) : null}
    </div>
  )
}

const DISFLUENCY_META: Record<
  DisfluencyRating,
  { label: string; toneClass: string }
> = {
  none: {
    label: "None",
    toneClass: "bg-[var(--success-soft)] text-[var(--success)]",
  },
  occasional: {
    label: "Occasional",
    toneClass: "bg-[var(--warning-soft)] text-[var(--warning)]",
  },
  frequent: {
    label: "Frequent",
    toneClass: "bg-[var(--danger-soft)] text-[var(--danger)]",
  },
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  candidateName?: string | null
  scores: InterviewScores
}

/**
 * The full "how this candidate was scored" breakdown, opened from the Overall
 * scoring section. Shows every number the backend persisted AND the formulas
 * that combine them.
 */
export function ScoringDetailsDialog({
  open,
  onOpenChange,
  candidateName,
  scores,
}: Props) {
  const substance = scores.communicationSubstance
  const fluency = scores.fluency ?? null
  // The fold ran iff the floor factor was recorded AND a fluency score was
  // produced to fold in.
  const folded =
    typeof scores.communicationFloor === "number" &&
    typeof fluency?.fluencyScore === "number"
  const features = fluency?.features ?? null
  const assessment = fluency?.assessment ?? null
  const disfluency = assessment?.disfluency?.rating
    ? DISFLUENCY_META[assessment.disfluency.rating]
    : null
  const pacing = scores.pacing
  const integrity = scores.integrity
  const weights = scores.scoringWeights ?? WEIGHT_DEFAULTS
  const threshold = scores.rejectionThreshold
  const displayName = candidateName?.trim() ? candidateName.trim() : "Candidate"
  const firstName = candidateName?.trim()
    ? candidateName.trim().split(/\s+/)[0]
    : "this candidate"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[620px]">
        <DialogHeader>
          <DialogTitle className="text-[18px] font-semibold text-ink">
            {displayName} — Scoring
          </DialogTitle>
          <DialogDescription className="text-[13px] text-ink-muted leading-relaxed">
            How {firstName}&apos;s scores were computed — every metric and how
            they combine. The AI only judges; every number that gates the
            verdict is computed in deterministic code.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
          {/* --- How the overall is built ------------------------------- */}
          <Section title="Composition">
            <div className="space-y-2">
              <FormulaCard
                icon={Calculator}
                title="Overall"
                result={scores.overall}
                formula={
                  <>
                    {weights.technical}% × Technical ({s1(scores.technical)}) +{" "}
                    {weights.communication}% × Communication (
                    {s1(scores.communication)})
                  </>
                }
                note={
                  typeof threshold === "number"
                    ? `Passes when Overall × 10 ≥ ${threshold} (the job's rejection threshold). ` +
                      `A strong yes needs ≥ ${Math.min(threshold + STRONG_YES_MARGIN, STRONG_YES_CAP)}.`
                    : "Passes when Overall × 10 clears the job's rejection threshold."
                }
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <FormulaCard
                  icon={Layers}
                  title="Communication"
                  result={scores.communication}
                  formula={
                    folded ? (
                      <>
                        ({w(W_SUBSTANCE)} × Substance ({s1(substance)}) +{" "}
                        {w(W_FLUENCY)} × Fluency ({s1(fluency?.fluencyScore)}))
                        × g ({s1(scores.communicationFloor)})
                      </>
                    ) : (
                      <>
                        Substance mean ({s1(substance ?? scores.communication)})
                      </>
                    )
                  }
                  note={
                    folded
                      ? "Spoken English leads; substance is a low-end floor (g) that crushes fluent-but-empty answers toward 0."
                      : "Fluency was not folded in — communication is the per-answer substance mean (structure / clarity / concision)."
                  }
                />
                <div className="grid grid-cols-2 gap-2">
                  <ScoreBar label="Technical" value={scores.technical} />
                  <ScoreBar
                    label="Substance"
                    value={substance}
                    tone="muted"
                    hint="structure · clarity · concision"
                  />
                </div>
              </div>
            </div>
          </Section>

          {/* --- Spoken-English fluency -------------------------------- */}
          <Section
            title="Spoken-English fluency"
            action={
              fluency ? (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold",
                    fluency.llmMode === "audio"
                      ? "bg-[var(--accent-soft)] text-primary"
                      : "bg-surface-3 text-ink-muted",
                  )}
                >
                  {fluency.llmMode === "audio" ? (
                    <>
                      <AudioLines className="h-3 w-3" strokeWidth={1.9} />
                      Heard the audio
                    </>
                  ) : (
                    <>
                      <Mic className="h-3 w-3" strokeWidth={1.9} />
                      Text-judge fallback
                    </>
                  )}
                </span>
              ) : null
            }
          >
            {fluency ? (
              <div className="space-y-3 text-[13px] text-ink-2 leading-relaxed">
                <FormulaCard
                  icon={Gauge}
                  title="Fluency"
                  result={fluency.fluencyScore}
                  formula={
                    fluency.temporalScore != null ? (
                      <>
                        {w(W_TEMPORAL)} × Temporal ({s1(fluency.temporalScore)})
                        + {w(W_LLM)} × Spoken-language ({s1(fluency.llmScore)})
                      </>
                    ) : (
                      <>Spoken-language judge only ({s1(fluency.llmScore)})</>
                    )
                  }
                  note={
                    fluency.temporalScore == null
                      ? "Too little clean speech for temporal metrics — fluency is the spoken-language judge alone."
                      : undefined
                  }
                />

                {/* Delivery metrics (temporal, code-measured) */}
                {features ? (
                  <div>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-subtle">
                      Delivery metrics
                      <span className="ml-1 normal-case tracking-normal font-normal text-ink-muted">
                        (measured from word timings)
                      </span>
                    </p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <MetricTile
                        label="Speaking pace"
                        value={`${Math.round(features.wpm)} wpm`}
                        hint="ideal 120–150"
                      />
                      <MetricTile
                        label="Pause ratio"
                        value={pct(features.pauseRatio)}
                        hint="lower is better"
                      />
                      <MetricTile
                        label="Mean run length"
                        value={`${s1(features.mlr)} words`}
                        hint="ideal 7–16"
                      />
                      <MetricTile
                        label="Filler rate"
                        value={pct(features.fillerRate)}
                        hint="um / uh share"
                      />
                      <MetricTile
                        label="Speech analysed"
                        value={secs(features.speechSec)}
                        hint={`${features.wordCount.toLocaleString()} words`}
                      />
                      <MetricTile
                        label="Answers pooled"
                        value={`${features.answersAnalyzed}`}
                        hint="with usable audio"
                      />
                    </div>
                  </div>
                ) : null}

                {/* LLM axes (heard or read) */}
                {assessment ? (
                  <div>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-subtle">
                      Spoken-language judge
                      <span className="ml-1 normal-case tracking-normal font-normal text-ink-muted">
                        (accent-guarded — “clear” means intelligible, not
                        native-sounding)
                      </span>
                    </p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <ScoreBar
                        label="Intelligibility"
                        value={assessment.intelligibility}
                      />
                      <ScoreBar
                        label="Grammar & vocab"
                        value={assessment.grammaticalLexicalControl}
                      />
                      <ScoreBar
                        label="Coherence"
                        value={assessment.coherence}
                      />
                    </div>
                    {disfluency ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2">
                        <span className="text-[12px] font-medium text-ink-muted">
                          Disfluency
                        </span>
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
                            disfluency.toneClass,
                          )}
                        >
                          {disfluency.label}
                        </span>
                        {assessment.disfluency.evidence ? (
                          <span className="min-w-0 flex-1 truncate text-[12px] text-ink-muted">
                            “{assessment.disfluency.evidence}”
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-line-2 bg-surface p-3 text-[13px] text-ink-muted leading-relaxed">
                Fluency wasn&apos;t scored for this interview — either there was
                no scorable speech, or the fold was turned off. Communication is
                the substance mean alone.
              </p>
            )}
          </Section>

          {/* --- Pacing (transcript-word based) ------------------------ */}
          {pacing ? (
            <Section title="Pacing">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <MetricTile
                  label="Avg pace"
                  value={`${Math.round(pacing.avgWordsPerMinute)} wpm`}
                  hint="across answered questions"
                />
                <MetricTile
                  label="Avg answer length"
                  value={secs(pacing.avgAnswerDurationSec)}
                />
                <MetricTile
                  label="Answers with audio"
                  value={`${pacing.answeredWithAudio}`}
                />
              </div>
            </Section>
          ) : null}

          {/* --- Supporting stats -------------------------------------- */}
          <Section title="Supporting signals">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {typeof scores.coverage === "number" ? (
                <MetricTile
                  label="Coverage"
                  value={pct(scores.coverage)}
                  hint="questions answered"
                />
              ) : null}
              {integrity ? (
                <div
                  className={cn(
                    "rounded-lg border px-3 py-2",
                    integrity.score < 6
                      ? "border-[color-mix(in_srgb,var(--warning),transparent_60%)] bg-[var(--warning-soft)]"
                      : "border-line bg-surface",
                  )}
                >
                  <p className="inline-flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-ink-subtle">
                    <ShieldCheck className="h-3 w-3" strokeWidth={1.9} />
                    Integrity
                  </p>
                  <p className="mono mt-0.5 text-[13px] font-semibold text-ink">
                    {s1(integrity.score)}
                    <span className="text-[10px] font-normal text-ink-subtle">
                      {" "}
                      / 10
                    </span>
                  </p>
                  <p className="mt-0.5 text-[10.5px] leading-tight text-ink-subtle">
                    {integrity.score < 6
                      ? "flag — human review"
                      : "flag-only, never auto-fails"}
                  </p>
                </div>
              ) : null}
            </div>
          </Section>

          <p className="flex items-start gap-1.5 pt-1 text-[11px] leading-snug text-ink-subtle">
            <Timer className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={1.7} />
            The Technical/Communication split and the threshold above are this
            job&apos;s, recorded at scoring time. The fluency and fold weights
            are the backend defaults; the results are the exact values persisted
            for this interview.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
