import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import axios from "axios";
import {
  AlertTriangle,
  Briefcase,
  Calculator,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Clock,
  Download,
  ExternalLink,
  EyeOff,
  FileArchive,
  FileText,
  History,
  ListChecks,
  Loader2,
  Mail,
  Maximize,
  MessagesSquare,
  MicOff,
  Play,
  RefreshCw,
  ShieldAlert,
  Trash2,
  TrendingUp,
  User,
  Video,
  VideoOff,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScoringDetailsDialog } from "@/components/interviews/ScoringDetailsDialog";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { VideoPlayer } from "@/components/ui/video-player";
import ApplyVideoPlayer, {
  type VideoPlayerHandle,
} from "@/components/apply-video/ApplyVideoPlayer";
import {
  downloadInterviewAnswersAudio,
  downloadInterviewVideo,
  getInterview,
  getInterviewAttempts,
  getInterviewCvUrl,
  getInterviewScoringStatus,
  rescoreInterview,
  retranscodeInterviewVideo,
} from "@/features/interviews/interviewsApi";
import {
  formatDateTime,
  formatRole,
  formatScore,
  formatSessionIdTail,
  statusLabels,
  statusVariant,
} from "@/features/interviews/helpers";
import { formatYearsOfExperience } from "@/features/applicants/helpers";
import { resolveLabel } from "@/features/applicants/labelsCatalog";
import { getFollowupTimeline } from "@/features/applicants/applicantsApi";
import {
  FOLLOWUP_STAGE_LABEL,
  deliveryBadge,
  smsDeliveryBadge,
} from "@/features/applicants/followupHelpers";
import type {
  ApplicantChip,
  FollowupTimeline,
} from "@/features/applicants/types";
import type {
  InterviewAttempt,
  ScoringStatus,
} from "@/features/interviews/types";

/**
 * One option in the reattempt version dropdown, e.g. "Attempt 2 (latest)".
 * Only the latest is flagged; the per-attempt score lives in the detail
 * panel below, not the dropdown.
 */
