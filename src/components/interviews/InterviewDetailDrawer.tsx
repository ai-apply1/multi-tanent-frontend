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
  Download,
  ExternalLink,
  EyeOff,
  FileArchive,
  FileText,
  History,
  Loader2,
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
  Trash2,
  User,
  Video,
  X,
} from "lucide-react";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { ScoringDetailsDialog } from "@/components/interviews/ScoringDetailsDialog";
import {
  HlsPlayer,
  type VideoPlayerHandle,
} from "@/components/interviews/HlsPlayer";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
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
  DropdownMenuSeparator,
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
  downloadInterviewAnswersAudio,
  downloadInterviewVideo,
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
import { invalidateCandidateData } from "@/features/candidates/candidatesCache";
import { toDisplayScore } from "@/features/candidates/aiScore";
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

/** Sanitise a candidate name/email into a safe download filename stem. */
function fileSafe(name: string | null | undefined): string {
  const base = (name ?? "candidate")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .slice(0, 60);
  return base || "candidate";
}

/** How often the lightweight scoring-status endpoint is polled. */
const SCORING_POLL_MS = 4000;

function isScoringInFlight(s?: ScoringStatus | null): boolean {
  return s === "queued" || s === "processing";
}

function isTranscoding(s?: string | null): boolean {
  return s === "pending" || s === "processing";
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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

/** Score-band color used by the ring + reco chip. `overall` is 0-10. */
function scoreBandColor(overall100: number): string {
  if (overall100 >= 86) return "var(--success)";
  if (overall100 >= 70) return "var(--primary)";
  if (overall100 >= 60) return "var(--warning)";
  return "var(--danger)";
}

/** Recommendation label + tone based on a 0-100 overall score. */
function recommendationFrom(overall100: number): {
  label: string;
  bg: string;
  fg: string;
} {
  if (overall100 >= 86)
    return {
      label: "Strong Hire",
      bg: "var(--success-soft)",
      fg: "var(--success)",
    };
  if (overall100 >= 70)
    return { label: "Hire", bg: "var(--success-soft)", fg: "var(--success)" };
  if (overall100 >= 60)
    return { label: "Maybe", bg: "var(--warning-soft)", fg: "var(--warning)" };
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
  narrative,
  answeredCount,
}: {
  /** 0-10 (backend scale). */
  overall: number;
  narrative: string;
  answeredCount: number;
}) {
  // Shared with the candidate tables' score cell. The 0-10 → 0-100 conversion
  // lived only here while the tables had no number at all; now that they do,
  // one copy of the maths is what keeps the drawer and the list from
  // disagreeing about the same candidate.
  const score = toDisplayScore(overall);
  const color = scoreBandColor(score);
  const reco = recommendationFrom(score);
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
  onStatusChange,
  pending,
}: {
  candidate: CandidateDetail | null | undefined;
  /** The org's column catalog, in any order — this card sorts it. */
  statuses: CandidateStatus[];
  /** 0-100 overall score — used to render the AI recommendation line. */
  overall100: number | null;
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
                {overall100 >= 70 ? "Hire" : "No Hire"}
              </strong>
              . Your confirmation is required — nothing advances automatically.
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
            Candidate hired — welcome aboard!
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

/** One labelled contact field (Email / Phone / City) in the no-interview view. */
function ContactField({
  label,
  value,
  capitalize,
}: {
  label: string;
  value: string | null | undefined;
  capitalize?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
        {label}
      </div>
      <div
        className={cn(
          "truncate text-[13px]",
          value ? "text-ink-2" : "text-ink-muted",
          capitalize && "capitalize",
        )}
      >
        {value || "Not provided"}
      </div>
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
  const [downloadingAudio, setDownloadingAudio] = useState(false);
  const [downloadingVideo, setDownloadingVideo] = useState(false);
  const [reinviting, setReinviting] = useState(false);
  const [invitingCand, setInvitingCand] = useState(false);
  const [statusPending, setStatusPending] = useState(false);
  const [confirmDeleteInterview, setConfirmDeleteInterview] = useState(false);
  const [confirmDeleteCandidate, setConfirmDeleteCandidate] = useState(false);

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
          ? "Scoring is already running — watching for it to finish."
          : "Rescoring queued — scores will refresh here once the pipeline finishes.",
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
      toast.success("Fresh invite email sent.");
    } catch (err) {
      toast.error(errorMessage(err, "Could not resend invite."));
    } finally {
      setReinviting(false);
    }
  };

  // Candidate-scoped invite — the drawer's "Resend invite" empty-state action.
  // Only pre-screened candidates can be manually invited (API returns 409
  // otherwise), so the button is disabled with a tooltip in every other state.
  const canSendCandidateInvite =
    candidate?.currentStatusId.key === INVITABLE_STATUS_KEY;
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
      invalidateCandidateData(queryClient);
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

  const handleExportJson = () => {
    if (!data) return;
    const payload = {
      candidateName: data.candidateName,
      email: data.email,
      sessionId: data.sessionId,
      jobTitle: data.jobTitle,
      attemptNumber: data.attemptNumber,
      status: data.status,
      scoringStatus: data.scoringStatus,
      startedAt: data.startedAt,
      submittedAt: data.submittedAt,
      scores: data.scores ?? null,
      questions: questions.map((q, i) => ({
        number: i + 1,
        questionId: q.questionId,
        asked: q.text,
        answer: q.transcript,
        skipped: q.skipped,
        score: q.score,
        feedback: q.feedback,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    downloadBlob(
      blob,
      `interview-${fileSafe(data.candidateName || data.email || activeSessionId)}.json`,
    );
    toast.success("Exported interview data.");
  };

  const handleDownloadAudios = async () => {
    if (!activeSessionId || downloadingAudio) return;
    setDownloadingAudio(true);
    const toastId = toast.loading("Preparing audio download…");
    try {
      const blob = await downloadInterviewAnswersAudio(activeSessionId);
      downloadBlob(
        blob,
        `interview-audio-${fileSafe(data?.candidateName || data?.email || activeSessionId)}.zip`,
      );
      toast.success("Audio download ready.", { id: toastId });
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      const message =
        status === 404
          ? "No answer audio is available for this interview."
          : "Could not download audio. Please try again.";
      toast.error(message, { id: toastId });
    } finally {
      setDownloadingAudio(false);
    }
  };

  const handleDownloadVideo = async () => {
    if (!activeSessionId || downloadingVideo) return;
    setDownloadingVideo(true);
    const toastId = toast.loading("Preparing video download…");
    try {
      const blob = await downloadInterviewVideo(activeSessionId);
      const ext = blob.type.includes("mp4")
        ? "mp4"
        : blob.type.includes("webm")
          ? "webm"
          : blob.type.includes("matroska")
            ? "mkv"
            : "mp4";
      downloadBlob(
        blob,
        `interview-video-${fileSafe(data?.candidateName || data?.email || activeSessionId)}.${ext}`,
      );
      toast.success("Video download ready.", { id: toastId });
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      const message =
        status === 404
          ? "No recording is available to download for this interview yet."
          : "Could not download the video. Please try again.";
      toast.error(message, { id: toastId });
    } finally {
      setDownloadingVideo(false);
    }
  };

  // ── Tabs ──────────────────────────────────────────────────────────────

  const [tab, setTab] = useState<
    "evaluation" | "responses" | "transcript" | "activity"
  >("evaluation");
  useEffect(() => {
    setTab("evaluation");
  }, [activeSessionId]);

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

  return (
    <>
      <Sheet open onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          hideCloseButton
          className={cn(
            "flex flex-col p-0 border-0",
            "w-[600px] max-w-[94%] sm:max-w-[600px]",
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
                  {data?.jobTitle && data?.email ? <span>·</span> : null}
                  {data?.email ? <span>{data.email}</span> : null}
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
                  {/* Resend invite — candidate-level, only offered while the
                      status is still `needs_review` (the API 409s otherwise).
                      Disabled with a note in every other state so the reason
                      is visible without another click. */}
                  <DropdownMenuItem
                    disabled={
                      !candidateId || !canSendCandidateInvite || invitingCand
                    }
                    onSelect={handleSendCandidateInvite}
                    title={
                      canSendCandidateInvite
                        ? undefined
                        : "Only pre-screened candidates can be manually invited."
                    }
                  >
                    <Send className="h-3.5 w-3.5" strokeWidth={1.7} />
                    Resend invite
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!data?.email}
                    onSelect={() => {
                      if (data?.email) {
                        window.location.href = `mailto:${data.email}`;
                      }
                    }}
                  >
                    <MailPlus className="h-3.5 w-3.5" strokeWidth={1.7} />
                    Send email/SMS
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
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
                    >
                      <MailPlus className="h-3.5 w-3.5" strokeWidth={1.7} />
                      Reinvite (this attempt)
                    </DropdownMenuItem>
                  ) : null}
                  {data ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={handleExportJson}>
                        <Download className="h-3.5 w-3.5" strokeWidth={1.7} />
                        Export JSON
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={downloadingVideo}
                        onSelect={handleDownloadVideo}
                      >
                        <Video className="h-3.5 w-3.5" strokeWidth={1.7} />
                        Download video
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={downloadingAudio}
                        onSelect={handleDownloadAudios}
                      >
                        <FileArchive className="h-3.5 w-3.5" strokeWidth={1.7} />
                        Download answer audios
                      </DropdownMenuItem>
                    </>
                  ) : null}
                  <DropdownMenuSeparator />
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

            {hasAttempts ? (
              <div className="mt-3 flex items-center gap-2">
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-subtle">
                  <History className="h-3 w-3" strokeWidth={1.7} />
                  Attempts
                </span>
                <Select
                  value={activeSessionId ?? undefined}
                  onValueChange={(v) => setSelectedSessionId(v)}
                >
                  <SelectTrigger className="h-7 w-auto min-w-40 gap-2 text-xs">
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
                {/* Contact — the header already carries the name + avatar, so
                    this is just the reachable details. */}
                {candidate ? (
                  <div className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-2xl border border-line bg-surface p-[18px] sm:grid-cols-3">
                    <ContactField label="Email" value={candidate.email} />
                    <ContactField label="Phone" value={candidate.phone} />
                    <ContactField
                      label="City"
                      value={candidate.city}
                      capitalize
                    />
                  </div>
                ) : null}

                <ProfileCard profile={profile} />

                <div className="flex items-center gap-3 rounded-2xl border border-dashed border-line bg-surface px-5 py-4 text-[13px] text-ink-muted">
                  <MicOff className="h-5 w-5 shrink-0 text-ink-subtle" />
                  <p>
                    No interview yet. Once this candidate completes one, the
                    score, responses and transcript appear here.
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
                {/* AI Score card (only when interview is done) */}
                {done && data.scores ? (
                  <div className="mb-4">
                    <AiScoreCard
                      overall={data.scores.overall}
                      narrative={
                        data.scores.summary ||
                        data.scores.qualitative?.strengths?.[0] ||
                        ""
                      }
                      answeredCount={answeredCount || questions.length}
                    />
                  </div>
                ) : null}

                {/* Scoring in-flight / failed banners */}
                {done && !data.scores ? (
                  <div className="mb-4 rounded-2xl border border-dashed border-line bg-surface p-4 text-sm text-ink-muted">
                    {scoringRunning ? (
                      <p className="inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                        {scoringStatus === "queued"
                          ? "Scoring is queued — results will appear here as soon as the pipeline runs."
                          : "Scoring in progress — results will appear here automatically."}
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
                              ? "Needs human review — we couldn't reliably transcribe one or more answers"
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
                          No scoring has run for this interview yet. Run the AI
                          scoring pipeline to grade it.
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
                ) : null}

                {/* Profile — parsed CV. Sits ABOVE the tabs so the reviewer
                    sees who the candidate is before diving into the AI
                    evaluation surface. */}
                {profile ? (
                  <div className="mb-4">
                    <ProfileCard profile={profile} />
                  </div>
                ) : null}

                {/* Segmented tabs */}
                <div className="mb-4 flex gap-1 rounded-xl border border-line bg-surface p-1.5">
                  {(
                    [
                      ["evaluation", "Evaluation"],
                      ["responses", "Responses"],
                      ["transcript", "Transcript"],
                      ["activity", "Activity"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setTab(id)}
                      className={cn(
                        "flex-1 rounded-lg px-1.5 py-2 text-[12.5px] font-semibold transition-colors",
                        tab === id
                          ? "bg-[var(--accent-soft)] text-primary"
                          : "text-ink-muted hover:text-ink",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Per-tab body — the tab bar itself always renders (above),
                    so each tab owns its own empty state instead of one big
                    "Interview not started" card obscuring the navigation. */}
                {tab === "evaluation" ? (
                  done && data.scores ? (
                    <>
                      <EvaluationTab data={data} />
                      {/* Per-question breakdown lives on the Evaluation tab as
                          the deep-dive block, since the design expects it
                          near the score. */}
                      {questions.length > 0 ? (
                        <div className="mt-4">
                          <QuestionBreakdownList
                            questions={questions}
                            scoredByQuestionId={scoredByQuestionId}
                            hlsReady={hlsReady}
                            onJump={jumpToRecording}
                          />
                        </div>
                      ) : null}
                    </>
                  ) : done ? (
                    // Interview submitted but not scored yet — subtler than
                    // the "no interview" empty since data is coming.
                    <TabScoringInProgress
                      status={scoringStatus}
                      scoringError={scoringError}
                    />
                  ) : (
                    <TabEmpty
                      icon={<ClipboardCheck className="h-6 w-6" strokeWidth={1.6} />}
                      title="No AI evaluation yet"
                      sub="The candidate hasn't recorded their interview. Their AI score and highlights will appear here once it's scored."
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
                  )
                ) : null}

                {tab === "responses" ? (
                  done ? (
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
                  ) : (
                    <TabEmpty
                      icon={<Video className="h-6 w-6" strokeWidth={1.6} />}
                      title="No responses recorded"
                      sub="Video answers show up here as chapters once the candidate finishes their interview."
                    />
                  )
                ) : null}

                {tab === "transcript" ? (
                  done && questions.length > 0 ? (
                    <TranscriptTab questions={questions} />
                  ) : done ? (
                    <TabScoringInProgress
                      status={scoringStatus}
                      scoringError={scoringError}
                      messageOverride="Transcript pending — it's generated after the recording is transcribed."
                    />
                  ) : (
                    <TabEmpty
                      icon={<FileText className="h-6 w-6" strokeWidth={1.6} />}
                      title="No transcript yet"
                      sub="The transcript is generated automatically after the interview is scored."
                    />
                  )
                ) : null}

                {tab === "activity" ? (
                  // Activity CAN render partial data (invited/created events)
                  // before the interview is done, so this tab always tries the
                  // real timeline first and falls back only when it's empty.
                  <ActivityTab
                    createdAt={data.createdAt}
                    startedAt={data.startedAt}
                    submittedAt={data.submittedAt}
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
                ) : null}

                {/* Pipeline card — always rendered below tabs */}
                <div className="mt-4">
                  <PipelineCard
                    candidate={candidate}
                    statuses={statuses}
                    overall100={overallScore100}
                    onStatusChange={handleStatusChange}
                    pending={statusPending}
                  />
                </div>
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
 * The subtler "we're waiting on the scoring pipeline" empty. Only rendered
 * once the interview has been submitted — the reviewer isn't blocked by the
 * candidate any more, just by the worker queue.
 */
function TabScoringInProgress({
  status,
  scoringError,
  messageOverride,
}: {
  status: ScoringStatus;
  scoringError: string;
  messageOverride?: string;
}) {
  const isRunning = status === "queued" || status === "processing";
  const message =
    messageOverride ??
    (isRunning
      ? status === "queued"
        ? "Scoring is queued — results will appear here as soon as the pipeline runs."
        : "Scoring in progress…"
      : status === "failed"
        ? `The last scoring run failed${scoringError ? `: ${scoringError}` : "."}`
        : status === "needs_review"
          ? `Needs human review${scoringError ? `: ${scoringError}` : "."}`
          : "Not scored yet.");
  return (
    <div className="rounded-2xl border border-dashed border-line bg-surface p-6 text-center text-[13px] text-ink-muted">
      <p className="inline-flex items-center gap-2">
        {isRunning ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
        ) : (
          <Clock className="h-4 w-4 shrink-0" strokeWidth={1.7} />
        )}
        {message}
      </p>
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
  const activeIdx = 0;
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
                : "—";
            return (
              <button
                key={q.questionId || i}
                type="button"
                disabled={
                  typeof q.askedAtSec !== "number" || !hlsReady
                }
                onClick={() =>
                  typeof q.askedAtSec === "number" && onJump(q.askedAtSec)
                }
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

// ── Transcript tab ─────────────────────────────────────────────────────

const SKIPPED_TRANSCRIPT_MARKER = "[Skipped by candidate]";

function TranscriptTab({
  questions,
}: {
  questions: AdminInterviewQuestionItem[];
}) {
  if (!questions.length) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-6 text-center text-sm text-ink-muted">
        No transcript available yet.
      </div>
    );
  }
  // Flatten into alternating speaker paragraphs; the first row is the
  // active line for visual anchoring.
  const rows: Array<{ speaker: "interviewer" | "candidate"; text: string }> = [];
  for (const q of questions) {
    rows.push({ speaker: "interviewer", text: q.text });
    const skipped =
      q.skipped || q.transcript.trim() === SKIPPED_TRANSCRIPT_MARKER;
    rows.push({
      speaker: "candidate",
      text: skipped
        ? "[Skipped]"
        : q.transcript.trim() || "[No transcript yet]",
    });
  }
  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <div className="mb-3 text-[14px] font-semibold">Transcript</div>
      <div className="grid gap-1">
        {rows.map((r, i) => {
          const active = i === 0;
          return (
            <div
              key={i}
              className={cn(
                "rounded-lg p-3 text-[13.5px] leading-[1.55]",
                active && "border-l-2 border-primary bg-[var(--accent-soft)]",
                r.speaker === "candidate" ? "text-ink-2" : "text-ink",
              )}
            >
              <span className="mr-1 font-semibold">
                {r.speaker === "interviewer" ? "Interviewer:" : "Candidate:"}
              </span>
              {r.text}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Activity tab ───────────────────────────────────────────────────────

function ActivityTab({
  createdAt,
  startedAt,
  submittedAt,
  scoringStatus,
  overall,
  questionCount,
  answeredCount,
  emptyFallback,
}: {
  createdAt: string | null;
  startedAt: string | null;
  submittedAt: string | null;
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
      time: new Date(createdAt).toLocaleString(),
      at: new Date(createdAt).getTime(),
      seq: 0,
      kind: "create",
    });
  }
  if (startedAt) {
    events.push({
      title: "Interview started",
      sub: "Candidate began recording",
      time: new Date(startedAt).toLocaleString(),
      at: new Date(startedAt).getTime(),
      seq: 1,
      kind: "start",
    });
  }
  if (submittedAt) {
    events.push({
      title: "Interview submitted",
      sub: `${answeredCount} video response${answeredCount === 1 ? "" : "s"}`,
      time: new Date(submittedAt).toLocaleString(),
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
        ? new Date(submittedAt).toLocaleString()
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
          {!skipped && question.answerAudioUrl ? (
            <audio
              controls
              preload="none"
              src={question.answerAudioUrl}
              className="h-8 w-full max-w-sm"
            >
              Your browser can&apos;t play this audio.
            </audio>
          ) : null}
          {scored ? (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="rounded-full border border-line px-2 py-0.5 font-semibold text-ink-2">
                Technical: {formatScore(scored.technical, { suffix: " / 10" })}
              </span>
              <span className="rounded-full border border-line px-2 py-0.5 font-semibold text-ink-2">
                Communication:{" "}
                {formatScore(scored.communication, { suffix: " / 10" })}
              </span>
              {typeof scored.weight === "number" && scored.weight !== 1 ? (
                <span className="text-ink-muted">Weight x{scored.weight}</span>
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
