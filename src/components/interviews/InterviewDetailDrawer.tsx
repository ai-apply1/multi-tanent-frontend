import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import axios from "axios";
import {
  AlertTriangle,
  Briefcase,
  Calculator,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  EyeOff,
  FileArchive,
  FileText,
  History,
  Loader2,
  Mail,
  Maximize,
  MessagesSquare,
  MicOff,
  Play,
  RefreshCw,
  ShieldAlert,
  TrendingUp,
  User,
  Video,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { ScoringDetailsDialog } from "@/components/interviews/ScoringDetailsDialog";
import {
  HlsPlayer,
  type VideoPlayerHandle,
} from "@/components/interviews/HlsPlayer";
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
import { getCandidate } from "@/features/candidates/candidatesApi";
import {
  formatClock,
  formatRole,
  formatScore,
  formatSessionIdTail,
  formatYears,
  statusLabels,
  statusVariant,
} from "@/features/interviews/helpers";
import type {
  AdminInterviewAttempt,
  AdminInterviewQuestionItem,
  ScoredAnswer,
  ScoringStatus,
} from "@/features/interviews/types";

/**
 * One option in the reattempt version dropdown, e.g. "Attempt 2 (latest)".
 * Only the latest is flagged; the per-attempt score lives in the detail
 * panel below, not the dropdown.
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

/** How often the lightweight scoring-status endpoint is polled while a
 *  (re)scoring run is in flight. */
const SCORING_POLL_MS = 4000;

/** `queued` / `processing` are the two "a run is in flight" states — the
 *  Rescore button is disabled and the status poll runs while either holds. */
function isScoringInFlight(s?: ScoringStatus | null): boolean {
  return s === "queued" || s === "processing";
}

/** The two transcode states that mean "an HLS bundle is on its way". */
function isTranscoding(s?: string | null): boolean {
  return s === "pending" || s === "processing";
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
  /** `publicSessionId` of the attempt to open. `null` renders nothing. */
  sessionId: string | null;
  onOpenChange: (open: boolean) => void;
}

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
 * The banner for a scoring run that didn't produce a verdict.
 *
 * `failed` and `needs_review` are DIFFERENT outcomes and are deliberately not
 * collapsed together:
 *   - `failed`       — the run errored. Destructive tone; a retry is the fix.
 *   - `needs_review` — transcription was unreliable, so the pipeline declined
 *                      to finalize a decision rather than scoring the blanks
 *                      as 0 (which would unfairly reject a real candidate).
 *                      Amber, and phrased as a human-review ask, not a failure.
 */
function ScoringAlert({
  status,
  scoringError,
  trailing,
}: {
  status: "failed" | "needs_review";
  scoringError: string;
  /** Sentence appended after the reason, e.g. what the reviewer can do next. */
  trailing?: string;
}) {
  const needsReview = status === "needs_review";
  const lead = needsReview
    ? "Needs human review — we couldn't reliably transcribe one or more answers, so no decision was finalized"
    : "The last scoring run failed";
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs",
        needsReview
          ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300"
          : "border-destructive/30 bg-destructive/5 text-destructive",
      )}
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        {lead}
        {scoringError ? `: ${scoringError}` : "."}
        {trailing ? ` ${trailing}` : ""}
      </span>
    </div>
  );
}

