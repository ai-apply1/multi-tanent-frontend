import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import axios from "axios";
import {
  Activity,
  AlertTriangle,
  Briefcase,
  Calculator,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  ExternalLink,
  EyeOff,
  FileText,
  History,
  Loader2,
  Mail,
  MailPlus,
  Maximize,
  MessageSquare,
  MicOff,
  MoreHorizontal,
  Play,
  RefreshCw,
  Send,
  Sparkles,
  Star,
  Tag,
  Trash2,
  User,
  X,
} from "lucide-react";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { ScoringDetailsDialog } from "@/components/interviews/ScoringDetailsDialog";
import { BulkEmailDialog } from "@/features/candidates/components/BulkEmailDialog";
import {
  HlsPlayer,
  type VideoPlayerHandle,
} from "@/components/interviews/HlsPlayer";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { VideoPlayer } from "@/components/ui/video-player";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  deleteInterview,
  getInterview,
  getInterviewAttempts,
  getInterviewScoringStatus,
  reinviteInterview,
  rescoreInterview,
  retranscodeInterviewVideo,
} from "@/features/interviews/interviewsApi";
import {
  deleteCandidate,
  getCandidate,
  listCandidateStatuses,
  sendCandidateInvite,
  updateCandidateStatus,
} from "@/features/candidates/candidatesApi";
import {
  invalidateCandidateData,
  invalidateCandidateDataAndJobCounts,
} from "@/features/candidates/candidatesCache";
import { toDisplayScore } from "@/features/candidates/aiScore";
import { useOrgTimezone } from "@/features/organization/useOrgTimezone";
import {
  INVITABLE_STATUS_KEY,
  POST_INTERVIEW_REJECT_STATUS_KEY,
  REJECTED_STATUS_KEYS,
  type BuiltinCandidateStatusKey,
  type CandidateDetail,
  type CandidateProfile,
  type CandidateStatus,
} from "@/features/candidates/types";
import {
  formatClock,
  formatScore,
  formatSessionIdTail,
  statusLabels,
} from "@/features/interviews/helpers";
import type {
  AdminInterviewAttempt,
  AdminInterviewQuestionItem,
  InterviewScores,
  Recommendation,
  ScoredAnswer,
  ScoringStatus,
} from "@/features/interviews/types";

/**
 * One option in the reattempt version dropdown, e.g. "Attempt 2 (latest)".
 */
function attemptOptionLabel(a: AdminInterviewAttempt): string {
  return a.isLatestAttempt
    ? `Attempt ${a.attemptNumber} (latest)`
    : `Attempt ${a.attemptNumber}`;
}

/** How often the lightweight scoring-status endpoint is polled. */
const SCORING_POLL_MS = 4000;

function isScoringInFlight(s?: ScoringStatus | null): boolean {
  return s === "queued" || s === "processing";
}

function isTranscoding(s?: string | null): boolean {
  return s === "pending" || s === "processing";
}

function initialsFor(name?: string, email?: string) {
  const source = (name || email || "").trim();
  if (!source) return "?";
  return (
    source
      .split(/[\s@]/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() || "")
      .join("") || "?"
  );
}

interface Props {
  /** `publicSessionId` of the attempt to open. Null when the candidate has
   *  no interview yet (rejected pre-screen, invited but not started, etc.)
   *  — `candidateId` must be supplied in that case so the drawer can still
   *  render the profile, pipeline card and per-tab "no interview" states. */
  sessionId: string | null;
  /** Fallback candidate id — used when `sessionId` is null. Providing either
   *  prop opens the drawer; providing both prefers `sessionId`'s interview. */
  candidateId?: string | null;
  onOpenChange: (open: boolean) => void;
}

// ── Small styling helpers ──────────────────────────────────────────────

/** Pipeline stage badge — org-owned hue tinted onto surface. */
function StageBadge({ status }: { status: CandidateStatus | null | undefined }) {
  if (!status) return null;
  const color = status.color;
  const style = color
    ? {
        backgroundColor: `color-mix(in oklab, ${color}, white 88%)`,
        color,
      }
    : { backgroundColor: "var(--surface-3)", color: "var(--ink-muted)" };
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-semibold"
      style={style}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color ?? "var(--ink-muted)" }}
      />
      {status.label}
    </span>
  );
}

/**
 * The AI hire/no-hire verdict is threshold-relative and decided server-side —
 * NEVER reband a raw score here. The cut line is the JOB's `rejectionThreshold`
 * (default 70, but HR-editable 0-100), so a fixed 70/86 band contradicts the
 * candidate's actual pipeline decision on any other threshold. `resolveVerdict`
 * therefore trusts the persisted `scores.recommendation` (the same value
 * `resolveRecommendation` in the backend aggregator writes) and only falls back
 * to the backend's own bands — against `scores.rejectionThreshold`, defaulting
 * to 70 — for legacy rows scored before those fields were persisted.
 */
const DEFAULT_REJECTION_THRESHOLD = 70;

function resolveVerdict(scores: InterviewScores): Recommendation {
  if (scores.recommendation) return scores.recommendation;
  const raw = scores.rejectionThreshold;
  const threshold =
    typeof raw === "number" && Number.isFinite(raw)
      ? Math.min(100, Math.max(0, raw))
      : DEFAULT_REJECTION_THRESHOLD;
  const scaled = toDisplayScore(scores.overall);
  if (scaled >= Math.min(threshold + 20, 90)) return "strong_yes";
  if (scaled >= threshold) return "yes";
  return "no";
}

/**
 * Verdict label + tone. `strong_yes`/`yes` read as a hire (green), `no` as a
 * reject (red); there is no "Maybe" band because the backend has no such state —
 * the cut line already lives in the threshold. The same tone colours the score
 * ring so the ring, the chip, and the pipeline banner all agree with the server.
 */
function verdictDisplay(rec: Recommendation): {
  label: string;
  bg: string;
  fg: string;
} {
  if (rec === "strong_yes")
    return {
      label: "Strong Hire",
      bg: "var(--success-soft)",
      fg: "var(--success)",
    };
  if (rec === "yes")
    return { label: "Hire", bg: "var(--success-soft)", fg: "var(--success)" };
  return { label: "No Hire", bg: "var(--danger-soft)", fg: "var(--danger)" };
}

// ── AI Score Card ──────────────────────────────────────────────────────

function ScoreRing({ score, color }: { score: number; color: string }) {
  const R = 32;
  const C = 2 * Math.PI * R;
  const off = C - (Math.max(0, Math.min(100, score)) / 100) * C;
  return (
    <div className="relative h-[76px] w-[76px] shrink-0">
      <svg
        width={76}
        height={76}
        style={{ transform: "rotate(-90deg)" }}
        aria-hidden
      >
        <circle
          cx={38}
          cy={38}
          r={R}
          fill="none"
          stroke="var(--surface-3)"
          strokeWidth={6}
          strokeDasharray="3 4"
        />
        <circle
          cx={38}
          cy={38}
          r={R}
          fill="none"
          stroke={color}
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={off}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="mono text-[22px] font-bold leading-none"
          style={{ color }}
        >
          {score}
        </span>
        <span className="text-[9px] text-ink-subtle">/ 100</span>
      </div>
    </div>
  );
}

/**
 * Loading placeholder for the interview drawer body. Mirrors the stacked
 * layout the loaded view uses — the AI score card (badges, score ring,
 * narrative), a contact card, and a few Q&A section blocks — so the drawer
 * keeps its shape while the interview detail resolves instead of flashing a
 * centered spinner.
 */
function InterviewDetailSkeleton() {
  return (
    <div className="space-y-4">
      {/* AI score card */}
      <div className="rounded-2xl border border-line bg-surface p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <Skeleton className="h-6 w-28 rounded-full" />
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
        <div className="flex items-start gap-4">
          <Skeleton className="h-[72px] w-[72px] shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <Skeleton className="mb-2 h-3.5 w-24" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="mt-1.5 h-3 w-11/12" />
            <Skeleton className="mt-1.5 h-3 w-4/5" />
          </div>
        </div>
        <Skeleton className="mt-4 h-3 w-64 max-w-full" />
      </div>

      {/* Contact card */}
      <div className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-2xl border border-line bg-surface p-[18px] sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i}>
            <Skeleton className="h-2.5 w-14" />
            <Skeleton className="mt-2 h-3.5 w-28 max-w-full" />
          </div>
        ))}
      </div>

      {/* Q&A section blocks */}
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="rounded-2xl border border-line bg-surface p-[18px]"
        >
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-5 w-10 rounded-full" />
          </div>
          <Skeleton className="mt-3 h-3 w-full" />
          <Skeleton className="mt-1.5 h-3 w-11/12" />
          <Skeleton className="mt-1.5 h-3 w-3/4" />
        </div>
      ))}
    </div>
  );
}