function attemptOptionLabel(a: InterviewAttempt): string {
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

/** How often the lightweight scoring-status endpoint is polled while a
 *  (re)scoring run is in flight. */
const SCORING_POLL_MS = 4000;

/** `queued` / `processing` are the two "a run is in flight" states — the
 *  Rescore button is disabled and the status poll runs while either holds. */
function isScoringInFlight(s?: ScoringStatus | null): boolean {
  return s === "queued" || s === "processing";
}

/** Trigger a client-side download of an in-memory Blob as `filename`. */
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

interface Props {
  sessionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRequestDelete?: (sessionId: string, candidateName?: string | null) => void;
  /**
   * The linked applicant's full status-chip set, mirroring the Applicants
   * table's Status column so the drawer can render every operator-assigned
   * tag (Manual Pass/Reject, Scheduled + its date, Final Pass/Reject,
   * Rejection Email, Activation, …). Sourced from the applicant row in the
   * Applicants table (the drawer's only entry point) rather than the
   * interview document, which has no pipeline/scheduling concept of its
   * own. `null`/empty for legacy sessions opened without an applicant row.
   */
  chips?: ApplicantChip[] | null;
  /**
   * Linked applicant's public id. When present, the drawer fetches and
   * renders the AI-pending follow-up lifecycle (stage + email timeline).
   * `null` for legacy sessions opened without an applicant row.
   */
  applicationId?: string | null;
}

// ---------------------------------------------------------------------------
// Linked-applicant badge styling
//
// We render the linked applicant's lifecycle state as the drawer's
// single status badge — same vocabulary as the Applicants table so an
// operator who clicked "View Result" from there sees the SAME badge
// in the drawer header. Label + variant come from the centralised
// `features/applicants/helpers.ts` module so a future enum addition
// or colour-rule change happens in one place.
// ---------------------------------------------------------------------------

function ScoreStat({
  label,
  value,
  suffix = " / 10",
}: {
  label: string;
  /**
   * 0-10 score. The backend always emits all three scoring tiles
   * (overall / technical / communication) once scoring has run, so
   * this is always a number when scoring is present — `formatScore`
   * handles missing/NaN defensively just in case a future scoring
   * shape change drops a field.
   */
  value?: number;
  suffix?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 text-base font-semibold">
        {formatScore(value, { suffix })}
      </p>
    </div>
  );
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

/**
 * One expanded row in the drawer's "Hiring pipeline" panel: the stage
 * badge plus every detail the operator entered for it — the meeting link
 * (clickable), scheduled date/time, the full remarks, and who set it +
 * when. Promotes the data the Applicants table only exposed on hover into
 * first-class, readable content.
 */
function PipelineStageRow({ chip }: { chip: ApplicantChip }) {
  const def = resolveLabel(chip.key);
  if (!def) return null;
  const setMeta = [
    chip.setByName ? `Set by ${chip.setByName}` : null,
    chip.setAt ? formatDateTime(chip.setAt) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const hasDetail = Boolean(chip.remarks);
  return (
    <li className="rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={def.variant}>{def.label}</Badge>
          {chip.scheduledAt ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <Calendar className="h-3 w-3" />
              {formatDateTime(chip.scheduledAt)}
            </span>
          ) : null}
          {chip.link ? (
            <a
              href={chip.link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-muted"
            >
              <ExternalLink className="h-3 w-3" />
              Open meeting
            </a>
          ) : null}
        </div>
        {setMeta ? (
          <span className="text-[11px] text-muted-foreground">{setMeta}</span>
        ) : null}
      </div>
      {hasDetail ? (
        <div className="mt-2 space-y-2">
          {chip.remarks ? (
            <div className="rounded-md border border-border/60 bg-muted/30 p-2.5">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Remarks
              </p>
              <p className="text-sm leading-snug whitespace-pre-wrap wrap-break-word">
                {chip.remarks}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** Display label for one email row in the follow-up timeline. */
function followupEmailLabel(e: {
  type: string;
  attemptNumber: number;
}): string {
  switch (e.type) {
    case "followup":
      // attemptNumber 2..5 map to follow-up #1..#4 (the invite is #1).
      return e.attemptNumber >= 2
        ? `Follow-up #${e.attemptNumber - 1}`
        : "Follow-up";
    case "invite":
      return "Invite";
    case "rejection":
      return "Rejection email";
    case "offer":
      return "Offer letter";
    default:
      return e.type;
  }
}

/** Display label for one SMS row in the follow-up timeline. */
function followupSmsLabel(e: { type: string; attemptNumber: number }): string {
  switch (e.type) {
    case "followup":
      return e.attemptNumber >= 2
        ? `Follow-up #${e.attemptNumber - 1} SMS`
        : "Follow-up SMS";
    case "invite":
      return "Invite SMS";
    case "rejection":
      return "Rejection SMS";
    case "offer":
      return "Offer SMS";
    default:
      return `${e.type} SMS`;
  }
}

const FOLLOWUP_STAGE_VARIANT: Record<
  string,
  "default" | "warning" | "muted" | "success"
> = {
  in_progress: "default",
  no_reply: "muted",
  opted_out: "warning",
  responded: "success",
  not_invited: "muted",
};

/**
 * The drawer's "Follow-up lifecycle" panel: the candidate's current stage in
 * the AI-pending nudge cycle, plus a timeline of every email actually sent
 * and what the cron will do next.
 */
function FollowupLifecycleSection({
  timeline,
  isLoading,
  open,
  onToggle,
}: {
  timeline?: FollowupTimeline;
  isLoading: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const heading = (
    <button
      type="button"
      onClick={onToggle}
      className="mb-2 flex w-full items-center justify-between gap-1.5 text-sm font-semibold hover:text-foreground/80"
    >
      <span className="inline-flex items-center gap-1.5">
        <Mail className="h-3.5 w-3.5 text-muted-foreground" />
        Follow-up lifecycle
      </span>
      <ChevronDown
        className={cn(
          "h-4 w-4 text-muted-foreground transition-transform duration-200",
          open && "rotate-180",
        )}
      />
    </button>
  );

  if (!timeline) {
    return (
      <section>
        {heading}
        {open ? (
          <p className="inline-flex items-center gap-2 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
            {isLoading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading follow-up lifecycle…
              </>
            ) : (
              "Follow-up lifecycle unavailable."
            )}
          </p>
        ) : null}
      </section>
    );
  }

  const { summary, inviteSentAt, terminal, emails, sms } = timeline;
  // Newer sends log an INVITE email_log row (so it carries delivery status);
  // legacy invites don't, so we synthesise a day-0 line from inviteSentAt only
  // when there's no invite row to avoid showing it twice.
  const hasInviteRow = emails.some((e) => e.type === "invite");

  let sentence = "";
  switch (summary.stage) {
    case "in_progress":
      sentence =
        summary.sent >= summary.total
          ? `All ${summary.total} follow-ups sent. No-reply cutoff ${formatDateTime(summary.nextDueAt)}.`
          : summary.sent === 0
            ? `Awaiting reply. First nudge ${formatDateTime(summary.nextDueAt)} (day ${summary.nextDueDay}).`
            : `${summary.sent} of ${summary.total} follow-ups sent. Next ${formatDateTime(summary.nextDueAt)} (day ${summary.nextDueDay}).`;
      break;
    case "no_reply":
      sentence = `No reply after ${summary.total} follow-ups${terminal?.at ? `, marked ${formatDateTime(terminal.at)}` : ""}.`;
      break;
    case "opted_out":
      sentence = `Candidate clicked Not Interested${terminal?.at ? ` on ${formatDateTime(terminal.at)}` : ""}.`;
      break;
    case "responded":
      sentence =
        "Candidate started the interview, removed from the follow-up schedule.";
      break;
    case "not_invited":
    default:
      sentence =
        "No invite sent yet (video pending), the follow-up cycle hasn't started.";
      break;
  }

  type TimelineEntry = {
    label: string;
    at: string | null;
    tone: string;
    /** "email" rows use deliveryBadge; "sms" rows use smsDeliveryBadge. */
    channel?: "email" | "sms";
    deliveryStatus?: string;
    bounceType?: string;
    retryCount?: number;
  };
  const entries: TimelineEntry[] = [];
  if (!hasInviteRow) {
    entries.push({ label: "Invite sent", at: inviteSentAt, tone: "invite" });
  }
  for (const e of emails) {
    entries.push({
      label: followupEmailLabel(e),
      at: e.sentAt,
      tone: e.type === "invite" ? "invite" : "sent",
      channel: "email",
      deliveryStatus: e.deliveryStatus,
      bounceType: e.bounceType,
    });
  }
  // Companion SMS rows, interleaved with the emails by send time below so each
  // text sits next to the email it accompanied.
  for (const s of sms) {
    entries.push({
      label: followupSmsLabel(s),
      at: s.sentAt,
      tone: "sms",
      channel: "sms",
      deliveryStatus: s.deliveryStatus,
      retryCount: s.retryCount,
    });
  }
  // Order the sent-message rows chronologically (oldest first). Rows without a
  // timestamp (legacy) sort to the top; the "next"/terminal markers are pushed
  // afterwards so they always trail the history.
  entries.sort((a, b) => {
    const ta = a.at ? new Date(a.at).getTime() : 0;
    const tb = b.at ? new Date(b.at).getTime() : 0;
    return ta - tb;
  });
  if (summary.stage === "in_progress" && summary.nextDueAt) {
    entries.push({
      label:
        summary.sent >= summary.total
          ? "No-reply cutoff"
          : `Next follow-up (day ${summary.nextDueDay})`,
      at: summary.nextDueAt,
      tone: "next",
    });
  }
  if (terminal) {
    entries.push({
      label:
        terminal.key === "no_reply"
          ? "Marked No Reply"
          : "Opted out (Not Interested)",
      at: terminal.at,
      tone: "terminal",
    });
  }

  const dotClass: Record<string, string> = {
    invite: "bg-primary",
    sent: "bg-amber-500",
    sms: "bg-sky-500",
    next: "border border-dashed border-muted-foreground bg-transparent",
    terminal:
      summary.stage === "opted_out" ? "bg-amber-500" : "bg-muted-foreground",
  };

  return (
    <section>
      {heading}
      {open ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge variant={FOLLOWUP_STAGE_VARIANT[summary.stage] ?? "muted"}>
              {FOLLOWUP_STAGE_LABEL[summary.stage]}
            </Badge>
            <span className="text-xs text-muted-foreground">{sentence}</span>
          </div>
          <ol className="space-y-2">
            {entries.map((entry, i) => (
              <li
                key={`${entry.tone}-${i}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2"
              >
                <span className="inline-flex min-w-0 items-center gap-2">
                  <span
                    className={cn(
                      "h-2 w-2 shrink-0 rounded-full",
                      dotClass[entry.tone] ?? "bg-muted-foreground",
                    )}
                  />
                  <span className="truncate text-sm">{entry.label}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {(() => {
                    if (!entry.deliveryStatus) return null;
                    const b =
                      entry.channel === "sms"
                        ? smsDeliveryBadge(
                            entry.deliveryStatus,
                            entry.retryCount,
                          )
                        : deliveryBadge(entry.deliveryStatus, entry.bounceType);
                    return b ? (
                      <Badge variant={b.variant} className="text-[10px]">
                        {b.label}
                      </Badge>
                    ) : null;
                  })()}
                  <span className="text-xs text-muted-foreground">
                    {entry.at ? formatDateTime(entry.at) : "—"}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </section>
  );
}

export function InterviewDetailDrawer({
  sessionId,
  open,
  onOpenChange,
  onRequestDelete,
  chips,
  applicationId,
}: Props) {
  // Reattempt history: the drawer is always OPENED on the latest attempt
  // (`sessionId` prop), but the version dropdown lets the reviewer switch to
  // an older attempt. `selectedSessionId` overrides which attempt's detail we
  // load; null = follow the latest. Reset whenever the entry point changes so
  // reopening on a different candidate always starts on their latest attempt.
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  useEffect(() => {
    setSelectedSessionId(null);
  }, [sessionId, open]);
  const activeSessionId = selectedSessionId ?? sessionId;

  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["interview", activeSessionId],
    queryFn: () => getInterview(activeSessionId!),
    enabled: Boolean(activeSessionId && open),
    // While the webcam / screen recording is still transcoding to HLS, poll so
    // the player swaps from "preparing…" to the live stream as soon as it's
    // ready — no need for the reviewer to reopen the drawer. Background scoring
    // is NOT watched here: the lightweight scoring-status poll below drives
    // that and refetches this heavy payload exactly once, when it settles.
    refetchInterval: (query) => {
      const transcoding = (s?: string | null) =>
        s === "pending" || s === "processing";
      const webcam = query.state.data?.webcamHlsStatus;
      const screen = query.state.data?.technicalSession?.screenHlsStatus;
      return transcoding(webcam) || transcoding(screen) ? 5000 : false;
    },
  });

  // --- Background AI-scoring lifecycle ------------------------------------
  // The detail payload carries a `scoringStatus` snapshot, but a rescore runs
  // in the background. Rather than re-pull the heavy detail (transcripts,
  // per-question scores) on a timer, we poll a lightweight status endpoint
  // while a run is in flight and refetch the full detail exactly once, when it
  // settles. `scoringInFlight` is the explicit gate for that poll: seeded from
  // the detail snapshot (someone else's rescore / the boot-time orphan scan)
  // and from a fresh rescore here, cleared when the poll reaches a terminal
  // state. Reset on attempt switch / reopen so a stale run doesn't leak across.
  const [scoringInFlight, setScoringInFlight] = useState(false);
  useEffect(() => {
    setScoringInFlight(false);
    // Close the scoring-details dialog on attempt switch / reopen so its
    // numbers don't silently swap to a different attempt underneath the reader.
    setScoringDetailsOpen(false);
  }, [activeSessionId, open]);

  const scoringStatusQuery = useQuery({
    queryKey: ["interview-scoring-status", activeSessionId],
    queryFn: () => getInterviewScoringStatus(activeSessionId!),
    enabled: Boolean(activeSessionId && open && scoringInFlight),
    // Poll while queued/processing; stop the instant it reaches a terminal
    // state (done / failed / needs_review / idle).
    refetchInterval: (query) =>
      isScoringInFlight(query.state.data?.scoringStatus)
        ? SCORING_POLL_MS
        : false,
  });

  // Freshest known status: the live poll if we have one, else the detail
  // snapshot. Both are keyed on `activeSessionId`, so switching attempts
  // resets them naturally and never shows a stale run.
  const scoringStatus: ScoringStatus =
    scoringStatusQuery.data?.scoringStatus ?? data?.scoringStatus ?? "idle";
  const scoringError =
    scoringStatusQuery.data?.scoringError ?? data?.scoringError ?? "";
  const scoringRunning = isScoringInFlight(scoringStatus);

  // If the detail loads (or refetches) with a run already in flight — the
  // drawer opened right after another operator triggered a rescore, or the
  // boot-time orphan scan re-queued it — start the poll.
  useEffect(() => {
    if (isScoringInFlight(data?.scoringStatus)) setScoringInFlight(true);
  }, [data?.scoringStatus]);

  // When the poll reaches a terminal state, stop it and pull the refreshed
  // heavy detail in once so the new scores / transcripts land in place.
  useEffect(() => {
    const s = scoringStatusQuery.data?.scoringStatus;
    if (s && !isScoringInFlight(s) && scoringInFlight) {
      setScoringInFlight(false);
      refetch();
    }
  }, [scoringStatusQuery.data?.scoringStatus, scoringInFlight, refetch]);

  // All attempts for this candidate (one element unless they reattempted).
  // Keyed on the ENTRY-POINT sessionId (the latest) so switching attempts in
  // the dropdown doesn't refetch the list — the backend resolves every
  // attempt from any one sessionId via the shared applicationId.
  const attemptsQuery = useQuery({
    queryKey: ["interview-attempts", sessionId],
    queryFn: () => getInterviewAttempts(sessionId!),
    enabled: Boolean(sessionId && open),
  });
  const attempts = attemptsQuery.data ?? [];
  // The version dropdown shows whenever there's at least one attempt (so the
  // reviewer always sees which attempt they're on); the "Reattempted" marker
  // only when there's actually more than one.
  const hasAttempts = attempts.length >= 1;
  const hasMultipleAttempts = attempts.length > 1;

  const [retranscoding, setRetranscoding] = useState(false);
  const [rescoring, setRescoring] = useState(false);
  const [scoringDetailsOpen, setScoringDetailsOpen] = useState(false);
  const [pipelineOpen, setPipelineOpen] = useState(false);
  const [followupOpen, setFollowupOpen] = useState(false);
  const [downloadingAudio, setDownloadingAudio] = useState(false);
  const [downloadingVideo, setDownloadingVideo] = useState(false);

  const handleRetranscode = async () => {
    if (!activeSessionId) return;
    setRetranscoding(true);
    try {
      await retranscodeInterviewVideo(activeSessionId);
      toast.success("Re-queued the recording for streaming.");
      await refetch();
    } catch {
      toast.error("Couldn't queue the recording. Please try again.");
    } finally {
      setRetranscoding(false);
    }
  };

  /**
   * Re-run the full AI scoring pipeline for the attempt on screen. The
   * backend queues a background job (or reports one already in flight
   * instead of stacking a second), so the new scores land asynchronously.
   * We seed the lightweight status poll with the returned live state and flip
   * `scoringInFlight` on — the poll then watches `queued → processing →
   * done/failed` and refetches the full detail once it settles.
   */
  const handleRescore = async () => {
    if (!activeSessionId || rescoring || scoringRunning) return;
    setRescoring(true);
    try {
      const res = await rescoreInterview(activeSessionId);
      // Seed the poll cache with the live state so it starts in an in-flight
      // state (and doesn't read a stale terminal value from a previous run on
      // this session), then flip the poll on.
      queryClient.setQueryData(
        ["interview-scoring-status", activeSessionId],
        {
          sessionId: activeSessionId,
          scoringStatus: res.scoringStatus,
          scoringError: "",
        },
      );
      setScoringInFlight(true);
      toast.success(
        res.alreadyQueued
          ? "Scoring is already running for this interview — watching for it to finish."
          : "Rescoring queued — scores will refresh here once the pipeline finishes.",
      );
    } catch (err) {
      // A 400 carries an explanatory message (e.g. "Only a submitted
      // interview can be rescored…") — surface it verbatim.
      const message =
        (axios.isAxiosError(err) &&
          (err.response?.data as { message?: string } | undefined)?.message) ||
        "Couldn't queue rescoring. Please try again.";
      toast.error(message);
    } finally {
      setRescoring(false);
    }
  };

  const answers = data?.answers ?? [];

  // Imperative handle to the HLS player so a "jump to question" chip can seek
  // the recording. Populated by ApplyVideoPlayer while it's mounted (HLS ready).
  const playerApiRef = useRef<VideoPlayerHandle | null>(null);
  // The webcam recording sits near the top of the (scrollable) drawer body
  // while the question list runs far below it. A "jump to question" chip has
  // to scroll the player back into view as it seeks, otherwise the recording
  // seeks + plays off-screen and the click reads as a no-op.
  const videoSectionRef = useRef<HTMLElement | null>(null);

  // Seek the recording to a question's offset AND scroll the player into view.
  // Guarded by `hlsReady` at the call site, so `seekTo` is always live here.
  const jumpToRecording = (sec: number) => {
    playerApiRef.current?.seekTo(sec);
    videoSectionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };
  // Timeline markers (one per question that carries a recording offset) — drive
  // the player's caption overlay + scrubber ticks.
  const chapters = answers
    .filter((a) => typeof a.askedAtSec === "number")
    .map((a) => ({ atSec: a.askedAtSec as number, label: a.question }));
  // Jump chips only act when the HLS player is actually mounted (recording
  // ready); otherwise the timestamp renders as a static label.
  const hlsReady = Boolean(data?.webcamHlsUrl);

  // All chips shown in the "Hiring pipeline" panel: system verdict chips
  // (initial_pass / initial_rejection / ai_pass / ai_rejection / ai_pending)
  // first, then the manual pipeline stages. Pending placeholders (Not Scheduled
  // / Feedback Not Given / …) are omitted — they carry no entered detail.
  const VERDICT_SYSTEM_KEYS = new Set([
    "initial_pass",
    "initial_rejection",
    "ai_pass",
    "ai_rejection",
    "ai_pending",
  ]);
  const pipelineStages = (chips ?? []).filter((c) => {
    if (c.source === "system") return VERDICT_SYSTEM_KEYS.has(c.key);
    const def = resolveLabel(c.key);
    return Boolean(def && !def.pending);
  });

  // AI-pending follow-up lifecycle (stage + email timeline). Applicant-level,
  // so it rides off `applicationId` (passed in) rather than the interview doc.
  const followupQuery = useQuery({
    queryKey: ["applicant-followup", applicationId],
    queryFn: () => getFollowupTimeline(applicationId!),
    enabled: Boolean(applicationId && open),
  });
  const followup = followupQuery.data;

  // A 404 here means the interview doc is gone (TTL-purged) but the
  // applicant still pointed at it. The admin applicants list self-heals
  // the dangling pointer, so this is mainly a race (interview expired
  // between list load and drawer open) — surface a clear explanation
  // instead of a generic "failed to load".
  const is404 =
    isError && axios.isAxiosError(error) && error.response?.status === 404;

  /**
   * Open the CV in a new tab using a freshly-minted presigned GET
   * URL. Same popup-blocker-safe pattern as the applicants page:
   * open a blank tab synchronously within the click, redirect once
   * the URL arrives, fall back to a same-tab navigate if the popup
   * was blocked. Required because the S3 bucket is private — the
   * raw `data.cvUrl` shipped to the frontend is a canonical
   * identifier, not a clickable URL.
   *
   * Critical: we do NOT pass `noopener` to `window.open`. With
   * `noopener` the returned handle's `.location` setter is a no-op,
   * so the new tab stays at `about:blank` and the URL ends up in
   * the current tab instead. We open with the opener relationship
   * intact, set the location, then null out `win.opener` ourselves
   * — same end-state safety as `noopener` but with a working
   * redirect.
   */
  const handleOpenCv = async () => {
    if (!activeSessionId) return;
    const win = window.open("about:blank", "_blank");
    try {
      const { url } = await getInterviewCvUrl(activeSessionId);
      if (win) {
        win.location.href = url;
        try {
          win.opener = null;
        } catch {
          /* some browsers freeze it */
        }
      } else {
        window.location.assign(url);
      }
    } catch (err) {
      if (win) win.close();
      const message =
        (axios.isAxiosError(err) &&
          (err.response?.data as { message?: string } | undefined)?.message) ||
        (err instanceof Error ? err.message : null) ||
        "Could not open CV.";
      toast.error(message);
    }
  };

  /**
   * Export the whole interview record (identity + overall scoring + every
   * question with its answer transcript, per-question scores, and feedback)
   * as a JSON file. Purely client-side: the drawer already holds the full
   * detail, so no backend round-trip is needed.
   */
  const handleExportJson = () => {
    if (!data) return;
    const payload = {
      candidateName: data.candidateName,
      email: data.email,
      sessionId: data.sessionId,
      attemptNumber: data.attemptNumber,
      status: data.status,
      startedAt: data.startedAt,
      submittedAt: data.submittedAt,
      overallScores: data.scores?.overall ?? null,
      questions: (data.answers ?? []).map((a, i) => ({
        number: i + 1,
        questionId: a.questionId,
        question: a.question,
        answer: a.transcript,
        scores: a.scores ?? null,
        feedback: a.feedback ?? null,
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

  /**
   * Download every candidate answer's audio as a single zip. The bytes live
   * in a private S3 bucket, so this hits an auth-gated backend endpoint that
   * streams them into a zip (see `downloadInterviewAnswersAudio`). A 404
   * means the interview carries no answer audio (all skipped, or a legacy
   * audio-less record).
   */
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

  /**
   * Download the candidate's webcam recording as a single video file. The
   * backend returns the raw original when it still exists, or an MP4 rebuilt
   * from the streaming segments (the original is deleted after transcode);
   * that rebuild can take a few seconds, hence the loading state. The file
   * extension follows the returned blob's MIME type (mp4 vs webm). A 404
   * means the recording isn't downloadable yet (still processing / failed).
   */
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full max-w-3xl flex-col p-0 sm:max-w-3xl"
      >
        <SheetHeader className="pr-12">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-4">
              <Avatar className="h-12 w-12 shrink-0">
                <AvatarFallback>
                  {initialsFor(data?.candidateName, data?.email)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <SheetTitle className="truncate">
                    {data?.candidateName || "Interview detail"}
                  </SheetTitle>
                  {/*
                    Two side-by-side status badges driven off the
                    LINKED applicant's independent per-stage
                    decisions: pre-screen verdict on the left, AI
                    verdict on the right. We render both so the
                    operator sees the full journey at a glance
                    ("Initial pass / AI rejection" means "we
                    accepted them, the interview didn't work out")
                    rather than just the latest collapsed stage.
                    The AI half renders as a muted "AI pending"
                    pill while the candidate hasn't been scored
                    yet. Fall back to the raw interview status
                    only for legacy sessions with no applicant
                    row (the pre-funnel /interview/start path).
                  */}
                  {!data?.applicant && data ? (
                    // Legacy fallback: no linked applicant. Show the
                    // raw interview status so the drawer still
                    // conveys *something* meaningful at the top.
                    <Badge variant={statusVariant[data.status]}>
                      {statusLabels[data.status]}
                    </Badge>
                  ) : null}
                  {hasMultipleAttempts ? (
                    <Badge variant="purple" className="gap-1">
                      <History className="h-3 w-3" />
                      Reattempted ×{attempts.length - 1}
                    </Badge>
                  ) : null}
                </div>
                <SheetDescription className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0 text-xs">
                  {data?.email ? (
                    <span className="inline-flex items-center gap-1">
                      <Mail className="h-3 w-3" />
                      {data.email}
                    </span>
                  ) : null}
                  {activeSessionId ? (
                    <button
                      type="button"
                      className="cursor-copy font-mono text-[10px] text-muted-foreground/60 transition-colors hover:text-muted-foreground"
                      title={`Click to copy: ${activeSessionId}`}
                      onClick={() => {
                        navigator.clipboard.writeText(activeSessionId);
                        toast.success("ID copied");
                      }}
                    >
                      ID: {formatSessionIdTail(activeSessionId)}
                    </button>
                  ) : null}
                </SheetDescription>
              </div>
            </div>

            {data ? (
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {data.cvUrl ? (
                  <Button variant="outline" size="sm" onClick={handleOpenCv}>
                    <FileText className="h-4 w-4" />
                    Open CV
                    <ExternalLink className="h-3 w-3" />
                  </Button>
                ) : null}
                {onRequestDelete && activeSessionId ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() =>
                      onRequestDelete(activeSessionId, data?.candidateName)
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        </SheetHeader>

        <SheetBody className="flex-1 space-y-6">
          {isLoading ? (
            <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading interview…
            </div>
          ) : is404 ? (
            <div className="flex h-72 flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
              <AlertTriangle className="h-6 w-6 text-amber-500" />
              <p className="max-w-sm">
                This interview is no longer available. It likely expired before
                the candidate completed it, or aged out of the 30-day
                post-submission retention window. The applicant's broken link is
                being cleared automatically, re-issue an invite from the
                Applicants tab if you want them to retake it.
              </p>
            </div>
          ) : isError || !data ? (
            <div className="flex h-72 flex-col items-center justify-center gap-3 text-sm text-destructive">
              Failed to load interview.
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Retry
              </Button>
            </div>
          ) : (
            <div className="space-y-6">
              {/* --- Snapshot --- */}
              <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3">
                  <User className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Candidate
                    </p>
                    <p className="text-sm font-medium">
                      {data.candidateName || "—"}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3">
                  <Briefcase className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Profile
                    </p>
                    <p className="text-sm font-medium">
                      {data.profile?.primaryRole
                        ? formatRole(data.profile.primaryRole)
                        : "—"}
                      {typeof data.profile?.yearsOfExperience === "number"
                        ? ` · ${formatYearsOfExperience(data.profile.yearsOfExperience)}y`
                        : ""}
                      {data.profile?.seniority &&
                      data.profile.seniority !== "unknown"
                        ? ` · ${titleCase(data.profile.seniority)}`
                        : ""}
                    </p>
                  </div>
                </div>
              </section>

              {/* --- Hiring pipeline ---

                  Every stage the operator has set on the linked applicant,
                  expanded from the summary chips above into full detail:
                  the remarks they typed, the final-round meeting link as a
                  clickable button, the scheduled date/time, and who set it
                  + when. Placed high (right after the snapshot) because the
                  pipeline state is what a reviewer most often comes here to
                  check. Auto-seeded "pending" placeholders are omitted (no
                  entered detail; still visible in the chips summary up
                  top). */}
              {pipelineStages.length > 0 ? (
                <section>
                  <button
                    type="button"
                    onClick={() => setPipelineOpen((v) => !v)}
                    className="mb-2 flex w-full items-center justify-between gap-1.5 text-sm font-semibold hover:text-foreground/80"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <ListChecks className="h-3.5 w-3.5 text-muted-foreground" />
                      Hiring pipeline
                    </span>
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 text-muted-foreground transition-transform duration-200",
                        pipelineOpen && "rotate-180",
                      )}
                    />
                  </button>
                  {pipelineOpen ? (
                    <ol className="space-y-2">
                      {pipelineStages.map((chip) => (
                        <PipelineStageRow
                          key={`${chip.source}:${chip.key}`}
                          chip={chip}
                        />
                      ))}
                    </ol>
                  ) : null}
                </section>
              ) : null}

              {/* --- Follow-up lifecycle ---

                  The AI-pending nudge cycle (days 2/4/6/8 follow-ups →
                  day-10 no_reply). Shows the current stage + a timeline of
                  the emails actually sent + what's due next. Applicant-level,
                  so it only renders when an applicationId was passed in. */}
              {applicationId ? (
                <FollowupLifecycleSection
                  timeline={followup}
                  isLoading={followupQuery.isLoading}
                  open={followupOpen}
                  onToggle={() => setFollowupOpen((v) => !v)}
                />
              ) : null}

              {/* --- Proctoring signals --- */}
              {data.fullscreenExitCount > 0 ||
              data.tabHiddenCount > 0 ||
              data.cameraMutedCount > 0 ? (
                <section>
                  <h3 className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold">
                    <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
                    Proctoring signals
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {data.fullscreenExitCount > 0 ? (
                      <ProctoringBadge
                        icon={Maximize}
                        count={data.fullscreenExitCount}
                        singularLabel="fullscreen exit"
                        pluralLabel="fullscreen exits"
                      />
                    ) : null}
                    {data.tabHiddenCount > 0 ? (
                      <ProctoringBadge
                        icon={EyeOff}
                        count={data.tabHiddenCount}
                        singularLabel="tab switch"
                        pluralLabel="tab switches"
                      />
                    ) : null}
                    {data.cameraMutedCount > 0 ? (
                      <ProctoringBadge
                        icon={VideoOff}
                        count={data.cameraMutedCount}
                        singularLabel="camera drop"
                        pluralLabel="camera drops"
                      />
                    ) : null}
                  </div>
                  {data.cameraMutedCount > 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                        The camera track muted during recording. The webcam
                        video will show a frozen frame for the duration of each
                        drop.
                    </p>
                  ) : null}
                </section>
              ) : null}

              {/* --- Timing / overtime --- */}
              {data.graceUsedSec > 0 ? (
                <section>
                  <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                    <Clock className="h-3.5 w-3.5 text-amber-500" />
                    Timing
                  </h3>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-600 dark:text-amber-300">
                    <Clock className="h-3 w-3 shrink-0" />
                      Used {formatOvertime(data.graceUsedSec)} of extra time
                      past the 30-minute limit
                  </span>
                </section>
              ) : null}

              {/* --- Profile: summary, role evidence, tech, work history --- */}
              {data.profile ? (
                <section>
                  <h3 className="mb-2 text-sm font-semibold">Profile</h3>
                  {data.profile.summary ? (
                    <p className="rounded-lg border border-border bg-muted/30 p-3 text-sm leading-relaxed">
                      {data.profile.summary}
                    </p>
                  ) : null}
                  {data.profile.technologies?.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {data.profile.technologies.map((t) => (
                        <Badge
                          key={t.name}
                          variant="outline"
                          className="border-border"
                        >
                          {t.name}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                  {data.profile.workHistory?.length ? (
                    <div className="mt-3">
                      <p className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                        Work history · years computed from these dates
                      </p>
                      <ul className="space-y-1.5">
                        {data.profile.workHistory.map((w, i) => (
                          <li
                            key={`${w.title}-${w.company}-${i}`}
                            className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm"
                          >
                            <span className="min-w-0">
                              <span className="font-medium">
                                {w.title || "—"}
                              </span>
                              {w.company ? (
                                <span className="text-muted-foreground">
                                  {" "}
                                  · {w.company}
                                </span>
                              ) : null}
                              {!w.isTechRole ? (
                                <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                                  non-tech
                                </span>
                              ) : null}
                            </span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {formatDateRange(w.start, w.end)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </section>
              ) : null}

                {/*
                Attempt switcher — reattempts only re-run the AI screening
                round (the technical session is shared across attempts), so
                the selector lives in this tab rather than the drawer header.
                Lists every attempt oldest to newest, latest pre-selected;
                picking one loads that attempt's full detail. Prior attempts'
                recordings/transcripts/scores are kept on the backend so
                reviewers can compare.
              */}
                {hasAttempts ? (
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      <History className="h-3 w-3" />
                      Interview Attempts
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
              {/* --- Webcam recording ---

                  We ALWAYS render this section (heading + body) so
                  the operator can tell "no recording was uploaded
                  for this session" apart from "the drawer is
                  broken". Previously the whole block was hidden
                  when `webcamVideoUrl` was empty, which left a
                  silent gap below the proctoring section that
                  looked like a regression after the recent admin
                  drawer refactors.

                  Empty `webcamVideoUrl` happens when the candidate
                  closed the tab / lost network before
                  `/interview/video/complete` landed, or the
                  /interview/start flow was a legacy path that
                  pre-dated webcam capture. Either way the drawer
                  surfaces the state explicitly. */}
              <section ref={videoSectionRef} className="scroll-mt-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold">
                    <Video className="h-3.5 w-3.5 text-muted-foreground" />
                    Webcam recording
                  </h3>
                  {data.webcamHlsUrl || data.webcamVideoUrl ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleDownloadVideo}
                      disabled={downloadingVideo}
                    >
                      {downloadingVideo ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                      Download Video
                    </Button>
                  ) : null}
                </div>
                {data.webcamHlsUrl ? (
                  // Transcode finished — stream the HLS bundle via the
                  // shared apply-video player (withCredentials so the
                  // admin cookie reaches the JwtAuthGuard'd endpoints).
                  <ApplyVideoPlayer
                    key={data.webcamHlsUrl}
                    manifestUrl={data.webcamHlsUrl}
                    durationSec={data.webcamVideoDurationSec}
                    withCredentials
                    chapters={chapters}
                    apiRef={playerApiRef}
                  />
                ) : data.webcamHlsStatus === "failed" ? (
                  <div className="space-y-3">
                    <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                          Couldn't prepare the streaming version of this
                          recording
                          {data.webcamHlsError
                            ? `: ${data.webcamHlsError}`
                            : "."}
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleRetranscode}
                      disabled={retranscoding}
                    >
                      {retranscoding ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                      Retry streaming conversion
                    </Button>
                    {/* Raw original is still available on a failed transcode. */}
                    {data.webcamVideoUrl ? (
                      <VideoPlayer
                        src={data.webcamVideoUrl}
                        knownDurationSec={data.webcamVideoDurationSec}
                        ariaLabel={`Webcam recording for ${data.candidateName ?? "candidate"}`}
                      />
                    ) : null}
                  </div>
                ) : data.webcamHlsStatus === "pending" ||
                  data.webcamHlsStatus === "processing" ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                      Preparing a streamable version of this recording…
                    </div>
                    {/* Play the original meanwhile (deleted once HLS is ready). */}
                    {data.webcamVideoUrl ? (
                      <VideoPlayer
                        src={data.webcamVideoUrl}
                        knownDurationSec={data.webcamVideoDurationSec}
                        ariaLabel={`Webcam recording for ${data.candidateName ?? "candidate"}`}
                      />
                    ) : null}
                  </div>
                ) : data.webcamVideoUrl ? (
                  // Legacy recording with no transcode state — raw proxy.
                  <VideoPlayer
                    src={data.webcamVideoUrl}
                    knownDurationSec={data.webcamVideoDurationSec}
                    ariaLabel={`Webcam recording for ${data.candidateName ?? "candidate"}`}
                  />
                ) : (
                  <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                    No webcam recording was uploaded for this session. The
                    candidate may have closed the tab before the upload
                    completed, lost network, or used a legacy flow that
                    pre-dates webcam capture.
                  </p>
                )}
              </section>

              {/* --- Overall scores (3-dimension rubric) ---

                  The scorer produces two per-dimension scores
                  (technical / communication) plus the weighted
                  overall. We render those three tiles here; the
                  per-question breakdown lives further down in the
                  "Questions & answers" section. The header's Rescore
                  action re-queues the full AI scoring pipeline for
                  this attempt — useful after the backend's weights/
                  prompts are tuned. Only submitted interviews are
                  scorable, hence the status gate. */}
              {data.scores?.overall ? (
                <section>
                  <ScoringDetailsDialog
                    open={scoringDetailsOpen}
                    onOpenChange={setScoringDetailsOpen}
                    candidateName={data.candidateName}
                    overall={data.scores.overall}
                    fluency={data.scores.fluency}
                  />
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">Overall scoring</h3>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setScoringDetailsOpen(true)}
                      >
                        <Calculator className="h-4 w-4" />
                        View details
                      </Button>
                      {data.status === "submitted" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleRescore}
                          disabled={rescoring || scoringRunning}
                        >
                          {rescoring || scoringRunning ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="h-4 w-4" />
                          )}
                          {scoringRunning
                            ? scoringStatus === "queued"
                              ? "Queued…"
                              : "Scoring…"
                            : "Rescore"}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {/* A rescore that failed / parked for review keeps the
                      PREVIOUS run's numbers on screen — call that out so the
                      reviewer knows the tiles below aren't the latest attempt. */}
                  {scoringStatus === "failed" ||
                  scoringStatus === "needs_review" ? (
                    <div className="mb-2 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        {scoringStatus === "needs_review"
                          ? "The last scoring run was parked for manual review"
                          : "The last scoring run failed"}
                        {scoringError ? `: ${scoringError}` : "."} The scores
                        below are from the previous successful run — rescore to
                        retry.
                      </span>
                    </div>
                  ) : null}
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <ScoreStat
                      label="Overall"
                      value={data.scores.overall.overall}
                    />
                    <ScoreStat
                      label="Technical"
                      value={data.scores.overall.technicalSkills}
                    />
                    <ScoreStat
                      label="Communication"
                      value={data.scores.overall.communication}
                    />
                  </div>
                  {/* Integrity + coverage — meta signals, not rubric
                      dimensions. Integrity is anti-cheat (flag-only); a low
                      value is highlighted amber so reviewers look closer.
                      Coverage is how much of the interview was actually
                      answered. Both are optional on rows scored before these
                      fields shipped. */}
                  {typeof data.scores.overall.integrity === "number" ||
                  typeof data.scores.overall.coverage === "number" ? (
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      {typeof data.scores.overall.coverage === "number" ? (
                        <span className="rounded-md border border-border bg-muted/30 px-2 py-1">
                          Answered{" "}
                          {Math.round(data.scores.overall.coverage * 100)}% of
                          questions
                        </span>
                      ) : null}
                      {typeof data.scores.overall.integrity === "number" ? (
                        <span
                          className={`rounded-md border px-2 py-1 ${
                            data.scores.overall.integrity < 6
                              ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                              : "border-border bg-muted/30"
                          }`}
                        >
                          Integrity{" "}
                          {formatScore(data.scores.overall.integrity, {
                            suffix: " / 10",
                          })}
                            {data.scores.overall.integrity < 6
                              ? ", review"
                              : ""}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  {data.scores.overall.summary ? (
                    <p className="mt-3 rounded-lg border border-border bg-muted/30 p-3 text-sm leading-relaxed">
                      {data.scores.overall.summary}
                    </p>
                  ) : null}
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {data.scores.overall.strengths?.length ? (
                      <div className="rounded-lg border border-border bg-card p-3">
                        <p className="mb-1 inline-flex items-center gap-1 text-xs font-semibold text-success">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Strengths
                        </p>
                        <ul className="list-disc space-y-1 pl-5 text-sm">
                          {data.scores.overall.strengths.map((s) => (
                            <li key={s}>{s}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {/* Always surface a weak side — even for a strong/passing
                        candidate. Prefer the always-on constructive
                        "weaknesses"; fall back to red flags for legacy scores
                        that pre-date that field. */}
                    {data.scores.overall.weaknesses?.length ||
                    data.scores.overall.redFlags?.length ? (
                      <div className="rounded-lg border border-border bg-card p-3">
                        <p className="mb-1 inline-flex items-center gap-1 text-xs font-semibold text-amber-600 dark:text-amber-300">
                          <TrendingUp className="h-3.5 w-3.5" />
                          Areas to improve
                        </p>
                        <ul className="list-disc space-y-1 pl-5 text-sm">
                          {(data.scores.overall.weaknesses?.length
                            ? data.scores.overall.weaknesses
                            : data.scores.overall.redFlags
                          ).map((s) => (
                            <li key={s}>{s}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {/* Serious concerns shown separately — only when we also
                        have weaknesses above, otherwise red flags already ARE
                        the "areas to improve" content and we'd duplicate them. */}
                    {data.scores.overall.weaknesses?.length &&
                    data.scores.overall.redFlags?.length ? (
                      <div className="rounded-lg border border-border bg-card p-3">
                        <p className="mb-1 inline-flex items-center gap-1 text-xs font-semibold text-destructive">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          Red flags
                        </p>
                        <ul className="list-disc space-y-1 pl-5 text-sm">
                          {data.scores.overall.redFlags.map((s) => (
                            <li key={s}>{s}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                </section>
              ) : data.status === "submitted" ? (
                // Submitted but unscored — the scoring run is either in flight
                // (queued/processing), failed / parked for review, or never
                // ran (idle). Drive the copy + action off the live status so
                // the reviewer sees exactly what's happening and can (re)queue
                // without leaving the drawer.
                <section className="space-y-3 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                  {scoringRunning ? (
                    <p className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                      {scoringStatus === "queued"
                        ? "Scoring is queued — results will appear here as soon as the pipeline runs."
                        : "Scoring in progress — results will appear here automatically."}
                    </p>
                  ) : scoringStatus === "failed" ||
                    scoringStatus === "needs_review" ? (
                    <>
                      <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>
                          {scoringStatus === "needs_review"
                            ? "The scoring run was parked for manual review"
                            : "The scoring run failed"}
                          {scoringError ? `: ${scoringError}` : "."} You can
                          retry it here.
                        </span>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRescore}
                        disabled={rescoring}
                      >
                        {rescoring ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                        Retry scoring
                      </Button>
                    </>
                  ) : (
                    <>
                      <p>
                        No scoring has run for this interview yet. Run the AI
                        scoring pipeline to grade it.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRescore}
                        disabled={rescoring}
                      >
                        {rescoring ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                        Run scoring
                      </Button>
                    </>
                  )}
                </section>
              ) : (
                <section className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                  No scoring available yet, interview hasn't been submitted.
                </section>
              )}

              <Separator />

              {/* --- Per-question answers (transcript + scores) ---

                  One row per question the candidate was asked, in
                  ask-order. Per-row audio playback is intentionally
                  NOT surfaced — the Whisper transcript IS the
                  canonical record of what the candidate said. The
                  answer audio (private S3) is instead available in
                  bulk via the "Download Audios" action in this
                  section's header, alongside "Export" (the full
                  record as JSON). Skipped questions are kept in the
                  list (so the admin can see WHICH questions were
                  skipped, not just that some were) and render with a
                  muted "Skipped by candidate" pill instead of a
                  transcript block. */}
              <section>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold">
                    <MessagesSquare className="h-3.5 w-3.5 text-muted-foreground" />
                    Questions & answers ({answers.length})
                  </h3>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleExportJson}
                    >
                      <Download className="h-4 w-4" />
                      Export
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleDownloadAudios}
                      disabled={downloadingAudio}
                    >
                      {downloadingAudio ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <FileArchive className="h-4 w-4" />
                      )}
                      Download Audios
                    </Button>
                  </div>
                </div>
                {answers.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                    No questions recorded for this session yet.
                  </p>
                ) : (
                  <ol className="space-y-3">
                    {answers.map((a, i) => (
                      <AnswerRow
                        key={a.questionId || i}
                        index={i}
                        answer={a}
                        onJump={hlsReady ? jumpToRecording : undefined}
                      />
                    ))}
                  </ol>
                )}
              </section>
            </div>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

/**
 * One row in the "Questions & answers" list: question text, the
 * Whisper transcript, and the per-question scoring block once the
 * scoring worker has graded the answer.
 *
 * Audio playback is intentionally NOT surfaced: the bytes live in
 * a Block-Public-Access S3 bucket and we don't ship admin
 * audio-playback through the dashboard. The transcript is the
 * canonical record of what the candidate said.
 */
const SKIPPED_TRANSCRIPT_MARKER = "[Skipped by candidate]";

function AnswerRow({
  index,
  answer,
  onJump,
}: {
  index: number;
  answer: import("@/features/interviews/types").InterviewAnswer;
  /** Provided when the recording is streamable — jumps the player to `sec`. */
  onJump?: (sec: number) => void;
}) {
  // Skip detection: the backend stamps the canonical marker on
  // every skipped question (see `interview.service.ts`). Trim
  // before compare so a stray whitespace in legacy data still
  // matches.
  const skipped = answer.transcript.trim() === SKIPPED_TRANSCRIPT_MARKER;
  const askedAtSec =
    typeof answer.askedAtSec === "number" ? answer.askedAtSec : null;
  return (
    <li className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm font-medium leading-snug">{answer.question}</p>

          {/* Recording position this question was asked at — clickable to
              jump the player there when the recording is streamable. */}
          {askedAtSec !== null ? (
            onJump ? (
              <button
                type="button"
                onClick={() => onJump(askedAtSec)}
                title="Jump to this question in the recording"
                className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/20"
              >
                <Play className="h-3 w-3 fill-current" />
                {formatClock(askedAtSec)}
              </button>
            ) : (
              <span
                title="Position in the recording where this question was asked"
                className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
              >
                <Clock className="h-3 w-3" />
                {formatClock(askedAtSec)}
              </span>
            )
          ) : null}

          {skipped ? (
            <Badge variant="muted" className="gap-1">
              <MicOff className="h-3 w-3" />
              Skipped by candidate
            </Badge>
          ) : answer.transcript ? (
            <div className="rounded-md border border-border/60 bg-muted/30 p-2.5">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Transcript
              </p>
              <p className="text-sm leading-snug whitespace-pre-wrap wrap-break-word">
                {answer.transcript}
              </p>
            </div>
          ) : (
            <p className="rounded-md border border-dashed border-border/60 p-2.5 text-xs text-muted-foreground">
              Transcript pending, the scoring worker will fill this in shortly.
            </p>
          )}

          {answer.scores ? (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <Badge variant="outline" className="border-border">
                Technical:{" "}
                {formatScore(answer.scores.technical, { suffix: " / 10" })}
              </Badge>
              <Badge variant="outline" className="border-border">
                Communication:{" "}
                {formatScore(answer.scores.communication, { suffix: " / 10" })}
              </Badge>
              {/* Substance sub-scores that make up Communication — shown muted
                  when the backend split them out (post-fluency-split scores). */}
              {typeof answer.scores.structure === "number" ? (
                <span className="text-muted-foreground">
                  Structure {formatScore(answer.scores.structure)} · Clarity{" "}
                  {formatScore(answer.scores.clarity)} · Concision{" "}
                  {formatScore(answer.scores.concision)}
                </span>
              ) : null}
            </div>
          ) : null}

          {answer.feedback ? (
            <div className="rounded-md border border-border/60 bg-muted/20 p-2.5 text-xs leading-snug text-muted-foreground">
              <span className="mr-1 font-semibold uppercase tracking-wide">
                Feedback:
              </span>
              {answer.feedback}
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/** Format a recording offset (seconds) as a clock string ("1:23" / "1:02:03"). */
function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  }
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

/** Format an overtime/grace duration (seconds) as a compact "Xm Ys" string. */
function formatOvertime(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m === 0) return `${rem}s`;
  if (rem === 0) return `${m}m`;
  return `${m}m ${rem}s`;
}

/** Render a work-history date range ("2021-03 – Present"). */
function formatDateRange(start: string, end: string): string {
  const s = (start || "").trim() || "?";
  const rawEnd = (end || "").trim();
  const e = rawEnd
    ? /^(present|current|now|ongoing)$/i.test(rawEnd)
      ? "Present"
      : rawEnd
    : "?";
  return `${s} – ${e}`;
}

/** Capitalise a lowercase enum token for display ("senior" → "Senior"). */
function titleCase(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * Small pill that shows a proctoring counter.
 */
function ProctoringBadge({
  icon: Icon,
  count,
  singularLabel,
  pluralLabel,
}: {
  icon: LucideIcon;
  count: number;
  singularLabel: string;
  pluralLabel: string;
}) {
  const severe = count >= 2;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        severe
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300",
      )}
    >
      <Icon className="h-3 w-3 shrink-0" />
      {count} {count === 1 ? singularLabel : pluralLabel}
    </span>
  );
}