export function InterviewDetailDrawer({ sessionId, onOpenChange }: Props) {
  // Reattempt history: the drawer is always OPENED on the attempt the caller
  // picked (`sessionId` prop), but the version dropdown lets the reviewer
  // switch to another attempt. `selectedSessionId` overrides which attempt's
  // detail we load; null = follow the prop. Reset whenever the entry point
  // changes so reopening on a different candidate never inherits a selection.
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
    // While the webcam recording is still transcoding to HLS, poll so the
    // player swaps from "preparing…" to the live stream as soon as it's ready
    // — no need for the reviewer to reopen the drawer. Background scoring is
    // NOT watched here: the lightweight scoring-status poll below drives that
    // and refetches this heavy payload exactly once, when it settles.
    refetchInterval: (query) =>
      isTranscoding(query.state.data?.recording?.hlsStatus) ? 5000 : false,
  });

  // --- Background AI-scoring lifecycle ------------------------------------
  // The detail payload carries a `scoringStatus` snapshot, but a rescore runs
  // in the background. Rather than re-pull the heavy detail (transcripts,
  // per-question scores) on a timer, we poll a lightweight status endpoint
  // while a run is in flight and refetch the full detail exactly once, when it
  // settles. `scoringInFlight` is the explicit gate for that poll: seeded from
  // the detail snapshot (someone else's rescore) and from a fresh rescore
  // here, cleared when the poll reaches a terminal state. Reset on attempt
  // switch / reopen so a stale run doesn't leak across.
  const [scoringInFlight, setScoringInFlight] = useState(false);
  const [scoringDetailsOpen, setScoringDetailsOpen] = useState(false);
  useEffect(() => {
    setScoringInFlight(false);
    // Close the scoring-details dialog on attempt switch / reopen so its
    // numbers don't silently swap to a different attempt underneath the reader.
    setScoringDetailsOpen(false);
  }, [activeSessionId]);

  const scoringStatusQuery = useQuery({
    queryKey: ["interviewScoringStatus", activeSessionId],
    queryFn: () => getInterviewScoringStatus(activeSessionId!),
    enabled: Boolean(activeSessionId && scoringInFlight),
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
  // drawer opened right after another reviewer triggered a rescore — start
  // the poll.
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
  // Keyed on the ENTRY-POINT sessionId so switching attempts in the dropdown
  // doesn't refetch the list — the backend resolves every attempt from any one
  // of the candidate's sessionIds.
  const attemptsQuery = useQuery({
    queryKey: ["interviewAttempts", sessionId],
    queryFn: () => getInterviewAttempts(sessionId!),
    enabled: Boolean(sessionId),
  });
  const attempts = attemptsQuery.data ?? [];
  // The version dropdown shows whenever there's at least one attempt (so the
  // reviewer always sees which attempt they're on); the "Reattempted" marker
  // only when there's actually more than one.
  const hasAttempts = attempts.length >= 1;
  const hasMultipleAttempts = attempts.length > 1;

  // The parsed-CV profile lives on the CANDIDATE, not the interview — resolve
  // it from the detail's `candidateId` once that lands. Deliberately the SAME
  // query key + fetcher the candidates slice uses, so opening the drawer from
  // CandidatesPage (which has already loaded this candidate) is a cache hit
  // rather than a second request for the same document. `select` narrows the
  // result to the profile WITHOUT rewriting the cache entry, so the shared
  // shape stays the full CandidateDetail both readers expect.
  const candidateId = data?.candidateId ?? null;
  const profileQuery = useQuery({
    queryKey: ["candidate", candidateId],
    queryFn: () => getCandidate(candidateId!),
    enabled: Boolean(candidateId),
    select: (c) => c.profile,
  });
  const profile = profileQuery.data ?? null;

  const [retranscoding, setRetranscoding] = useState(false);
  const [rescoring, setRescoring] = useState(false);
  const [downloadingAudio, setDownloadingAudio] = useState(false);
  const [downloadingVideo, setDownloadingVideo] = useState(false);

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
      queryClient.setQueryData(["interviewScoringStatus", activeSessionId], {
        sessionId: activeSessionId,
        scoringStatus: res.scoringStatus,
        scoringError: "",
      });
      setScoringInFlight(true);
      toast.success(
        res.alreadyQueued
          ? "Scoring is already running for this interview — watching for it to finish."
          : "Rescoring queued — scores will refresh here once the pipeline finishes.",
      );
    } catch (err) {
      // A 409 carries an explanatory message (e.g. "Only a submitted
      // interview can be rescored…") — surface it verbatim.
      toast.error(errorMessage(err, "Could not queue rescoring."));
    } finally {
      setRescoring(false);
    }
  };

  const questions = useMemo(() => data?.questions ?? [], [data?.questions]);

  /**
   * The authoritative per-answer breakdown lives on `scores.perQuestion`;
   * `questions[].score` is only the headline blend of the two. Join them so a
   * row can show the components it was made of.
   */
  const scoredByQuestionId = useMemo(() => {
    const map = new Map<string, ScoredAnswer>();
    for (const p of data?.scores?.perQuestion ?? []) {
      map.set(String(p.questionId), p);
    }
    return map;
  }, [data?.scores?.perQuestion]);

  // Imperative handle to the HLS player so a "jump to question" chip can seek
  // the recording. Populated by HlsPlayer while it's mounted (HLS ready).
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
  const chapters = useMemo(
    () =>
      questions
        .filter((q) => typeof q.askedAtSec === "number")
        .map((q) => ({ atSec: q.askedAtSec as number, label: q.text })),
    [questions],
  );
  // Jump chips only act when the HLS player is actually mounted (recording
  // ready); otherwise the timestamp renders as a static label.
  const hlsReady = Boolean(data?.webcamHlsUrl);

  // A 404 means the interview doc is gone (deleted, or the candidate row was
  // removed and took its S3 subtree with it) — surface a clear explanation
  // instead of a generic "failed to load".
  const is404 =
    isError && axios.isAxiosError(error) && error.response?.status === 404;

  /**
   * Open the CV in a new tab using a freshly-minted presigned GET
   * URL. Same popup-blocker-safe pattern as the candidates page:
   * open a blank tab synchronously within the click, redirect once
   * the URL arrives, fall back to a same-tab navigate if the popup
   * was blocked. Required because the S3 bucket is private.
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
      // The 404 body explains it precisely ("Interview has no CV on file." /
      // "CV file no longer exists in storage.") — don't flatten that away.
      toast.error(errorMessage(err, "Could not open CV."));
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

  /**
   * Download every candidate answer's audio as a single zip. The bytes live
   * in a private S3 bucket, so this hits an auth-gated backend endpoint that
   * streams them into a zip (see `downloadInterviewAnswersAudio`). A 404
   * means the interview carries no answer audio (all skipped, or an
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

  // Nothing to show without a session. Every hook above has already run, so
  // this early return can't change the hook order between renders.
  if (!sessionId) return null;

  const recording = data?.recording;
  const hlsStatus = recording?.hlsStatus ?? null;
  const durationSec = recording?.durationSec ?? 0;
  const qualitative = data?.scores?.qualitative;

  return (
    <Sheet open onOpenChange={onOpenChange}>
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
                  {data ? (
                    <Badge variant={statusVariant[data.status]}>
                      {statusLabels[data.status]}
                    </Badge>
                  ) : null}
                  {hasMultipleAttempts ? (
                    <Badge variant="outline" className="gap-1">
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
                <Button variant="outline" size="sm" onClick={handleOpenCv}>
                  <FileText className="h-4 w-4" />
                  Open CV
                  <ExternalLink className="h-3 w-3" />
                </Button>
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
                This interview is no longer available. It was most likely
                deleted, or removed along with the candidate it belonged to.
              </p>
            </div>
          ) : isError || !data ? (
            <div className="flex h-72 flex-col items-center justify-center gap-3 text-sm text-destructive">
              Could not load the interview.
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
                  <div className="min-w-0">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Candidate
                    </p>
                    <p className="truncate text-sm font-medium">
                      {data.candidateName || "—"}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3">
                  <Briefcase className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Job
                    </p>
                    <p className="truncate text-sm font-medium">
                      {data.jobTitle || "—"}
                    </p>
                  </div>
                </div>
              </section>

              {/* --- Proctoring signals --- */}
              {data.proctoring.fullscreenExitCount > 0 ||
              data.proctoring.tabHiddenCount > 0 ? (
                <section>
                  <h3 className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold">
                    <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
                    Proctoring signals
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {data.proctoring.fullscreenExitCount > 0 ? (
                      <ProctoringBadge
                        icon={Maximize}
                        count={data.proctoring.fullscreenExitCount}
                        singularLabel="fullscreen exit"
                        pluralLabel="fullscreen exits"
                      />
                    ) : null}
                    {data.proctoring.tabHiddenCount > 0 ? (
                      <ProctoringBadge
                        icon={EyeOff}
                        count={data.proctoring.tabHiddenCount}
                        singularLabel="tab switch"
                        pluralLabel="tab switches"
                      />
                    ) : null}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    These feed the integrity score, which is flag-only — it
                    never fails a candidate on its own.
                  </p>
                </section>
              ) : null}

              {/* --- Timing / overtime --- */}
              {data.proctoring.graceUsedSec > 0 ? (
                <section>
                  <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                    <Clock className="h-3.5 w-3.5 text-amber-500" />
                    Timing
                  </h3>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-600 dark:text-amber-300">
                    <Clock className="h-3 w-3 shrink-0" />
                    Used {formatOvertime(data.proctoring.graceUsedSec)} of extra
                    time past the limit
                  </span>
                </section>
              ) : null}

              {/* --- Profile: role + evidence, summary, tech, work history ---

                  Sourced from the CANDIDATE document (the parsed-CV cache),
                  not the interview — hence the separate query. Absent for a
                  candidate whose CV never parsed. */}
              {profileQuery.isLoading ? (
                <section className="inline-flex items-center gap-2 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading profile…
                </section>
              ) : profile ? (
                <section>
                  <h3 className="mb-2 text-sm font-semibold">Profile</h3>
                  <div className="rounded-lg border border-border bg-muted/30 p-3">
                    <p className="text-sm font-medium">
                      {profile.primaryRole
                        ? formatRole(profile.primaryRole)
                        : "—"}
                      {typeof profile.yearsOfExperience === "number"
                        ? ` · ${formatYears(profile.yearsOfExperience)}y`
                        : ""}
                      {profile.seniority && profile.seniority !== "unknown"
                        ? ` · ${titleCase(profile.seniority)}`
                        : ""}
                    </p>
                    {profile.primaryRoleEvidence ? (
                      <p className="mt-1 text-xs leading-snug text-muted-foreground">
                        {profile.primaryRoleEvidence}
                      </p>
                    ) : null}
                  </div>
                  {profile.summary ? (
                    <p className="mt-2 rounded-lg border border-border bg-muted/30 p-3 text-sm leading-relaxed">
                      {profile.summary}
                    </p>
                  ) : null}
                  {profile.technologies?.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {profile.technologies.map((t) => (
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
                  {profile.workHistory?.length ? (
                    <div className="mt-3">
                      <p className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                        Work history · years computed from these dates
                      </p>
                      <ul className="space-y-1.5">
                        {profile.workHistory.map((wh, i) => (
                          <li
                            key={`${wh.title}-${wh.company}-${i}`}
                            className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm"
                          >
                            <span className="min-w-0">
                              <span className="font-medium">
                                {wh.title || "—"}
                              </span>
                              {wh.company ? (
                                <span className="text-muted-foreground">
                                  {" "}
                                  · {wh.company}
                                </span>
                              ) : null}
                              {!wh.isTechRole ? (
                                <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                                  non-tech
                                </span>
                              ) : null}
                            </span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {formatDateRange(wh.start, wh.end)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </section>
              ) : null}

              {/*
                Attempt switcher — lists every attempt oldest to newest, the
                one on screen pre-selected; picking one loads that attempt's
                full detail. Prior attempts' recordings/transcripts/scores are
                kept on the backend so reviewers can compare.
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

                  We ALWAYS render this section (heading + body) so the
                  reviewer can tell "no recording was uploaded for this
                  session" apart from "the drawer is broken". An empty
                  `webcamVideoUrl` + no HLS happens when the candidate closed
                  the tab / lost network before the upload landed. */}
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
                  // Transcode finished — stream the HLS bundle.
                  <HlsPlayer
                    key={data.webcamHlsUrl}
                    manifestUrl={data.webcamHlsUrl}
                    durationSec={durationSec}
                    chapters={chapters}
                    apiRef={playerApiRef}
                  />
                ) : hlsStatus === "failed" ? (
                  <div className="space-y-3">
                    <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        Couldn&apos;t prepare the streaming version of this
                        recording
                        {recording?.hlsError ? `: ${recording.hlsError}` : "."}
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
                        knownDurationSec={durationSec}
                        ariaLabel={`Webcam recording for ${data.candidateName || "candidate"}`}
                      />
                    ) : null}
                  </div>
                ) : isTranscoding(hlsStatus) ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                      Preparing a streamable version of this recording…
                      {recording?.hlsProgress
                        ? ` ${Math.round(recording.hlsProgress)}%`
                        : ""}
                    </div>
                    {/* Play the original meanwhile (deleted once HLS is ready). */}
                    {data.webcamVideoUrl ? (
                      <VideoPlayer
                        src={data.webcamVideoUrl}
                        knownDurationSec={durationSec}
                        ariaLabel={`Webcam recording for ${data.candidateName || "candidate"}`}
                      />
                    ) : null}
                  </div>
                ) : data.webcamVideoUrl ? (
                  // Recording present, transcode not started (the detail GET
                  // lazily queues one) — play the raw proxy meanwhile.
                  <VideoPlayer
                    src={data.webcamVideoUrl}
                    knownDurationSec={durationSec}
                    ariaLabel={`Webcam recording for ${data.candidateName || "candidate"}`}
                  />
                ) : (
                  <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                    No webcam recording was uploaded for this session. The
                    candidate may have closed the tab before the upload
                    completed, or lost network.
                  </p>
                )}
              </section>

              {/* --- Overall scores ---

                  The scorer produces two per-dimension scores (technical /
                  communication) plus the job-weighted overall. We render those
                  three tiles here; the per-question breakdown lives further
                  down in "Questions & answers". The Rescore action re-queues
                  the full AI scoring pipeline for this attempt — only
                  submitted interviews are scorable, hence the status gate. */}
              {data.scores ? (
                <section>
                  <ScoringDetailsDialog
                    open={scoringDetailsOpen}
                    onOpenChange={setScoringDetailsOpen}
                    candidateName={data.candidateName}
                    scores={data.scores}
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
                  {/* A rescore that failed / needs review keeps the PREVIOUS
                      run's numbers on screen — call that out so the reviewer
                      knows the tiles below aren't from the latest run. */}
                  {scoringStatus === "failed" ||
                  scoringStatus === "needs_review" ? (
                    <div className="mb-2">
                      <ScoringAlert
                        status={scoringStatus}
                        scoringError={scoringError}
                        trailing="The scores below are from the previous successful run — rescore to retry."
                      />
                    </div>
                  ) : null}
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <ScoreStat label="Overall" value={data.scores.overall} />
                    <ScoreStat label="Technical" value={data.scores.technical} />
                    <ScoreStat
                      label="Communication"
                      value={data.scores.communication}
                    />
                  </div>
                  {/* Integrity + coverage — meta signals, not rubric
                      dimensions. Integrity is anti-cheat (flag-only); a low
                      value is highlighted amber so reviewers look closer.
                      Coverage is how much of the interview was answered. */}
                  {data.scores.integrity ||
                  typeof data.scores.coverage === "number" ? (
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      {typeof data.scores.coverage === "number" ? (
                        <span className="rounded-md border border-border bg-muted/30 px-2 py-1">
                          Answered {Math.round(data.scores.coverage * 100)}% of
                          questions
                        </span>
                      ) : null}
                      {data.scores.integrity ? (
                        <span
                          className={cn(
                            "rounded-md border px-2 py-1",
                            data.scores.integrity.score < 6
                              ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300"
                              : "border-border bg-muted/30",
                          )}
                        >
                          Integrity{" "}
                          {formatScore(data.scores.integrity.score, {
                            suffix: " / 10",
                          })}
                          {data.scores.integrity.score < 6 ? ", review" : ""}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  {data.scores.summary ? (
                    <p className="mt-3 rounded-lg border border-border bg-muted/30 p-3 text-sm leading-relaxed">
                      {data.scores.summary}
                    </p>
                  ) : null}
                  {/* The narrative block. NOTE: the backend already appends the
                      proctoring integrity flags onto `redFlags`, so there's no
                      separate integrity-flags list to render — that would just
                      duplicate them. */}
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {qualitative?.strengths?.length ? (
                      <div className="rounded-lg border border-border bg-card p-3">
                        <p className="mb-1 inline-flex items-center gap-1 text-xs font-semibold text-success">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Strengths
                        </p>
                        <ul className="list-disc space-y-1 pl-5 text-sm">
                          {qualitative.strengths.map((s) => (
                            <li key={s}>{s}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {/* Always surface a weak side — even for a strong/passing
                        candidate. Prefer the always-on constructive
                        "weaknesses"; fall back to red flags when absent. */}
                    {qualitative?.weaknesses?.length ||
                    qualitative?.redFlags?.length ? (
                      <div className="rounded-lg border border-border bg-card p-3">
                        <p className="mb-1 inline-flex items-center gap-1 text-xs font-semibold text-amber-600 dark:text-amber-300">
                          <TrendingUp className="h-3.5 w-3.5" />
                          Areas to improve
                        </p>
                        <ul className="list-disc space-y-1 pl-5 text-sm">
                          {(qualitative.weaknesses?.length
                            ? qualitative.weaknesses
                            : qualitative.redFlags
                          ).map((s) => (
                            <li key={s}>{s}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {/* Serious concerns shown separately — only when we also
                        have weaknesses above, otherwise red flags already ARE
                        the "areas to improve" content and we'd duplicate them. */}
                    {qualitative?.weaknesses?.length &&
                    qualitative?.redFlags?.length ? (
                      <div className="rounded-lg border border-border bg-card p-3">
                        <p className="mb-1 inline-flex items-center gap-1 text-xs font-semibold text-destructive">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          Red flags
                        </p>
                        <ul className="list-disc space-y-1 pl-5 text-sm">
                          {qualitative.redFlags.map((s) => (
                            <li key={s}>{s}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                </section>
              ) : data.status === "submitted" ? (
                // Submitted but unscored — the run is either in flight
                // (queued/processing), failed, parked for human review, or
                // never ran (idle). Drive the copy + action off the live status
                // so the reviewer sees exactly what's happening and can
                // (re)queue without leaving the drawer.
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
                      <ScoringAlert
                        status={scoringStatus}
                        scoringError={scoringError}
                        trailing="You can retry it here."
                      />
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
                  No scoring available yet — this interview hasn&apos;t been
                  submitted.
                </section>
              )}

              <Separator />

              {/* --- Per-question answers (transcript + scores) ---

                  One row per question the candidate was asked, in ask-order.
                  Skipped questions are kept in the list (so the reviewer can
                  see WHICH ones were skipped, not just that some were) and
                  render with a muted pill instead of a transcript block. */}
              <section>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold">
                    <MessagesSquare className="h-3.5 w-3.5 text-muted-foreground" />
                    Questions & answers ({questions.length})
                  </h3>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" onClick={handleExportJson}>
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
                {questions.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                    No questions recorded for this session yet.
                  </p>
                ) : (
                  <ol className="space-y-3">
                    {questions.map((q, i) => (
                      <AnswerRow
                        key={q.questionId || i}
                        index={i}
                        question={q}
                        scored={scoredByQuestionId.get(q.questionId)}
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
 * The marker the backend stamps as the transcript of every question the
 * candidate explicitly skipped. The item also carries an explicit `skipped`
 * flag now; we check both so a record written either way renders the same.
 */
const SKIPPED_TRANSCRIPT_MARKER = "[Skipped by candidate]";

/**
 * One row in the "Questions & answers" list: the question as it was actually
 * asked, the job's original wording behind it, the transcript, and the
 * per-question scoring once the worker has graded the answer.
 */
function AnswerRow({
  index,
  question,
  scored,
  onJump,
}: {
  index: number;
  question: AdminInterviewQuestionItem;
  /** The authoritative per-answer breakdown, joined by questionId. */
  scored?: ScoredAnswer;
  /** Provided when the recording is streamable — jumps the player to `sec`. */
  onJump?: (sec: number) => void;
}) {
  const skipped =
    question.skipped ||
    question.transcript.trim() === SKIPPED_TRANSCRIPT_MARKER;
  const askedAtSec =
    typeof question.askedAtSec === "number" ? question.askedAtSec : null;

  return (
    <li className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          {/* The exact words this candidate was asked. There is no "source"
              wording to compare against: every wording in the bank is one HR
              approved, and this is simply the one they drew. Candidates for
              the same job are comparable because the question and its
              position are identical — only the words differ. */}
          <p className="text-sm font-medium leading-snug">{question.text}</p>

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
          ) : question.transcript ? (
            <div className="rounded-md border border-border/60 bg-muted/30 p-2.5">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Transcript
              </p>
              <p className="text-sm leading-snug whitespace-pre-wrap wrap-break-word">
                {question.transcript}
              </p>
            </div>
          ) : (
            <p className="rounded-md border border-dashed border-border/60 p-2.5 text-xs text-muted-foreground">
              Transcript pending, the scoring worker will fill this in shortly.
            </p>
          )}

          {/* The candidate's own answer audio. The URL is a presigned GET with
              a 10-MINUTE TTL minted when the detail was fetched — a drawer left
              open longer than that will 403 until the detail refetches. Hence
              `preload="none"`: don't spend the TTL until the reviewer presses
              play. */}
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
              <Badge variant="outline" className="border-border">
                Technical: {formatScore(scored.technical, { suffix: " / 10" })}
              </Badge>
              <Badge variant="outline" className="border-border">
                Communication:{" "}
                {formatScore(scored.communication, { suffix: " / 10" })}
              </Badge>
              {/* Substance sub-scores that make up Communication. */}
              {typeof scored.structure === "number" ? (
                <span className="text-muted-foreground">
                  Structure {formatScore(scored.structure)} · Clarity{" "}
                  {formatScore(scored.clarity)} · Concision{" "}
                  {formatScore(scored.concision)}
                </span>
              ) : null}
              {typeof scored.weight === "number" && scored.weight !== 1 ? (
                <span className="text-muted-foreground">
                  Weight ×{scored.weight}
                </span>
              ) : null}
            </div>
          ) : typeof question.score === "number" ? (
            // Scored before the audit detail existed (or the join missed) —
            // the headline blend is still on the item itself.
            <Badge variant="outline" className="border-border text-[11px]">
              Score: {formatScore(question.score, { suffix: " / 10" })}
            </Badge>
          ) : null}

          {question.feedback ? (
            <div className="rounded-md border border-border/60 bg-muted/20 p-2.5 text-xs leading-snug text-muted-foreground">
              <span className="mr-1 font-semibold uppercase tracking-wide">
                Feedback:
              </span>
              {question.feedback}
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
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

/** Small pill that shows a proctoring counter. */
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
