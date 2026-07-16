import type { ReactNode } from "react";
import {
  AudioLines,
  Calculator,
  Gauge,
  Layers,
  Mic,
  ShieldCheck,
  Timer,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { formatScore } from "@/features/interviews/helpers";
import type {
  DisfluencyRating,
  InterviewScores,
  ScoringWeights,
} from "@/features/interviews/types";

/**
 * The job's fold weights when a scored row predates the snapshot
 * (`scores.scoringWeights`). Mirrors the backend's
 * `SCORING_WEIGHT_DEFAULTS` — 0–100, summing to 100.
 */
const WEIGHT_DEFAULTS: ScoringWeights = { technical: 60, communication: 40 };

/**
 * The communication-fold + fluency weights, shown only as LABELS next to the
 * plugged-in numbers so a reviewer can see HOW the score was combined. Unlike
 * the job's scoring weights (snapshotted onto every scored row), these are
 * backend constants — the fluency split is fixed in code, the communication
 * split is env-tunable — so they're the DOCUMENTED defaults, not necessarily
 * what ran. The authoritative result in every card is always the persisted
 * value the backend computed; we never recompute client-side, so a tuned
 * weight can't make the displayed result lie.
 */
const W_FLUENCY = 0.85;
const W_SUBSTANCE = 1 - W_FLUENCY;
const W_TEMPORAL = 0.35;
const W_LLM = 0.65;

/** How far above the cut line an overall must land to earn a `strong_yes`. */
const STRONG_YES_MARGIN = 20;
const STRONG_YES_CAP = 90;

/** 1-decimal score or an em-dash for missing/NaN. */
function s1(n?: number | null): string {
  return formatScore(n ?? undefined, { suffix: "" });
}

/** A weight coefficient like `0.85`. */
function w(n: number): string {
  return n.toFixed(2);
}

function pct(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

function secs(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (n < 60) return `${Math.round(n)}s`;
  const m = Math.floor(n / 60);
  const rem = Math.round(n % 60);
  return rem ? `${m}m ${rem}s` : `${m}m`;
}

/** A 0–10 score with a slim proportional bar underneath. */
function ScoreBar({
  label,
  value,
  hint,
  tone = "primary",
}: {
  label: string;
  value?: number | null;
  hint?: string;
  tone?: "primary" | "muted";
}) {
  const pctWidth =
    value == null || Number.isNaN(value)
      ? 0
      : Math.max(0, Math.min(100, value * 10));
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          {label}
        </span>
        <span className="text-sm font-semibold tabular-nums">
          {s1(value)}
          <span className="text-[10px] font-normal text-muted-foreground">
            {" "}
            / 10
          </span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-border">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            tone === "primary" ? "bg-primary" : "bg-muted-foreground/50",
          )}
          style={{ width: `${pctWidth}%` }}
        />
      </div>
      {hint ? (
        <p className="mt-1 text-[10px] leading-tight text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** A single "raw metric" tile (non-0-10 numbers: WPM, ratios, counts). */
function MetricTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums">{value}</p>
      {hint ? (
        <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A "formula card" — the headline result on the left, the combination it came
 * from on the right (`result = wA·A + wB·B`), with the real plugged-in values
 * in muted text below. This is the core "how are they combined" affordance.
 */
function FormulaCard({
  icon: Icon,
  title,
  result,
  suffix = " / 10",
  formula,
  note,
}: {
  icon: LucideIcon;
  title: string;
  result?: number | null;
  suffix?: string;
  formula?: ReactNode;
  note?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          {title}
        </span>
        <span className="text-lg font-semibold tabular-nums">
          {s1(result)}
          <span className="text-xs font-normal text-muted-foreground">
            {suffix}
          </span>
        </span>
      </div>
      {formula ? (
        <div className="mt-2 rounded-md border border-border/60 bg-card px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {formula}
        </div>
      ) : null}
      {note ? (
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
          {note}
        </p>
      ) : null}
    </div>
  );
}

const DISFLUENCY_META: Record<
  DisfluencyRating,
  { label: string; variant: "secondary" | "outline" | "destructive" }
> = {
  none: { label: "None", variant: "secondary" },
  occasional: { label: "Occasional", variant: "outline" },
  frequent: { label: "Frequent", variant: "destructive" },
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidateName?: string | null;
  scores: InterviewScores;
}

/**
 * The full "how this candidate was scored" breakdown, opened from the Overall
 * scoring section. Shows every number the backend persisted AND the formulas
 * that combine them: the job-weighted overall blend, the communication
 * fluency-dominant fold, the pooled spoken-English fluency (temporal delivery
 * metrics + the LLM axes), pacing, and the supporting integrity/coverage
 * stats. Every value is the persisted one — nothing is recomputed here.
 */
export function ScoringDetailsDialog({
  open,
  onOpenChange,
  candidateName,
  scores,
}: Props) {
  const substance = scores.communicationSubstance;
  const fluency = scores.fluency ?? null;
  // The fold ran iff the floor factor was recorded AND a fluency score was
  // produced to fold in.
  const folded =
    typeof scores.communicationFloor === "number" &&
    typeof fluency?.fluencyScore === "number";
  const features = fluency?.features ?? null;
  const assessment = fluency?.assessment ?? null;
  const disfluency = assessment?.disfluency?.rating
    ? DISFLUENCY_META[assessment.disfluency.rating]
    : null;
  const pacing = scores.pacing;
  const integrity = scores.integrity;
  const weights = scores.scoringWeights ?? WEIGHT_DEFAULTS;
  const threshold = scores.rejectionThreshold;
  const firstName = candidateName?.trim()
    ? candidateName.trim().split(/\s+/)[0]
    : "this candidate";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="h-4 w-4 text-muted-foreground" />
            Scoring breakdown
          </DialogTitle>
          <DialogDescription>
            How {firstName}&apos;s scores were computed — every metric and how
            they combine. The AI only judges; every number that gates the
            verdict is computed in deterministic code.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1">
          {/* --- How the overall is built -------------------------------

              The fold weights and the cut line are the JOB's, snapshotted
              onto this row at scoring time — so a later edit to the job
              can't retroactively misexplain a score that already shipped. */}
          <section className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Composition
            </h4>
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
                      {w(W_FLUENCY)} × Fluency ({s1(fluency?.fluencyScore)})) × g
                      ({s1(scores.communicationFloor)})
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
          </section>

          {/* --- Spoken-English fluency -------------------------------- */}
          <section className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Spoken-English fluency
              </h4>
              {fluency ? (
                <Badge
                  variant={fluency.llmMode === "audio" ? "secondary" : "muted"}
                  className="gap-1 text-[10px]"
                >
                  {fluency.llmMode === "audio" ? (
                    <>
                      <AudioLines className="h-3 w-3" />
                      Heard the audio
                    </>
                  ) : (
                    <>
                      <Mic className="h-3 w-3" />
                      Text-judge fallback
                    </>
                  )}
                </Badge>
              ) : null}
            </div>

            {fluency ? (
              <>
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
                    <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
                      Delivery metrics (measured from word timings)
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
                    <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
                      Spoken-language judge
                      <span className="ml-1 font-normal">
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
                      <ScoreBar label="Coherence" value={assessment.coherence} />
                    </div>
                    {disfluency ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
                        <span className="text-xs font-medium text-muted-foreground">
                          Disfluency
                        </span>
                        <Badge
                          variant={disfluency.variant}
                          className="text-[10px]"
                        >
                          {disfluency.label}
                        </Badge>
                        {assessment.disfluency.evidence ? (
                          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                            “{assessment.disfluency.evidence}”
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                Fluency wasn&apos;t scored for this interview — either there was
                no scorable speech, or the fold was turned off. Communication is
                the substance mean alone.
              </p>
            )}
          </section>

          {/* --- Pacing (transcript-word based) ------------------------ */}
          {pacing ? (
            <section className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Pacing
              </h4>
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
            </section>
          ) : null}

          {/* --- Supporting stats -------------------------------------- */}
          <section className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Supporting signals
            </h4>
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
                      ? "border-amber-500/40 bg-amber-500/10"
                      : "border-border bg-card",
                  )}
                >
                  <p className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    <ShieldCheck className="h-3 w-3" />
                    Integrity
                  </p>
                  <p className="mt-0.5 text-sm font-semibold tabular-nums">
                    {s1(integrity.score)}
                    <span className="text-[10px] font-normal text-muted-foreground">
                      {" "}
                      / 10
                    </span>
                  </p>
                  <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">
                    {integrity.score < 6
                      ? "flag — human review"
                      : "flag-only, never auto-fails"}
                  </p>
                </div>
              ) : null}
            </div>
          </section>

          <p className="flex items-start gap-1.5 pt-1 text-[10px] leading-snug text-muted-foreground">
            <Timer className="mt-0.5 h-3 w-3 shrink-0" />
            The Technical/Communication split and the threshold above are this
            job&apos;s, recorded at scoring time. The fluency and fold weights
            are the backend defaults; the results are the exact values persisted
            for this interview.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