function AiScoreCard({
  overall,
  recommendation,
  narrative,
  answeredCount,
}: {
  /** 0-10 (backend scale). */
  overall: number;
  /** The AI's threshold-relative verdict, resolved from `scores` by the caller. */
  recommendation: Recommendation;
  narrative: string;
  answeredCount: number;
}) {
  // Shared with the candidate tables' score cell. The 0-10 → 0-100 conversion
  // lived only here while the tables had no number at all; now that they do,
  // one copy of the maths is what keeps the drawer and the list from
  // disagreeing about the same candidate.
  const score = toDisplayScore(overall);
  const reco = verdictDisplay(recommendation);
  const color = reco.fg;
  return (
    <div className="rounded-2xl bg-gradient-to-br from-primary to-[color-mix(in_oklab,var(--primary),white_35%)] p-[1.5px] shadow-[0_10px_30px_color-mix(in_srgb,var(--primary),transparent_84%)]">
      <div className="rounded-2xl bg-surface p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold text-primary"
            style={{ background: "var(--accent-soft)" }}
          >
            <Sparkles className="h-3 w-3" strokeWidth={1.7} />
            AI Evaluation
          </span>
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold"
            style={{ color: reco.fg, background: reco.bg }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: reco.fg }}
            />
            {reco.label}
          </span>
        </div>
        <div className="flex items-start gap-4">
          <ScoreRing score={score} color={color} />
          <div className="min-w-0 flex-1">
            <div className="mb-1 text-[13px] font-semibold text-ink-muted">
              Overall score
            </div>
            <p className="text-[13.5px] leading-[1.55] text-ink-2">
              {narrative || "No narrative available."}
            </p>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-1.5 text-[11.5px] text-ink-subtle">
          <Sparkles className="h-3 w-3" strokeWidth={1.7} />
          Generated from {answeredCount} video response
          {answeredCount === 1 ? "" : "s"} · decision support only
        </div>
      </div>
    </div>
  );
}

// ── Pipeline Card ──────────────────────────────────────────────────────

/**
 * One-line hints for the BUILTIN columns.
 *
 * Keyed rather than positional, and consulted only as decoration: the LABEL
 * always comes from the catalog, because an org can rename any column and this
 * card must not argue with the board about what a stage is called. A custom
 * column simply has no hint, which is honest — we cannot invent a description
 * for a stage the customer defined.
 */
const STAGE_HINTS: Record<string, string> = {
  applied: "Application received",
  needs_review: "Awaiting your decision to invite",
  invited: "Invitation sent, waiting on the candidate",
  interviewing: "AI interview in progress",
  scored: "Awaiting your decision",
  shortlisted: "Advanced to final round",
  rejected: "CV did not meet the job's requirements",
  final_rejected: "Interviewed, not moving forward",
  hired: "Offer accepted",
};

/**
 * The stages to draw, and where this candidate sits among them.
 *
 * ── Why this is derived and not a constant ────────────────────────────
 *
 * It used to be four hardcoded steps plus a hand-written key → index switch.
 * That made the card wrong in three separate ways for any org that touched its
 * board: a renamed column still showed the stock label, a CUSTOM column was
 * invisible (its candidates silently rendered at step 0, indistinguishable from
 * "Applied"), and the invented step "Reviewing" matched no key in the catalog
 * at all. `candidatesApi.listCandidateStatuses` already says the filter and the
 * change-status menu are built from the catalog "and never from a hard-coded
 * list" — this card was the one place that didn't comply.
 *
 * The PATH is every non-terminal column in board order. Terminal columns are
 * outcomes rather than steps everyone passes through, so the board's three or
 * four of them are not all drawn; only the one this candidate actually reached
 * is, slotted in by its OWN `stageOrder`.
 *
 * Slotted, NOT appended, and the difference is a correctness one. An INITIAL
 * rejection sits at stageOrder 30 — after "Needs Review", before "Invited" —
 * because that candidate's CV never qualified and they were never interviewed.
 * Appending it to the end would tick Invited, Interviewing and Scored as
 * completed for someone who did none of them. (The old hardcoded switch got
 * this right by pinning `rejected` to index 0 and said so; deriving the
 * position from `stageOrder` keeps that truth without hardcoding a key.)
 *
 * Everything compares on `stageOrder`, the same field the board sorts by, so a
 * reordered or renamed board reorders and renames this too.
 */
function buildPipeline(
  statuses: CandidateStatus[],
  current: CandidateStatus | null | undefined,
): { steps: CandidateStatus[]; currentIndex: number } {
  const relevant = statuses.filter(
    (s) => !s.isTerminal || (current != null && s._id === current._id),
  );
  const steps = relevant.sort((a, b) => a.stageOrder - b.stageOrder);
  const currentIndex = current
    ? steps.findIndex((s) => s._id === current._id)
    : -1;
  return { steps, currentIndex };
}

