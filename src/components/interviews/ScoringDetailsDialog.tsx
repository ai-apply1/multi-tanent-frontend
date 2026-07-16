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
import { formatScore, formatRole } from "@/features/interviews/helpers";
import type {
  DisfluencyRating,
  FluencyResult,
  OverallScores,
} from "@/features/interviews/types";

/**
 * The default (documented) scoring weights, shown only as LABELS next to the
 * plugged-in numbers so a reviewer can see HOW the score was combined. The
 * authoritative result in every card is always the persisted value the backend
 * computed — we never recompute client-side, so an env-tuned weight can't make
 * the display lie. See `docs/ai-scoring.md` §7–§8.
 */
const W_TECH = 0.4;
const W_COMM = 0.6;
const W_SUBSTANCE = 0.15;
const W_FLUENCY = 0.85;
const W_TEMPORAL = 0.35;
const W_LLM = 0.65;

/** 1-decimal score or an em-dash for missing/NaN. */
function s1(n?: number | null): string {
  return formatScore(n ?? undefined, { suffix: "" });
}

/** A weight coefficient like `0.40`. */
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
  { label: string; variant: "success" | "warning" | "destructive" }
> = {
  none: { label: "None", variant: "success" },
  occasional: { label: "Occasional", variant: "warning" },
  frequent: { label: "Frequent", variant: "destructive" },
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidateName?: string | null;
  overall: OverallScores;
  fluency: FluencyResult | null;
}

/**
 * The full "how this candidate was scored" breakdown, opened from the Overall
 * scoring section. Shows every number the backend persisted AND the formulas
 * that combine them: the overall blend, the communication fluency-dominant
 * fold, the pooled spoken-English fluency (temporal delivery metrics + the LLM
 * axes), pacing, the per-section rollup, and the supporting integrity/coverage
 * stats. Every value is the persisted one — nothing is recomputed here.
 */
export function ScoringDetailsDialog({
  open,
  onOpenChange,
  candidateName,
  overall,
  fluency,
}: Props) {
  const substance = overall.communicationSubstance;
  const folded =
    typeof overall.fluencyScore === "number" &&
    typeof overall.communicationFloor === "number";
  const features = fluency?.features ?? null;
  const assessment = fluency?.assessment ?? null;
  const disfluency = assessment?.disfluency?.rating
    ? DISFLUENCY_META[assessment.disfluency.rating]
    : null;
  const categories = overall.categoryBreakdown ?? [];
  const pacing = overall.pacing;
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
          {/* --- How the overall is built ------------------------------- */}
          <section className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Composition
            </h4>
            <FormulaCard
              icon={Calculator}
              title="Overall"
              result={overall.overall}
              formula={
                <>
                  {w(W_TECH)} × Technical ({s1(overall.technicalSkills)}) +{" "}
                  {w(W_COMM)} × Communication ({s1(overall.communication)})
                </>
              }
              note="Passes when Overall ≥ 7 and Technical ≥ 5 (both required)."
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <FormulaCard
                icon={Layers}
                title="Communication"
                result={overall.communication}
                formula={
                  folded ? (
                    <>
                      ({w(W_SUBSTANCE)} × Substance ({s1(substance)}) +{" "}
                      {w(W_FLUENCY)} × Fluency ({s1(overall.fluencyScore)})) ×{" "}
                      g ({s1(overall.communicationFloor)})
                    </>
                  ) : (
                    <>Substance mean ({s1(substance ?? overall.communication)})</>
                  )
                }
                note={
                  folded
                    ? "Spoken English leads; substance is a low-end floor (g) that crushes fluent-but-empty answers toward 0."
                    : "Fluency was not folded in — communication is the per-answer substance mean (structure / clarity / concision)."
                }
              />
              <div className="grid grid-cols-2 gap-2">
                <ScoreBar label="Technical" value={overall.technicalSkills} />
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
                <span className="flex items-center gap-1.5">
                  <Badge
                    variant={fluency.llmMode === "audio" ? "success" : "muted"}
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
                </span>
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
                no scorable speech, or it was graded before the fluency pass
                shipped. Communication is the substance mean alone.
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

          {/* --- Per-section rollup ------------------------------------ */}
          {categories.length > 0 ? (
            <section className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                By section
              </h4>
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-1.5 text-left font-medium">
                        Section
                      </th>
                      <th className="px-2 py-1.5 text-right font-medium">
                        Answered
                      </th>
                      <th className="px-2 py-1.5 text-right font-medium">
                        Tech
                      </th>
                      <th className="px-2 py-1.5 text-right font-medium">
                        Comm
                      </th>
                      <th className="px-3 py-1.5 text-right font-medium">
                        Overall
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {categories.map((c) => (
                      <tr
                        key={c.category}
                        className="border-t border-border tabular-nums"
                      >
                        <td className="px-3 py-1.5 text-left font-medium">
                          {formatRole(c.category)}
                        </td>
                        <td className="px-2 py-1.5 text-right text-muted-foreground">
                          {c.answered}/{c.count}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          {s1(c.technical)}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          {s1(c.communication)}
                        </td>
                        <td className="px-3 py-1.5 text-right font-semibold">
                          {s1(c.overall)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Section rollups are a stat only — they don&apos;t feed the pass
                gate. Technical uses technical questions only.
              </p>
            </section>
          ) : null}

          {/* --- Supporting stats -------------------------------------- */}
          <section className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Supporting signals
            </h4>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {typeof overall.coverage === "number" ? (
                <MetricTile
                  label="Coverage"
                  value={pct(overall.coverage)}
                  hint="questions answered"
                />
              ) : null}
              {typeof overall.integrity === "number" ? (
                <div
                  className={cn(
                    "rounded-lg border px-3 py-2",
                    overall.integrity < 6
                      ? "border-amber-500/40 bg-amber-500/10"
                      : "border-border bg-card",
                  )}
                >
                  <p className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    <ShieldCheck className="h-3 w-3" />
                    Integrity
                  </p>
                  <p className="mt-0.5 text-sm font-semibold tabular-nums">
                    {s1(overall.integrity)}
                    <span className="text-[10px] font-normal text-muted-foreground">
                      {" "}
                      / 10
                    </span>
                  </p>
                  <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">
                    {overall.integrity < 6
                      ? "flag — human review"
                      : "flag-only, never auto-fails"}
                  </p>
                </div>
              ) : null}
            </div>
          </section>

          <p className="flex items-start gap-1.5 pt-1 text-[10px] leading-snug text-muted-foreground">
            <Timer className="mt-0.5 h-3 w-3 shrink-0" />
            Weights shown are the defaults; the results above are the exact
            values the backend persisted for this interview.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