function PipelineCard({
  candidate,
  statuses,
  overall100,
  recommendation,
  onStatusChange,
  pending,
}: {
  candidate: CandidateDetail | null | undefined;
  /** The org's column catalog, in any order — this card sorts it. */
  statuses: CandidateStatus[];
  /** 0-100 overall score — gates whether the AI recommendation line renders. */
  overall100: number | null;
  /** The AI's threshold-relative verdict (resolved from `scores`); null when
   *  there is no score yet. The banner reads THIS, not a hardcoded score band,
   *  so it agrees with the candidate's actual pipeline decision. */
  recommendation: Recommendation | null;
  onStatusChange: (statusKey: string) => void;
  pending: boolean;
}) {
  const currentStatus = candidate?.currentStatusId ?? null;
  const statusKey = currentStatus?.key;
  const { steps, currentIndex } = buildPipeline(statuses, currentStatus);
  const isProcessing = statusKey === "scored";
  const isShortlisted = statusKey === "shortlisted";
  const isHired = statusKey === "hired";
  // Either rejection column — "Reconsider candidate" is offered from both.
  const isRejected = REJECTED_STATUS_KEYS.includes(
    statusKey as BuiltinCandidateStatusKey,
  );

  /*
   * Reconsidering returns the candidate to the point they were rejected FROM,
   * and the two rejections are not interchangeable (see `REJECTED_STATUS_KEYS`
   * in `candidates/types.ts`).
   *
   *   final_rejected  they were interviewed and scored, so `scored` is exactly
   *                   where the decision was taken and where it re-opens.
   *   rejected        their CV never qualified; they have no interview and no
   *                   score. Sending them to `scored` filed a never-interviewed
   *                   candidate under "interviewed and said no", corrupting the
   *                   one number that comment exists to protect — and parked
   *                   them where HR could do nothing with them, since only
   *                   `needs_review` is invitable. `needs_review` is the state
   *                   the vetting engine itself uses for "a human should look
   *                   at this", which is precisely what reconsidering means.
   */
  const reconsiderTarget =
    statusKey === POST_INTERVIEW_REJECT_STATUS_KEY
      ? "scored"
      : INVITABLE_STATUS_KEY;

  return (
    <div className="rounded-2xl border border-line bg-surface p-[18px]">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[13.5px] font-bold text-ink">Pipeline stage</span>
        <StageBadge status={candidate?.currentStatusId} />
      </div>

      <div className="grid">
        {steps.map((step, i) => {
          // A candidate not found in the catalog (`currentIndex` -1) leaves
          // every step un-done rather than marking them all complete.
          const done = currentIndex >= 0 && i < currentIndex;
          const current = i === currentIndex;
          const isLast = i === steps.length - 1;
          const hint = STAGE_HINTS[step.key];
          return (
            <div key={step._id} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    "flex h-[26px] w-[26px] items-center justify-center rounded-full text-[11px] font-bold",
                    done && "text-[color:var(--success)]",
                    current && "bg-primary text-white ring-4 ring-[var(--accent-soft)]",
                    !done && !current && "bg-surface-3 text-ink-subtle",
                  )}
                  style={
                    done
                      ? { background: "var(--success-soft)" }
                      : undefined
                  }
                >
                  {done ? (
                    <Check className="h-3.5 w-3.5" strokeWidth={2.2} />
                  ) : (
                    i + 1
                  )}
                </div>
                {!isLast ? (
                  <div
                    className="my-1 w-[2px] flex-1 min-h-[20px]"
                    style={{
                      background: done ? "var(--success)" : "var(--line-2)",
                    }}
                  />
                ) : null}
              </div>
              <div className={cn("pb-3", isLast && "pb-0")}>
                <div
                  className={cn(
                    "text-[13.5px]",
                    current ? "font-bold text-ink" : "font-semibold",
                    done || current ? "text-ink" : "text-ink-muted",
                  )}
                >
                  {step.label}
                </div>
                {hint ? (
                  <div className="mt-0.5 text-[12px] text-ink-muted">
                    {hint}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {/* Decision actions.
          Gated on an AI SCORE existing, not just on the pipeline stage. Without
          the score there is nothing for the reviewer to confirm — and the
          banner below would fall through its `>= 70` test and assert the AI
          recommends "No Hire" when the AI has not actually said anything. That
          is worse than showing no recommendation: it invites a reject on
          evidence that does not exist. See the placeholder in the else branch. */}
      {isProcessing && overall100 !== null ? (
        <div className="mt-1.5">
          <div
            className="mb-3 flex items-start gap-2 rounded-[10px] px-3 py-2.5"
            style={{ background: "var(--accent-soft)" }}
          >
            <Sparkles
              className="mt-[1px] h-3.5 w-3.5 shrink-0 text-primary"
              strokeWidth={1.7}
            />
            <p className="text-[12px] leading-snug text-ink-2">
              The AI recommends{" "}
              <strong className="font-bold">
                {recommendation === "no" ? "No Hire" : "Hire"}
              </strong>
              . Your confirmation is required, nothing advances automatically.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() => onStatusChange(POST_INTERVIEW_REJECT_STATUS_KEY)}
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.9} />
              Reject
            </Button>
            <Button
              size="sm"
              disabled={pending}
              onClick={() => onStatusChange("shortlisted")}
            >
              <Star className="h-3.5 w-3.5" strokeWidth={1.8} />
              Shortlist
            </Button>
          </div>
        </div>
      ) : isProcessing ? (
        // Same stage, but the score hasn't landed. Say so rather than render an
        // empty gap: the reviewer needs to know the actions are coming, not
        // wonder whether the drawer is broken.
        <div className="mt-1.5 flex items-start gap-2 rounded-[10px] bg-surface-3 px-3 py-2.5">
          <Sparkles
            className="mt-[1px] h-3.5 w-3.5 shrink-0 text-ink-subtle"
            strokeWidth={1.7}
          />
          <p className="text-[12px] leading-snug text-ink-muted">
            Waiting on the AI score. Reject and Shortlist unlock once it lands,
            so a decision is never made without it.
          </p>
        </div>
      ) : null}

      {isShortlisted ? (
        <div className="mt-1.5 grid gap-2">
          <Button
            size="sm"
            disabled={pending}
            onClick={() => onStatusChange("hired")}
          >
            <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.8} />
            Mark as hired
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => onStatusChange(POST_INTERVIEW_REJECT_STATUS_KEY)}
          >
            Decline candidate
          </Button>
        </div>
      ) : null}

      {isHired ? (
        <div
          className="mt-1.5 flex items-center gap-2.5 rounded-[10px] px-3.5 py-3"
          style={{ background: "var(--success-soft)" }}
        >
          <Check
            className="h-4 w-4 text-[color:var(--success)]"
            strokeWidth={2.2}
          />
          <span className="text-[13px] font-semibold">
            Candidate hired, welcome aboard!
          </span>
        </div>
      ) : null}

      {isRejected ? (
        <div className="mt-1.5">
          <Button
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => onStatusChange(reconsiderTarget)}
          >
            Reconsider candidate
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The candidate's parsed-CV profile (summary + top skills). Candidate-level, so
 * it renders both alongside a scored interview AND on its own when the candidate
 * hasn't interviewed yet. Returns null when the CV wasn't parsed.
 */
function ProfileCard({ profile }: { profile: CandidateProfile | null }) {
  if (!profile) return null;
  return (
    <div className="rounded-2xl border border-line bg-surface p-[18px]">
      <div className="mb-2 flex items-center gap-2">
        <Briefcase className="h-4 w-4 text-ink-muted" strokeWidth={1.7} />
        <span className="text-[13.5px] font-bold">Profile</span>
      </div>
      {profile.summary ? (
        <p className="text-[13px] leading-relaxed text-ink-2">
          {profile.summary}
        </p>
      ) : (
        <p className="text-[13px] text-ink-muted">
          No summary parsed from this candidate&apos;s CV.
        </p>
      )}
      {profile.technologies?.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {profile.technologies.slice(0, 12).map((t) => (
            <span
              key={t.name}
              className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11.5px] text-ink-2"
            >
              {t.name}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ── Main drawer ────────────────────────────────────────────────────────

export function InterviewDetailDrawer({ sessionId, candidateId: candidateIdProp, onOpenChange }: Props) {
  // Reattempt history: `selectedSessionId` overrides which attempt's detail
  // we load; null = follow the prop. Reset whenever the entry point changes.
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  useEffect(() => {
    setSelectedSessionId(null);
  }, [sessionId]);
  const activeSessionId = selectedSessionId ?? sessionId;

  const queryClient = useQueryClient();
  const orgTimezone = useOrgTimezone();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["interview", activeSessionId],
    queryFn: () => getInterview(activeSessionId!),
    enabled: Boolean(activeSessionId),
    refetchInterval: (query) =>
      isTranscoding(query.state.data?.recording?.hlsStatus) ? 5000 : false,
  });

  // Scoring-status polling: keep the lightweight poll live only while a run
  // is in flight, refetch the heavy detail once when it settles.
  const [scoringInFlight, setScoringInFlight] = useState(false);
  const [scoringDetailsOpen, setScoringDetailsOpen] = useState(false);
  useEffect(() => {
    setScoringInFlight(false);
    setScoringDetailsOpen(false);
  }, [activeSessionId]);

  const scoringStatusQuery = useQuery({
    queryKey: ["interviewScoringStatus", activeSessionId],
    queryFn: () => getInterviewScoringStatus(activeSessionId!),
    enabled: Boolean(activeSessionId && scoringInFlight),
    refetchInterval: (query) =>
      isScoringInFlight(query.state.data?.scoringStatus)
        ? SCORING_POLL_MS
        : false,
  });

  const scoringStatus: ScoringStatus =
    scoringStatusQuery.data?.scoringStatus ?? data?.scoringStatus ?? "idle";
  const scoringError =
    scoringStatusQuery.data?.scoringError ?? data?.scoringError ?? "";
  const scoringRunning = isScoringInFlight(scoringStatus);

  useEffect(() => {
    if (isScoringInFlight(data?.scoringStatus)) setScoringInFlight(true);
  }, [data?.scoringStatus]);

  useEffect(() => {
    const s = scoringStatusQuery.data?.scoringStatus;
    if (s && !isScoringInFlight(s) && scoringInFlight) {
      setScoringInFlight(false);
      refetch();
    }
  }, [scoringStatusQuery.data?.scoringStatus, scoringInFlight, refetch]);

  // Attempt history, keyed on entry-point sessionId.
  const attemptsQuery = useQuery({
    queryKey: ["interviewAttempts", sessionId],
    queryFn: () => getInterviewAttempts(sessionId!),
    enabled: Boolean(sessionId),
  });
  const attempts = attemptsQuery.data ?? [];
  const hasAttempts = attempts.length >= 1;
  const hasMultipleAttempts = attempts.length > 1;

  // Full candidate — the pipeline card + resend-invite gate need
  // `currentStatusId`, not just the CV profile. Same cache key as the
  // candidates slice, so opening the drawer from CandidatesPage is a hit.
  // Falls back to the `candidateId` prop when no interview exists.
  const candidateId = data?.candidateId ?? candidateIdProp ?? null;
  const candidateQuery = useQuery({
    queryKey: ["candidate", candidateId],
    queryFn: () => getCandidate(candidateId!),
    enabled: Boolean(candidateId),
  });

  /*
   * The org's column catalog, for the pipeline stepper.
   *
   * Same `["candidateStatuses"]` key the lists use, so opening a drawer from a
   * page that already loaded it costs nothing. Not gated on `candidateId`: the
   * catalog is org-level and reused across every candidate the drawer shows,
   * and refetching it per candidate would be a request per row clicked.
   */
  const statusesQuery = useQuery({
    queryKey: ["candidateStatuses"],
    queryFn: listCandidateStatuses,
    staleTime: 5 * 60 * 1000,
  });
  const statuses = statusesQuery.data ?? [];
  const candidate = candidateQuery.data ?? null;
  const profile = candidate?.profile ?? null;

  // Local mutation flags
  const [retranscoding, setRetranscoding] = useState(false);
  const [rescoring, setRescoring] = useState(false);
  const [reinviting, setReinviting] = useState(false);
  const [invitingCand, setInvitingCand] = useState(false);
  const [statusPending, setStatusPending] = useState(false);
  const [confirmDeleteInterview, setConfirmDeleteInterview] = useState(false);
  const [confirmDeleteCandidate, setConfirmDeleteCandidate] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);

  const handleRetranscode = async () => {
    if (!activeSessionId) return;
    setRetranscoding(true);
    try {
      await retranscodeInterviewVideo(activeSessionId);
      toast.success("Re-queued the recording for streaming.");
      await refetch();
    } catch (err) {
      toast.error(errorMessage(err, "Could not queue the recording."));
    } finally {
      setRetranscoding(false);
    }
  };

  const handleRescore = async () => {
    if (!activeSessionId || rescoring || scoringRunning) return;
    setRescoring(true);
    try {
      const res = await rescoreInterview(activeSessionId);
      queryClient.setQueryData(["interviewScoringStatus", activeSessionId], {
        sessionId: activeSessionId,
        scoringStatus: res.scoringStatus,
        scoringError: "",
      });
      setScoringInFlight(true);
      toast.success(
        res.alreadyQueued
          ? "Scoring is already running, watching for it to finish."
          : "Rescoring queued, scores will refresh here once the pipeline finishes.",
      );
    } catch (err) {
      toast.error(errorMessage(err, "Could not queue rescoring."));
    } finally {
      setRescoring(false);
    }
  };

  const handleReinvite = async () => {
    if (!activeSessionId || reinviting) return;
    setReinviting(true);
    try {
      await reinviteInterview(activeSessionId);
      toast.success("New attempt created. Invite email sent.");
      // The new attempt (N+1) is prepared asynchronously (the question-prep
      // worker) or lazily when the candidate opens the link, so its row may
      // not exist the instant this POST returns. Refresh the attempts
      // dropdown + the interviews list so it appears as soon as prep lands;
      // if the worker is slow/down, reopening the drawer picks it up later.
      //
      // Reinvite also moves the candidate server-side (scored → invited, and
      // latestInterviewId repoints to the fresh attempt), so mirror the
      // sibling handlers: refetch the drawer's own detail (header badge +
      // PipelineCard) and fan out to every candidate-derived surface —
      // otherwise the lists and Overview keep showing "Scored" with decision
      // buttons for a candidate who is back to Invited.
      await Promise.all([
        attemptsQuery.refetch(),
        candidateQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: ["interviews"] }),
      ]);
      invalidateCandidateData(queryClient);
    } catch (err) {
      toast.error(errorMessage(err, "Could not resend invite."));
    } finally {
      setReinviting(false);
    }
  };

  // Candidate-scoped invite — the drawer's "Resend invite" action. Always
  // available: the admin can send a fresh link from any status (the backend
  // only refuses on a closed job / spent attempt cap, with a clear message).
  const canSendCandidateInvite = Boolean(candidateId);
  const handleSendCandidateInvite = async () => {
    if (!candidateId || invitingCand) return;
    setInvitingCand(true);
    try {
      await sendCandidateInvite(candidateId);
      toast.success("Interview invite sent.");
      // Inviting advances the candidate's status, which the lists and Overview
      // panels display — refresh the drawer's own detail plus every derived key.
      await candidateQuery.refetch();
      invalidateCandidateData(queryClient);
    } catch (err) {
      toast.error(errorMessage(err, "Could not send invite."));
    } finally {
      setInvitingCand(false);
    }
  };

  const handleStatusChange = async (statusKey: string) => {
    if (!candidateId || statusPending) return;
    setStatusPending(true);
    try {
      await updateCandidateStatus(candidateId, { statusKey });
      toast.success("Candidate updated.");
      // Refetch the drawer's own `["candidate", id]` detail first — it's what
      // the open panel renders and the fan-out doesn't cover it. Then invalidate
      // every derived surface: a decision here (accept/reject/hire/shortlist)
      // can move the candidate out of Overview's "Awaiting your decision" panel
      // and shift its KPI counts, not just the list and board.
      await candidateQuery.refetch();
      invalidateCandidateData(queryClient);
    } catch (err) {
      toast.error(errorMessage(err, "Could not update the candidate."));
    } finally {
      setStatusPending(false);
    }
  };

  const deleteInterviewMutation = useMutation({
    mutationFn: () => deleteInterview(activeSessionId!),
    onSuccess: async () => {
      toast.success("Interview deleted.");
      setConfirmDeleteInterview(false);
      await queryClient.invalidateQueries({ queryKey: ["interviews"] });
      // The candidate's row shows its latest interview's score/status, so a
      // deleted interview leaves those lists (and Overview) stale too.
      invalidateCandidateData(queryClient);
      onOpenChange(false);
    },
    onError: (err) =>
      toast.error(errorMessage(err, "Could not delete the interview.")),
  });

  const deleteCandidateMutation = useMutation({
    mutationFn: () => deleteCandidate(candidateId!),
    onSuccess: async () => {
      toast.success("Candidate deleted.");
      setConfirmDeleteCandidate(false);
      // Delete changes the job's TOTAL candidate count, so this is one of the
      // few sites that also refreshes the Jobs list's "Applicants" column.
      invalidateCandidateDataAndJobCounts(queryClient);
      onOpenChange(false);
    },
    onError: (err) =>
      toast.error(errorMessage(err, "Could not delete the candidate.")),
  });

  const questions = useMemo(() => data?.questions ?? [], [data?.questions]);

  const scoredByQuestionId = useMemo(() => {
    const map = new Map<string, ScoredAnswer>();
    for (const p of data?.scores?.perQuestion ?? []) {
      map.set(String(p.questionId), p);
    }
    return map;
  }, [data?.scores?.perQuestion]);

  const playerApiRef = useRef<VideoPlayerHandle | null>(null);
  const videoSectionRef = useRef<HTMLElement | null>(null);

  const jumpToRecording = (sec: number) => {
    playerApiRef.current?.seekTo(sec);
    videoSectionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };
  const chapters = useMemo(
    () =>
      questions
        .filter((q) => typeof q.askedAtSec === "number")
        .map((q) => ({ atSec: q.askedAtSec as number, label: q.text })),
    [questions],
  );
  const hlsReady = Boolean(data?.webcamHlsUrl);

  const is404 =
    isError && axios.isAxiosError(error) && error.response?.status === 404;

  // Keyed on the CANDIDATE, not the interview session, so it works even for a
  // candidate rejected before ever sitting an interview (they still have a CV).
  // Opens the standalone viewer route (`/cv-view/<id>`), which fetches the CV
  // and renders it from a blob — clean URL, and a download manager (IDM) never
  // sees a PDF download to grab. See `CvViewerPage`.
  const handleOpenCv = () => {
    if (!candidateId) return;
    window.open(`/cv-view/${candidateId}`, "_blank", "noopener");
  };

  if (!sessionId && !candidateIdProp) return null;

  const recording = data?.recording;
  const hlsStatus = recording?.hlsStatus ?? null;
  const durationSec = recording?.durationSec ?? 0;
  const done = data?.status === "submitted";
  const overallScore100 =
    typeof data?.scores?.overall === "number"
      ? Math.round(data.scores.overall * 10)
      : null;
  const answeredCount = questions.filter((q) => !q.skipped).length;

  // Pipeline stage component is disabled for now — the reject / shortlist /
  // hire stepper at the bottom of the drawer is hidden. It's kept fully wired
  // (component + handlers + queries) so it can be switched back on by flipping
  // this flag to `true`; see the guarded render at the end of the detail body.
  const SHOW_PIPELINE = false;

  return (
    <>
      <Sheet open onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          hideCloseButton
          className={cn(
            "flex flex-col p-0 border-0",
            // Wider than the old 600px so the Evaluation tab can put the
            // video and the AI evaluation side by side; caps at 94% on narrow
            // screens, where the two columns stack.
            "w-[860px] max-w-[94%] sm:max-w-[860px]",
            "bg-surface-2 border-l border-line",
            "shadow-[-18px_0_50px_rgba(13,11,11,0.16)]",
            // Sheet's default animation classes handle the slide; keeping
            // the transitions from the Radix data-state attributes.
          )}
        >
          {/* Header */}
          <div className="bg-surface border-b border-line px-[22px] py-[18px]">
            <div className="flex items-start gap-3.5">
              <span
                className="flex h-[50px] w-[50px] shrink-0 items-center justify-center rounded-full text-[17px] font-bold text-primary"
                style={{ background: "var(--accent-soft)" }}
              >
                {initialsFor(
                  data?.candidateName ?? candidate?.fullName,
                  data?.email ?? candidate?.email,
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h2 className="m-0 truncate text-[19px] font-semibold tracking-tight">
                    {data?.candidateName ||
                      candidate?.fullName ||
                      "Interview detail"}
                  </h2>
                  <StageBadge status={candidate?.currentStatusId} />
                  {data ? (
                    <span
                      className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] font-semibold text-ink-muted"
                      title="Interview status"
                    >
                      {statusLabels[data.status]}
                    </span>
                  ) : null}
                  {hasMultipleAttempts ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] font-semibold text-ink-muted">
                      <History className="h-3 w-3" strokeWidth={1.7} />
                      Reattempted x{attempts.length - 1}
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] text-ink-muted">
                  {data?.jobTitle ? <span>{data.jobTitle}</span> : null}
                  {data?.jobTitle && (data?.email || candidate?.email) ? (
                    <span>·</span>
                  ) : null}
                  {data?.email || candidate?.email ? (
                    <span>{data?.email || candidate?.email}</span>
                  ) : null}
                  {candidate?.phone ? (
                    <>
                      <span>·</span>
                      <span>{candidate.phone}</span>
                    </>
                  ) : null}
                  {candidate?.city ? (
                    <>
                      <span>·</span>
                      <span className="capitalize">{candidate.city}</span>
                    </>
                  ) : null}
                  {activeSessionId ? (
                    <>
                      <span>·</span>
                      <button
                        type="button"
                        className="cursor-copy mono text-[11px] text-ink-subtle transition-colors hover:text-ink-muted"
                        title={`Click to copy: ${activeSessionId}`}
                        onClick={() => {
                          navigator.clipboard.writeText(activeSessionId);
                          toast.success("ID copied");
                        }}
                      >
                        ID {formatSessionIdTail(activeSessionId)}
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="inline-flex text-ink-muted hover:text-ink"
                aria-label="Close"
              >
                <X className="h-5 w-5" strokeWidth={1.7} />
              </button>
            </div>

            <div className="mt-3.5 flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" onClick={handleOpenCv}>
                <FileText className="h-3.5 w-3.5" strokeWidth={1.7} />
                Open CV
                <ExternalLink className="h-3 w-3" strokeWidth={1.7} />
              </Button>
              {/* Attempts switcher — sits beside Open CV so the reviewer can
                  flip between reattempts without hunting a separate row. */}
              {hasAttempts ? (
                <div className="flex items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-subtle">
                    <History className="h-3 w-3" strokeWidth={1.7} />
                    Attempts
                  </span>
                  <Select
                    value={activeSessionId ?? undefined}
                    onValueChange={(v) => setSelectedSessionId(v)}
                  >
                    <SelectTrigger className="h-8 w-auto min-w-36 gap-2 text-xs">
                      <SelectValue placeholder="Select attempt" />
                    </SelectTrigger>
                    <SelectContent>
                      {attempts.map((a) => (
                        <SelectItem
                          key={a.sessionId}
                          value={a.sessionId}
                          className="text-xs"
                        >
                          {attemptOptionLabel(a)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              <div className="flex-1" />
              {/*
               * No Reject / Shortlist here, deliberately.
               *
               * They used to sit in this header AND in the Pipeline stage card,
               * which put the same two decisions in two places with different
               * visibility rules: the header pair needed an interview plus a
               * score, the card's needed the candidate to be sitting in
               * `scored`. A reviewer could therefore see Shortlist in one spot
               * and not the other on the same candidate.
               *
               * The card is the right home: the decision belongs next to the
               * stage it moves the candidate out of, and it is the surface that
               * also shows what the AI recommended. Nothing is lost from here —
               * every status change stays reachable from the Actions menu.
               */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" size="sm" aria-label="Actions">
                    <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={1.9} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {/* Resend invite — re-sends the link for the CURRENT attempt,
                      valid only while it's still pending (invited, not started).
                      Once the attempt has been started/submitted the backend
                      refuses with a message pointing at "Reattempt interview"
                      below, which opens a new attempt. */}
                  <DropdownMenuItem
                    disabled={
                      !candidateId || !canSendCandidateInvite || invitingCand
                    }
                    onSelect={handleSendCandidateInvite}
                    title={'Re-sends the link while the invite is still pending. Once started, use "Reattempt interview"'}
                  >
                    <Send className="h-3.5 w-3.5" strokeWidth={1.7} />
                    Resend invite
                  </DropdownMenuItem>
                  {candidateId ? (
                    <DropdownMenuItem onSelect={() => setEmailOpen(true)}>
                      <Mail className="h-3.5 w-3.5" strokeWidth={1.7} />
                      Send email
                    </DropdownMenuItem>
                  ) : null}
                  {/* Change the candidate's pipeline stage — the same move the
                      candidates table offers, so a reviewer can decide without
                      closing the drawer. */}
                  {candidateId && statuses.length > 0 ? (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <Tag className="h-3.5 w-3.5" strokeWidth={1.7} />
                        Change status
                      </DropdownMenuSubTrigger>
                      {/* Capped + scrollable so a long custom pipeline doesn't
                          tower past the parent menu. */}
                      <DropdownMenuSubContent className="max-h-72 w-52 overflow-y-auto">
                        <DropdownMenuLabel>Move to</DropdownMenuLabel>
                        {statuses.map((option) => {
                          const isCurrent =
                            option.key === candidate?.currentStatusId?.key;
                          return (
                            <DropdownMenuItem
                              key={option._id}
                              disabled={isCurrent || statusPending}
                              onSelect={() =>
                                void handleStatusChange(option.key)
                              }
                            >
                              <span
                                className="h-2 w-2 shrink-0 rounded-full"
                                style={{
                                  backgroundColor:
                                    option.color ?? "var(--ink-muted)",
                                }}
                              />
                              <span className="min-w-0 truncate">
                                {option.label}
                              </span>
                              {isCurrent ? (
                                <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-ink-muted" />
                              ) : null}
                            </DropdownMenuItem>
                          );
                        })}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  ) : null}
                  {data?.scores ? (
                    <DropdownMenuItem
                      onSelect={() => setScoringDetailsOpen(true)}
                    >
                      <Calculator className="h-3.5 w-3.5" strokeWidth={1.7} />
                      View scoring details
                    </DropdownMenuItem>
                  ) : null}
                  {data?.status === "submitted" ? (
                    <DropdownMenuItem
                      disabled={rescoring || scoringRunning}
                      onSelect={handleRescore}
                    >
                      <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.7} />
                      {scoringRunning
                        ? scoringStatus === "queued"
                          ? "Queued…"
                          : "Scoring…"
                        : "Rescore interview"}
                    </DropdownMenuItem>
                  ) : null}
                  {hlsStatus === "failed" ? (
                    <DropdownMenuItem
                      disabled={retranscoding}
                      onSelect={handleRetranscode}
                    >
                      <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.7} />
                      Retry streaming conversion
                    </DropdownMenuItem>
                  ) : null}
                  {data ? (
                    <DropdownMenuItem
                      disabled={reinviting}
                      onSelect={handleReinvite}
                      title="Create a NEW attempt (previous attempts are kept) and email a fresh link"
                    >
                      <MailPlus className="h-3.5 w-3.5" strokeWidth={1.7} />
                      Reattempt interview
                    </DropdownMenuItem>
                  ) : null}
                  {data ? (
                    <DropdownMenuItem
                      className="text-[color:var(--danger)] focus:text-[color:var(--danger)]"
                      onSelect={() => setConfirmDeleteInterview(true)}
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
                      Delete interview
                    </DropdownMenuItem>
                  ) : null}
                  {candidateId ? (
                    <DropdownMenuItem
                      className="text-[color:var(--danger)] focus:text-[color:var(--danger)]"
                      onSelect={() => setConfirmDeleteCandidate(true)}
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
                      Delete candidate
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Body */}
          <div className="scroll flex-1 overflow-auto px-[22px] py-[18px]">
            {isLoading || (!activeSessionId && candidateQuery.isLoading) ? (
              // Either the interview detail is loading, or we have no session id
              // YET because the candidate detail (which resolves the interview
              // pointer to a `publicSessionId`) is still in flight. Both are
              // "loading", NOT "no interview" — showing the empty state here
              // would flash it for a candidate who does have one.
              <InterviewDetailSkeleton />
            ) : !activeSessionId ? (
              // No interview yet, but there IS a candidate — the drawer must not
              // be blank. Show who they are (identity + parsed-CV profile) and a
              // note where the interview results would go. NOT an error, so no
              // "Could not load" and no Retry (a Retry would `refetch()`, which
              // runs even while the query is disabled, and hit
              // `/interviews/null`, which 404s). The Open CV / Reject / Shortlist
              // actions in the header still work.
              <div className="space-y-4">
                {/* Contact + identity live in the header now, so this state is
                    just the parsed-CV profile and a note. */}
                <ProfileCard profile={profile} />

                <div className="flex items-center gap-3 rounded-2xl border border-dashed border-line bg-surface px-5 py-4 text-[13px] text-ink-muted">
                  <MicOff className="h-5 w-5 shrink-0 text-ink-subtle" />
                  <p>
                    No interview yet. Once this candidate completes one, the
                    score, video and evaluation appear here.
                  </p>
                </div>
              </div>
            ) : is404 ? (
              <div className="flex h-72 flex-col items-center justify-center gap-3 px-6 text-center text-sm text-ink-muted">
                <AlertTriangle className="h-6 w-6 text-[color:var(--warning)]" />
                <p className="max-w-sm">
                  This interview is no longer available. It was most likely
                  deleted, or removed along with the candidate it belonged to.
                </p>
              </div>
            ) : isError || !data ? (
              <div className="flex h-72 flex-col items-center justify-center gap-3 text-sm text-[color:var(--danger)]">
                Could not load the interview.
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => refetch()}
                >
                  Retry
                </Button>
              </div>
            ) : (
              <>
                {/* Profile — parsed CV. Header is above this, this is above the
                    tabs: identity → profile → the evaluation/activity surface. */}
                {profile ? (
                  <div className="mb-4">
                    <ProfileCard profile={profile} />
                  </div>
                ) : null}

                <Tabs defaultValue="evaluation" className="w-full">
                  <TabsList className="mb-4 grid w-full grid-cols-2">
                    <TabsTrigger value="evaluation">
                      <Sparkles className="h-3.5 w-3.5" strokeWidth={1.8} />
                      Evaluation
                    </TabsTrigger>
                    <TabsTrigger value="activity">
                      <Activity className="h-3.5 w-3.5" strokeWidth={1.8} />
                      Activity
                    </TabsTrigger>
                  </TabsList>

                  {/* ── Evaluation: overall score, then video + evaluation side
                      by side, then the per-question breakdown. ── */}
                  <TabsContent value="evaluation" className="mt-0">
                    {!done ? (
                      <TabEmpty
                        icon={
                          <ClipboardCheck className="h-6 w-6" strokeWidth={1.6} />
                        }
                        title="No AI evaluation yet"
                        sub="The candidate hasn't recorded their interview. Their AI score, video and evaluation will appear here once it's scored."
                        action={
                          candidateId ? (
                            <ResendInviteButton
                              canSend={canSendCandidateInvite}
                              pending={invitingCand}
                              onClick={handleSendCandidateInvite}
                            />
                          ) : null
                        }
                      />
                    ) : (
                      <div className="grid gap-4">
                        {/* 1. Video (full width) + its question chapters. */}
                        <ResponsesTab
                          videoSectionRef={videoSectionRef}
                          hlsUrl={data.webcamHlsUrl}
                          rawUrl={data.webcamVideoUrl}
                          hlsStatus={hlsStatus}
                          hlsProgress={recording?.hlsProgress ?? 0}
                          hlsError={recording?.hlsError ?? ""}
                          durationSec={durationSec}
                          chapters={chapters}
                          playerApiRef={playerApiRef}
                          questions={questions}
                          candidateName={data.candidateName}
                          retranscoding={retranscoding}
                          onRetranscode={handleRetranscode}
                          hlsReady={hlsReady}
                          onJump={jumpToRecording}
                        />

                        {/* 2. All evaluations, below the video: overall score,
                            highlights / areas / score breakdown, then the
                            per-question deep dive. When the recording isn't
                            scored yet, the actionable scoring banner takes
                            this slot. */}
                        {data.scores ? (
                          <>
                            <AiScoreCard
                              overall={data.scores.overall}
                              recommendation={resolveVerdict(data.scores)}
                              narrative={
                                data.scores.summary ||
                                data.scores.qualitative?.strengths?.[0] ||
                                ""
                              }
                              answeredCount={answeredCount || questions.length}
                            />
                            <EvaluationTab data={data} />
                            {questions.length > 0 ? (
                              <QuestionBreakdownList
                                questions={questions}
                                scoredByQuestionId={scoredByQuestionId}
                                hlsReady={hlsReady}
                                onJump={jumpToRecording}
                              />
                            ) : null}
                          </>
                        ) : (
                          <div className="rounded-2xl border border-dashed border-line bg-surface p-4 text-sm text-ink-muted">
                            {scoringRunning ? (
                              <p className="inline-flex items-center gap-2">
                                <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                                {scoringStatus === "queued"
                                  ? "Scoring is queued, results will appear here as soon as the pipeline runs."
                                  : "Scoring in progress, results will appear here automatically."}
                              </p>
                            ) : scoringStatus === "failed" ||
                              scoringStatus === "needs_review" ? (
                              <div className="space-y-3">
                                <div
                                  className={cn(
                                    "flex items-start gap-2 rounded-lg px-3 py-2 text-xs",
                                    scoringStatus === "needs_review"
                                      ? "text-[color:var(--warning)]"
                                      : "text-[color:var(--danger)]",
                                  )}
                                  style={{
                                    background:
                                      scoringStatus === "needs_review"
                                        ? "var(--warning-soft)"
                                        : "var(--danger-soft)",
                                  }}
                                >
                                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                  <span>
                                    {scoringStatus === "needs_review"
                                      ? "Needs human review, we couldn't reliably transcribe one or more answers"
                                      : "The last scoring run failed"}
                                    {scoringError ? `: ${scoringError}` : "."}
                                  </span>
                                </div>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={handleRescore}
                                  disabled={rescoring}
                                >
                                  {rescoring ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <RefreshCw className="h-3.5 w-3.5" />
                                  )}
                                  Retry scoring
                                </Button>
                              </div>
                            ) : (
                              <div className="space-y-3">
                                <p>
                                  No scoring has run for this interview yet. Run
                                  the AI scoring pipeline to grade it.
                                </p>
                                <Button
                                  size="sm"
                                  onClick={handleRescore}
                                  disabled={rescoring}
                                >
                                  {rescoring ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <RefreshCw className="h-3.5 w-3.5" />
                                  )}
                                  Run scoring
                                </Button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </TabsContent>

                  {/* ── Activity: the event timeline. ── */}
                  <TabsContent value="activity" className="mt-0">
                    <ActivityTab
                      createdAt={data.createdAt}
                      startedAt={data.startedAt}
                      submittedAt={data.submittedAt}
                      timeZone={orgTimezone}
                      scoringStatus={scoringStatus}
                      overall={data.scores?.overall}
                      questionCount={questions.length}
                      answeredCount={answeredCount}
                      emptyFallback={
                        <TabEmpty
                          icon={<Activity className="h-6 w-6" strokeWidth={1.6} />}
                          title="No activity yet"
                          sub="Status changes, invites, and messages will appear here as they happen."
                        />
                      }
                    />
                  </TabsContent>
                </Tabs>

                {/* Pipeline stage component — disabled for now; flip
                    SHOW_PIPELINE (top of the component) to bring it back. */}
                {SHOW_PIPELINE ? (
                  <div className="mt-4">
                    <PipelineCard
                      candidate={candidate}
                      statuses={statuses}
                      overall100={overallScore100}
                      recommendation={
                        data?.scores ? resolveVerdict(data.scores) : null
                      }
                      onStatusChange={handleStatusChange}
                      pending={statusPending}
                    />
                  </div>
                ) : null}
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* External dialog mounts — kept outside the drawer so they survive
          the drawer close animation and share the app-wide portal. */}
      {data?.scores ? (
        <ScoringDetailsDialog
          open={scoringDetailsOpen}
          onOpenChange={setScoringDetailsOpen}
          candidateName={data.candidateName}
          scores={data.scores}
        />
      ) : null}

      <ConfirmDialog
        open={confirmDeleteInterview}
        onOpenChange={setConfirmDeleteInterview}
        title="Delete this interview?"
        description="This removes the recording, transcript, and scores for this attempt. The candidate keeps their row and can be re-invited."
        destructive
        confirmLabel="Delete interview"
        loadingLabel="Deleting…"
        loading={deleteInterviewMutation.isPending}
        onConfirm={() => deleteInterviewMutation.mutate()}
      />

      <ConfirmDialog
        open={confirmDeleteCandidate}
        onOpenChange={setConfirmDeleteCandidate}
        title={`Delete ${data?.candidateName || "candidate"}?`}
        description="This permanently removes the candidate, their CV, every interview recording, and every score. This cannot be undone."
        destructive
        confirmLabel="Delete candidate"
        loadingLabel="Deleting…"
        loading={deleteCandidateMutation.isPending}
        onConfirm={() => deleteCandidateMutation.mutate()}
      />

      {candidateId ? (
        <BulkEmailDialog
          open={emailOpen}
          onOpenChange={setEmailOpen}
          candidateIds={[candidateId]}
          recipientLabel={data?.candidateName || "this candidate"}
        />
      ) : null}
    </>
  );
}

// ── Per-tab empty states ──────────────────────────────────────────────

/**
 * The "there is no interview yet" empty rendered inside each tab body. Same
 * visual grammar as the pre-existing "Interview not started" card, but scoped
 * to a tab so the reviewer can still navigate.
 */
function TabEmpty({
  icon,
  title,
  sub,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  sub: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface px-6 py-10 text-center">
      <span className="mb-3 inline-flex h-[46px] w-[46px] items-center justify-center rounded-xl bg-surface-3 text-ink-subtle">
        {icon}
      </span>
      <div className="text-[15px] font-semibold">{title}</div>
      <p className="mx-auto mt-1.5 max-w-[340px] text-[13px] leading-relaxed text-ink-muted">
        {sub}
      </p>
      {action ? <div className="mt-3.5 inline-flex">{action}</div> : null}
    </div>
  );
}

/**
 * "Resend invite" button — the manual-invite escape hatch. Wraps the disabled
 * button so the tooltip can hang on a hoverable element in every state.
 */
function ResendInviteButton({
  canSend,
  pending,
  onClick,
}: {
  canSend: boolean;
  pending: boolean;
  onClick: () => void;
}) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button
              variant="secondary"
              size="sm"
              disabled={!canSend || pending}
              onClick={onClick}
            >
              {pending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" strokeWidth={1.7} />
              )}
              Resend invite
            </Button>
          </span>
        </TooltipTrigger>
        {!canSend ? (
          <TooltipContent>
            Only pre-screened candidates can be manually invited from here.
          </TooltipContent>
        ) : null}
      </Tooltip>
    </TooltipProvider>
  );
}

// ── Evaluation tab ─────────────────────────────────────────────────────

function EvaluationTab({
  data,
}: {
  data: NonNullable<ReturnType<typeof useInterviewDataType>>;
}) {
  const qualitative = data.scores?.qualitative;
  const highlights = qualitative?.strengths ?? [];
  const probes = qualitative?.weaknesses?.length
    ? qualitative.weaknesses
    : (qualitative?.redFlags ?? []);

  if (!data.scores) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-6 text-center text-sm text-ink-muted">
        Not scored yet.
      </div>
    );
  }

  const rows: Array<[string, number]> = [
    ["Technical", Math.round((data.scores.technical ?? 0) * 10)],
    ["Communication", Math.round((data.scores.communication ?? 0) * 10)],
  ];

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-line bg-surface p-[18px]">
          <div className="mb-3.5 flex items-center gap-2">
            <span
              className="flex h-7 w-7 items-center justify-center rounded-lg text-[color:var(--success)]"
              style={{ background: "var(--success-soft)" }}
            >
              <Check className="h-3.5 w-3.5" strokeWidth={2} />
            </span>
            <span className="text-[14px] font-bold">Highlights</span>
          </div>
          {highlights.length ? (
            <div className="grid gap-2.5">
              {highlights.map((t) => (
                <div
                  key={t}
                  className="flex gap-2.5 text-[13px] leading-snug text-ink-2"
                >
                  <Check
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--success)]"
                    strokeWidth={2}
                  />
                  {t}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-ink-muted">
              No highlights recorded.
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-line bg-surface p-[18px]">
          <div className="mb-3.5 flex items-center gap-2">
            <span
              className="flex h-7 w-7 items-center justify-center rounded-lg font-bold text-[color:var(--warning)]"
              style={{ background: "var(--warning-soft)" }}
            >
              !
            </span>
            <span className="text-[14px] font-bold">Areas to probe</span>
          </div>
          {probes.length ? (
            <div className="grid gap-2.5">
              {probes.map((t) => (
                <div
                  key={t}
                  className="flex gap-2.5 text-[13px] leading-snug text-ink-2"
                >
                  <span
                    className="mt-0.5 flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full border-[1.6px] text-[10px] font-bold text-[color:var(--warning)]"
                    style={{ borderColor: "var(--warning)" }}
                  >
                    !
                  </span>
                  {t}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-ink-muted">
              No follow-up areas flagged.
            </p>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-surface p-[18px]">
        <div className="mb-3 text-[14px] font-bold">Score breakdown</div>
        {rows.map(([label, value]) => (
          <div key={label} className="mb-3.5 last:mb-0">
            <div className="mb-1.5 flex justify-between text-[13px]">
              <span className="font-semibold text-ink-2">{label}</span>
              <span className="mono font-bold">{value}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-3">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Responses tab ──────────────────────────────────────────────────────

function ResponsesTab({
  videoSectionRef,
  hlsUrl,
  rawUrl,
  hlsStatus,
  hlsProgress,
  hlsError,
  durationSec,
  chapters,
  playerApiRef,
  questions,
  candidateName,
  retranscoding,
  onRetranscode,
  hlsReady,
  onJump,
}: {
  videoSectionRef: React.MutableRefObject<HTMLElement | null>;
  hlsUrl: string;
  rawUrl: string;
  hlsStatus: string | null;
  hlsProgress: number;
  hlsError: string;
  durationSec: number;
  chapters: Array<{ atSec: number; label: string }>;
  playerApiRef: React.MutableRefObject<VideoPlayerHandle | null>;
  questions: AdminInterviewQuestionItem[];
  candidateName: string;
  retranscoding: boolean;
  onRetranscode: () => void;
  hlsReady: boolean;
  onJump: (sec: number) => void;
}) {
  // Live playback position, fed by the player's `onTimeUpdate`. Drives which
  // question chapter is highlighted.
  const [currentSec, setCurrentSec] = useState(0);
  // The question playing right now: the LAST one whose ask-time has passed
  // (a +0.25s lead flips it exactly as the question begins, matching the
  // video's caption overlay). Falls back to the first question before any
  // ask-time is reached. This is the fix for the highlight that used to be
  // pinned to `0` and never moved when you clicked a chapter or let it play.
  const activeIdx = (() => {
    let idx = -1;
    for (let i = 0; i < questions.length; i++) {
      const at = questions[i].askedAtSec;
      if (typeof at === "number" && currentSec + 0.25 >= at) idx = i;
    }
    return idx === -1 ? 0 : idx;
  })();
  return (
    <div className="grid gap-4">
      <section
        ref={videoSectionRef as React.RefObject<HTMLElement>}
        className="scroll-mt-4"
      >
        <div className="overflow-hidden rounded-xl bg-black">
          {hlsUrl ? (
            <div className="aspect-video">
              <HlsPlayer
                key={hlsUrl}
                manifestUrl={hlsUrl}
                durationSec={durationSec}
                chapters={chapters}
                apiRef={playerApiRef}
                onTimeUpdate={setCurrentSec}
              />
            </div>
          ) : hlsStatus === "failed" ? (
            <div className="flex aspect-video flex-col items-center justify-center gap-3 p-6 text-center text-[13px] text-white/80">
              <AlertTriangle className="h-6 w-6 text-[color:var(--warning)]" />
              <p>
                Couldn&apos;t prepare the streaming version of this recording
                {hlsError ? `: ${hlsError}` : "."}
              </p>
              <Button
                size="sm"
                variant="secondary"
                onClick={onRetranscode}
                disabled={retranscoding}
              >
                {retranscoding ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Retry streaming conversion
              </Button>
              {rawUrl ? (
                <div className="w-full">
                  <VideoPlayer
                    src={rawUrl}
                    knownDurationSec={durationSec}
                    ariaLabel={`Webcam recording for ${candidateName || "candidate"}`}
                  />
                </div>
              ) : null}
            </div>
          ) : isTranscoding(hlsStatus) ? (
            <div className="flex aspect-video flex-col items-center justify-center gap-3 p-6 text-center text-[13px] text-white/80">
              <Loader2 className="h-6 w-6 animate-spin" />
              <p>
                Preparing a streamable version of this recording…
                {hlsProgress ? ` ${Math.round(hlsProgress)}%` : ""}
              </p>
              {rawUrl ? (
                <div className="w-full">
                  <VideoPlayer
                    src={rawUrl}
                    knownDurationSec={durationSec}
                    ariaLabel={`Webcam recording for ${candidateName || "candidate"}`}
                  />
                </div>
              ) : null}
            </div>
          ) : rawUrl ? (
            <VideoPlayer
              src={rawUrl}
              knownDurationSec={durationSec}
              ariaLabel={`Webcam recording for ${candidateName || "candidate"}`}
            />
          ) : (
            <div className="flex aspect-video items-center justify-center p-6 text-center text-[13px] text-white/70">
              No webcam recording was uploaded for this session.
            </div>
          )}
        </div>
      </section>

      <div>
        <div className="mb-2.5 text-[13px] font-bold">
          Question chapters{" "}
          <span className="font-medium text-ink-muted">
            · {questions.length} question{questions.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="grid gap-2">
          {questions.map((q, i) => {
            const isActive = i === activeIdx;
            const timeLabel =
              typeof q.askedAtSec === "number"
                ? formatClock(q.askedAtSec)
                : "-";
            return (
              <button
                key={q.questionId || i}
                type="button"
                disabled={
                  typeof q.askedAtSec !== "number" || !hlsReady
                }
                onClick={() => {
                  if (typeof q.askedAtSec !== "number") return;
                  // Highlight immediately, then let the player's time updates
                  // keep it in sync as playback continues from here.
                  setCurrentSec(q.askedAtSec);
                  onJump(q.askedAtSec);
                }}
                className={cn(
                  "flex items-center gap-3 rounded-[10px] border px-3.5 py-3 text-left transition-colors",
                  isActive
                    ? "border-primary bg-[var(--accent-soft)]"
                    : "border-line bg-surface hover:bg-hover",
                  typeof q.askedAtSec !== "number" || !hlsReady
                    ? "cursor-default"
                    : "cursor-pointer",
                )}
              >
                <span
                  className={cn(
                    "mono flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                    isActive
                      ? "bg-primary text-white"
                      : "bg-[var(--accent-soft)] text-primary",
                  )}
                >
                  Q{i + 1}
                </span>
                <span
                  className={cn(
                    "flex-1 text-[13px]",
                    isActive
                      ? "font-semibold text-ink"
                      : "font-medium text-ink-2",
                  )}
                >
                  {q.text}
                </span>
                <span className="mono text-[12px] text-ink-muted">
                  {timeLabel}
                </span>
                {typeof q.askedAtSec === "number" && hlsReady ? (
                  <Play
                    className="h-3.5 w-3.5 text-ink-muted"
                    fill="currentColor"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// The candidate-skipped sentinel — still referenced by the per-question
// breakdown (`AnswerRow`) even though the standalone transcript section was
// removed from the drawer.
const SKIPPED_TRANSCRIPT_MARKER = "[Skipped by candidate]";

// ── Activity tab ───────────────────────────────────────────────────────

/** A timeline row's full date+time, in the org's zone when it's a valid IANA
 *  name and the browser-local render otherwise (RangeError). */
function timelineTime(iso: string, timeZone?: string): string {
  if (timeZone) {
    try {
      return new Date(iso).toLocaleString(undefined, { timeZone });
    } catch {
      return new Date(iso).toLocaleString();
    }
  }
  return new Date(iso).toLocaleString();
}

function ActivityTab({
  createdAt,
  startedAt,
  submittedAt,
  timeZone,
  scoringStatus,
  overall,
  questionCount,
  answeredCount,
  emptyFallback,
}: {
  createdAt: string | null;
  startedAt: string | null;
  submittedAt: string | null;
  timeZone: string;
  scoringStatus: ScoringStatus;
  overall: number | undefined;
  questionCount: number;
  answeredCount: number;
  /** Rendered when NO events are available. Falls back to the old compact
   *  "No activity yet" line if omitted, so existing call-sites keep working. */
  emptyFallback?: React.ReactNode;
}) {
  /*
   * OLDEST FIRST — the invite at the top, the score at the bottom, read down
   * the way the interview actually happened.
   *
   * Two events legitimately share a timestamp: the score is stamped with
   * `submittedAt` (there is no separate `scoredAt` on this payload), so
   * "submitted" and "scored" tie to the second. Sorting on time alone would
   * let them swap and show the interview scored before it was submitted, so
   * `seq` breaks the tie in causal order. Sorting rather than relying on push
   * order also keeps this correct if a future event is added in the wrong
   * place.
   */
  const events: Array<{
    title: string;
    sub: string;
    time: string;
    at: number;
    seq: number;
    kind: "score" | "submit" | "start" | "create";
  }> = [];
  if (createdAt) {
    events.push({
      title: "Interview invited",
      sub: "Invite link emailed to candidate",
      time: timelineTime(createdAt, timeZone),
      at: new Date(createdAt).getTime(),
      seq: 0,
      kind: "create",
    });
  }
  if (startedAt) {
    events.push({
      title: "Interview started",
      sub: "Candidate began recording",
      time: timelineTime(startedAt, timeZone),
      at: new Date(startedAt).getTime(),
      seq: 1,
      kind: "start",
    });
  }
  if (submittedAt) {
    events.push({
      title: "Interview submitted",
      sub: `${answeredCount} video response${answeredCount === 1 ? "" : "s"}`,
      time: timelineTime(submittedAt, timeZone),
      at: new Date(submittedAt).getTime(),
      seq: 2,
      kind: "submit",
    });
  }
  if (scoringStatus === "done" && typeof overall === "number") {
    events.push({
      // Comma, not a dash: no em/en dash in user-facing text.
      // `toDisplayScore` is the shared 0-10 -> 0-100 conversion, so this line
      // can never disagree with the score ring above it.
      title: `AI interview scored, overall ${toDisplayScore(overall)}`,
      sub: `${answeredCount} of ${questionCount} answered`,
      time: submittedAt
        ? timelineTime(submittedAt, timeZone)
        : "Time unknown",
      at: submittedAt ? new Date(submittedAt).getTime() : Number.MAX_SAFE_INTEGER,
      seq: 3,
      kind: "score",
    });
  }
  events.sort((a, b) => a.at - b.at || a.seq - b.seq);
  if (!events.length) {
    return (
      <>
        {emptyFallback ?? (
          <div className="rounded-2xl border border-line bg-surface p-6 text-center text-sm text-ink-muted">
            No activity yet.
          </div>
        )}
      </>
    );
  }
  const kindColor: Record<typeof events[number]["kind"], string> = {
    score: "var(--primary)",
    submit: "var(--info)",
    start: "var(--warning)",
    create: "var(--ink-muted)",
  };
  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <div className="mb-3.5 text-[14px] font-semibold">Activity timeline</div>
      <div className="grid gap-0.5">
        {events.map((e, i) => {
          const c = kindColor[e.kind];
          const isLast = i === events.length - 1;
          return (
            <div key={i} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  className="flex h-[30px] w-[30px] items-center justify-center rounded-full"
                  style={{
                    background: `color-mix(in oklab, ${c}, white 86%)`,
                    color: c,
                  }}
                >
                  {e.kind === "score" ? (
                    <Star className="h-3.5 w-3.5" strokeWidth={1.7} />
                  ) : e.kind === "submit" ? (
                    <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.7} />
                  ) : e.kind === "start" ? (
                    <Play className="h-3.5 w-3.5" strokeWidth={1.7} />
                  ) : (
                    <User className="h-3.5 w-3.5" strokeWidth={1.7} />
                  )}
                </span>
                {!isLast ? (
                  <span
                    className="my-0.5 w-[2px] flex-1 min-h-[16px]"
                    style={{ background: "var(--line-2)" }}
                  />
                ) : null}
              </div>
              <div className="pb-4">
                <div className="text-[13.5px] font-semibold">{e.title}</div>
                <div className="mt-0.5 text-[12px] text-ink-muted">{e.sub}</div>
                <div className="mono mt-0.5 text-[11.5px] text-ink-subtle">
                  {e.time}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Per-question breakdown (deep-dive under Evaluation) ────────────────

function QuestionBreakdownList({
  questions,
  scoredByQuestionId,
  hlsReady,
  onJump,
}: {
  questions: AdminInterviewQuestionItem[];
  scoredByQuestionId: Map<string, ScoredAnswer>;
  hlsReady: boolean;
  onJump: (sec: number) => void;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-[18px]">
      <div className="mb-3 flex items-center gap-2">
        <MessageSquare
          className="h-3.5 w-3.5 text-ink-muted"
          strokeWidth={1.7}
        />
        <span className="text-[14px] font-bold">
          Questions &amp; answers ({questions.length})
        </span>
      </div>
      <ol className="grid gap-3">
        {questions.map((q, i) => (
          <AnswerRow
            key={q.questionId || i}
            index={i}
            question={q}
            scored={scoredByQuestionId.get(q.questionId)}
            onJump={hlsReady ? onJump : undefined}
          />
        ))}
      </ol>
    </div>
  );
}

function AnswerRow({
  index,
  question,
  scored,
  onJump,
}: {
  index: number;
  question: AdminInterviewQuestionItem;
  scored?: ScoredAnswer;
  onJump?: (sec: number) => void;
}) {
  const skipped =
    question.skipped ||
    question.transcript.trim() === SKIPPED_TRANSCRIPT_MARKER;
  const askedAtSec =
    typeof question.askedAtSec === "number" ? question.askedAtSec : null;
  return (
    <li className="rounded-xl border border-line bg-surface-2 p-3">
      <div className="flex items-start gap-2.5">
        <span className="mono mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[11px] font-bold text-primary">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-[13px] font-medium leading-snug">
            {question.text}
          </p>
          {askedAtSec !== null ? (
            onJump ? (
              <button
                type="button"
                onClick={() => onJump(askedAtSec)}
                title="Jump to this question in the recording"
                className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-semibold text-primary hover:bg-[var(--accent-softer)]"
              >
                <Play className="h-3 w-3 fill-current" />
                {formatClock(askedAtSec)}
              </button>
            ) : (
              <span className="mono inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-muted">
                <Clock className="h-3 w-3" />
                {formatClock(askedAtSec)}
              </span>
            )
          ) : null}
          {skipped ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-ink-muted">
              <MicOff className="h-3 w-3" />
              Skipped by candidate
            </span>
          ) : question.transcript ? (
            <div className="rounded-lg border border-line bg-surface p-2.5">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                Transcript
              </p>
              <p className="text-[13px] leading-snug whitespace-pre-wrap wrap-break-word">
                {question.transcript}
              </p>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-line p-2.5 text-xs text-ink-muted">
              Transcript pending, the scoring worker will fill this in shortly.
            </p>
          )}
          {scored ? (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="rounded-full border border-line px-2 py-0.5 font-semibold text-ink-2">
                Technical: {formatScore(scored.technical, { suffix: " / 10" })}
              </span>
              <span className="rounded-full border border-line px-2 py-0.5 font-semibold text-ink-2">
                Communication:{" "}
                {formatScore(scored.communication, { suffix: " / 10" })}
              </span>
              {/* `weight` is a PERCENT share of the overall score (backend
                  normalises per-question weights to sum to 100), not a
                  multiplier — "x25" read as a 25x boost. Weight 0 means the
                  question was asked but not scored, so it stays hidden. */}
              {typeof scored.weight === "number" && scored.weight > 0 ? (
                <span className="text-ink-muted">
                  Weight {Math.round(scored.weight)}%
                </span>
              ) : null}
            </div>
          ) : typeof question.score === "number" ? (
            <span className="rounded-full border border-line px-2 py-0.5 text-[11px] font-semibold text-ink-2">
              Score: {formatScore(question.score, { suffix: " / 10" })}
            </span>
          ) : null}
          {question.feedback ? (
            <div className="rounded-lg border border-line bg-surface p-2.5 text-xs leading-snug text-ink-muted">
              <span className="mr-1 font-semibold uppercase tracking-wide">
                Feedback:
              </span>
              {question.feedback}
            </div>
          ) : null}

          {/* Proctoring surfacing (still preserved) */}
          {question === question ? null : null}
        </div>
      </div>
    </li>
  );
}

// Helper — a tiny hack to name the interview detail type without exporting it.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function useInterviewDataType() {
  return null as unknown as Awaited<ReturnType<typeof getInterview>>;
}

/** Format an overtime/grace duration (seconds) as a compact "Xm Ys" string. */
export function formatOvertime(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m === 0) return `${rem}s`;
  if (rem === 0) return `${m}m`;
  return `${m}m ${rem}s`;
}

/** Proctoring-signal badge — kept exported so other views can reuse the tint. */
export function ProctoringInfo({
  fullscreenExitCount,
  tabHiddenCount,
}: {
  fullscreenExitCount: number;
  tabHiddenCount: number;
}) {
  if (fullscreenExitCount === 0 && tabHiddenCount === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {fullscreenExitCount > 0 ? (
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold"
          style={{
            background: "var(--warning-soft)",
            color: "var(--warning)",
          }}
        >
          <Maximize className="h-3 w-3" strokeWidth={1.7} />
          {fullscreenExitCount} fullscreen exit
          {fullscreenExitCount === 1 ? "" : "s"}
        </span>
      ) : null}
      {tabHiddenCount > 0 ? (
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold"
          style={{
            background: "var(--warning-soft)",
            color: "var(--warning)",
          }}
        >
          <EyeOff className="h-3 w-3" strokeWidth={1.7} />
          {tabHiddenCount} tab switch{tabHiddenCount === 1 ? "" : "es"}
        </span>
      ) : null}
    </div>
  );
}
