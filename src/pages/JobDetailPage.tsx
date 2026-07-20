import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronDown,
  Clock,
  Loader,
  Loader2,
  Pencil,
  Search,
  Share2,
  Star,
  Upload,
  User,
  UserCheck,
  Users,
  X as XIcon,
} from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Markdown } from "@/components/Markdown";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { JobQuestionsManager } from "@/features/jobs/components/JobQuestionsManager";
import { JobShareDialog } from "@/features/jobs/components/JobShareDialog";
import { getJob, setJobStatus } from "@/features/jobs/jobsApi";
import {
  EMPLOYMENT_TYPE_LABELS,
  JOB_STATUS_LABELS,
  SENIORITY_LABELS,
  STATUS_TRANSITIONS,
  WORK_MODE_LABELS,
  type Job,
  type JobStatus,
} from "@/features/jobs/types";
import { useOrganization } from "@/features/organization/useOrganization";
import { UploadCvsDialog } from "@/features/candidates/components/UploadCvsDialog";
import {
  getCandidate,
  getCandidateKanban,
  listCandidateStatuses,
  listCandidates,
} from "@/features/candidates/candidatesApi";
import { invalidateCandidateData } from "@/features/candidates/candidatesCache";
import { aiScoreState, type AiScoreState } from "@/features/candidates/aiScore";
import type {
  CandidateListItem,
  CandidateStatus,
} from "@/features/candidates/types";
import { InterviewDetailDrawer } from "@/components/interviews/InterviewDetailDrawer";
import { ROUTES, jobEdit } from "@/routes";
import { errorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/date";
import { cn } from "@/lib/utils";
import { JobStatusBadge } from "./JobsPage";

type TabId = "overview" | "questions" | "candidates";

/** Radix `Select` forbids empty values — sentinel for the "all statuses" case. */
const ALL_STATUSES = "all";

/**
 * Stage badge tint. Mirrors the helper used by CandidatesPage so the two
 * views can't drift — org-owned hue washed onto surface via color-mix, with
 * a neutral fallback when the operator cleared the colour.
 */
function stageBadgeStyle(color: string | null | undefined) {
  if (!color) {
    return {
      backgroundColor: "var(--surface-3)",
      color: "var(--ink-muted)",
    };
  }
  return {
    backgroundColor: `color-mix(in oklab, ${color}, white 88%)`,
    color,
  };
}

/** Two initials for the avatar bubble. Empty collapses to a single dash. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function JobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabId>("overview");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  // The drawer is keyed by `publicSessionId`, but candidate rows only ship
  // the interview's raw ObjectId — so opening the drawer is a two-step:
  // remember the candidate, read the detail, hand the drawer the resolved
  // session id. Same pattern as CandidatesPage.
  const [drawerCandidateId, setDrawerCandidateId] = useState<string | null>(
    null,
  );

  const {
    data: job,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => getJob(jobId!),
    enabled: Boolean(jobId),
  });

  const statusMutation = useMutation({
    mutationFn: (status: JobStatus) => setJobStatus(jobId!, status),
    onSuccess: (saved) => {
      toast.success(`Job ${JOB_STATUS_LABELS[saved.status].toLowerCase()}.`);
      queryClient.setQueryData(["job", saved._id], saved);
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (err) => {
      toast.error(errorMessage(err, "Could not change the job status."));
      // A rejected transition almost always means THIS TAB IS STALE: the job
      // moved on somewhere else (another tab, another user, a script) and the
      // menu was built from the status we last cached. Without a refetch the
      // page keeps offering the same impossible transition and the user can
      // only fail again — refetch so the badge and the menu rebuild from the
      // job's real status.
      void queryClient.invalidateQueries({ queryKey: ["job", jobId] });
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });

  /*
   * The job's board, for the KPI strip's counts.
   *
   * One request for all four numbers instead of four filtered count queries.
   * The trade is payload: the response also carries up to 25 candidate rows
   * per column, which the strip throws away. Worth it for a single round trip
   * and one cache entry; if it ever bites, the honest fix is a counts-only
   * endpoint rather than fanning out here.
   */
  const boardQuery = useQuery({
    queryKey: ["candidateKanban", jobId],
    queryFn: () => getCandidateKanban(jobId!),
    enabled: Boolean(jobId),
  });

  /*
   * Counts + labels for the four tiles.
   *
   * Renders a dash, never a zero, until the board lands: "0 applicants" and
   * "not loaded yet" are different claims, and a job page that flashes four
   * zeroes on every open reads as an empty funnel.
   */
  const kpi = useMemo(() => {
    const columns = boardQuery.data?.columns;
    // `count: null` means NOT LOADED, which the renderers show as a dash.
    // Distinct from 0 on purpose: "no applicants" and "we do not know yet"
    // are different claims, and a job page that flashes zeroes on every open
    // reads as an empty funnel.
    const stage = (key: string, fallbackLabel: string) => {
      const column = columns?.find((c) => c.key === key);
      return {
        label: column?.label || fallbackLabel,
        count: column ? column.count : null,
      };
    };
    return {
      total: columns ? columns.reduce((sum, c) => sum + c.count, 0) : null,
      shortlisted: stage("shortlisted", "Shortlisted"),
      finalRejected: stage("final_rejected", "Final Rejection"),
      hired: stage("hired", "Finalized"),
    };
  }, [boardQuery.data]);
  // Resolve `publicSessionId` for the drawer target.
  const detailQuery = useQuery({
    queryKey: ["candidate", drawerCandidateId],
    queryFn: () => getCandidate(drawerCandidateId as string),
    enabled: Boolean(drawerCandidateId),
  });
  const interviewSessionId =
    detailQuery.data?.latestInterviewId?.publicSessionId ?? null;

  useEffect(() => {
    if (!detailQuery.isError) return;
    toast.error(
      errorMessage(detailQuery.error, "Could not open the interview."),
    );
    setDrawerCandidateId(null);
  }, [detailQuery.isError, detailQuery.error]);

  const invalidateCandidates = () => invalidateCandidateData(queryClient);

  if (isLoading) {
    return <JobDetailSkeleton />;
  }

  if (isError || !job) {
    return (
      <div className="mx-auto max-w-[1240px] px-6 py-6 lg:px-8 lg:py-8">
        <div className="rounded-2xl border border-line bg-surface">
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-[13.5px] text-[var(--danger)]">
              {errorMessage(error, "Could not load this job.")}
            </p>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => refetch()}>
                Retry
              </Button>
              <Button size="sm" onClick={() => navigate(ROUTES.JOBS)}>
                Back to jobs
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const transitions = STATUS_TRANSITIONS[job.status];
  const classification = [
    job.employmentType ? EMPLOYMENT_TYPE_LABELS[job.employmentType] : null,
    job.workMode ? WORK_MODE_LABELS[job.workMode] : null,
    job.seniorityLevel ? SENIORITY_LABELS[job.seniorityLevel] : null,
  ].filter((c): c is string => Boolean(c));

  // Row click → drawer. The drawer accepts a bare candidate id (falling back
  // to the per-tab "no interview yet" empty states) so rejected pre-screens
  // and invited-but-not-started candidates open the same surface as everyone
  // else — clicking a row is never a silent no-op.
  const handleRowClick = (row: CandidateListItem) => {
    setDrawerCandidateId(row._id);
  };

  return (
    <div className="mx-auto max-w-[1240px] px-6 py-6 lg:px-8 lg:py-8">
      {/* Breadcrumb */}
      <div className="mb-3 flex items-center gap-2 text-[13px] text-ink-muted">
        <Link
          to={ROUTES.JOBS}
          className="font-medium text-ink-muted hover:text-ink"
        >
          Jobs
        </Link>
        <span className="text-ink-subtle">/</span>
        <span className="truncate font-semibold text-ink">{job.title}</span>
      </div>

      {/* Header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[24px] font-semibold tracking-tight text-ink">
              {job.title}
            </h1>
            <JobStatusBadge status={job.status} />
          </div>
          {classification.length > 0 ? (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {classification.map((chip) => (
                <span
                  key={chip}
                  className="rounded-full bg-surface-3 px-2.5 py-1 text-[12px] font-semibold text-ink-2"
                >
                  {chip}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {transitions.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={statusMutation.isPending}
                >
                  {statusMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  Change job status
                  <ChevronDown className="h-4 w-4" strokeWidth={1.9} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {transitions.map((t) => (
                  <DropdownMenuItem
                    key={t.status}
                    onSelect={() => statusMutation.mutate(t.status)}
                  >
                    {t.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShareOpen(true)}
          >
            <Share2 className="h-4 w-4" strokeWidth={1.9} />
            Share
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate(jobEdit(job._id))}
          >
            <Pencil className="h-4 w-4" strokeWidth={1.9} />
            Edit
          </Button>
          <Button size="sm" onClick={() => setUploadOpen(true)}>
            <Upload className="h-4 w-4" strokeWidth={1.9} />
            Upload CVs
          </Button>
        </div>
      </div>

      <JobShareDialog jobId={job._id} open={shareOpen} onOpenChange={setShareOpen} />

      {/*
        KPI strip, counted from the job's own board.

        These tiles read "no matching API" and showed a dash for every job.
        There is one: the kanban returns each column with its TRUE total
        (`count`, independent of the 25-row `candidates` cap), which is exactly
        a per-status count for one job.

        "Applied" is the SUM of every column, not the `applied` column: every
        candidate sits in exactly one column, so the sum is how many people
        applied to this job. Reading the `applied` column instead would show 0
        for a job whose applicants had all been processed, which is the
        opposite of what the tile means.

        The other three take their labels from the catalog, so an org that
        renames a column renames the tile with it. Defaults match the builtin
        labels ("Final Rejection", "Finalized").
      */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Applied"
          value={countLabel(kpi.total)}
          icon={<User className="h-4 w-4" strokeWidth={1.9} />}
          tint="var(--stage-applied)"
        />
        <KpiCard
          label={kpi.shortlisted.label}
          value={countLabel(kpi.shortlisted.count)}
          icon={<Star className="h-4 w-4" strokeWidth={1.9} />}
          tint="var(--stage-shortlisted)"
        />
        <KpiCard
          label={kpi.finalRejected.label}
          value={countLabel(kpi.finalRejected.count)}
          icon={<XIcon className="h-4 w-4" strokeWidth={2.1} />}
          tint="var(--danger)"
        />
        <KpiCard
          label={kpi.hired.label}
          value={countLabel(kpi.hired.count)}
          icon={<UserCheck className="h-4 w-4" strokeWidth={1.9} />}
          tint="var(--success)"
        />
      </div>

      {/* Tabs (underline style). */}
      <div className="mb-5 flex gap-6 border-b border-line">
        <TabButton
          active={tab === "overview"}
          onClick={() => setTab("overview")}
        >
          Overview
        </TabButton>
        <TabButton
          active={tab === "questions"}
          onClick={() => setTab("questions")}
        >
          Questions
        </TabButton>
        <TabButton
          active={tab === "candidates"}
          onClick={() => setTab("candidates")}
        >
          Candidates
        </TabButton>
      </div>

      {tab === "overview" ? (
        <OverviewTab job={job} kpi={kpi} />
      ) : tab === "questions" ? (
        <JobQuestionsManager job={job} />
      ) : (
        <CandidatesTab
          jobId={job._id}
          jobTitle={job.title}
          onRowClick={handleRowClick}
          onUpload={() => setUploadOpen(true)}
          resolvingCandidateId={
            detailQuery.isLoading ? drawerCandidateId : null
          }
        />
      )}

      {/* Upload dialog — mounted once, opened by both the header CTA and the
          Candidates empty-state CTA. */}
      <UploadCvsDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        jobId={job._id}
        jobTitle={job.title}
        onImported={invalidateCandidates}
      />

      <InterviewDetailDrawer
        sessionId={interviewSessionId}
        candidateId={drawerCandidateId}
        onOpenChange={(open) => {
          if (!open) setDrawerCandidateId(null);
        }}
      />
    </div>
  );
}

// ── Overview tab ─────────────────────────────────────────────────────

function OverviewTab({ job, kpi }: { job: Job; kpi: JobKpi }) {
  const { data: organization } = useOrganization();
  const requiredSkills = job.eligibility.requiredSkills;

  return (
    <div className="grid gap-4 lg:grid-cols-[1.55fr_1fr] lg:items-start">
      {/* Left column */}
      <div className="grid gap-4">
        <SectionCard>
          <h2 className="mb-3 text-[15px] font-semibold text-ink">
            Job description
          </h2>
          {job.description.trim() ? (
            <div className="text-[13.5px] leading-relaxed text-ink-2">
              <Markdown content={job.description} />
            </div>
          ) : (
            <p className="text-[13.5px] text-ink-muted">
              No description provided yet.
            </p>
          )}

          <div className="mt-5">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-subtle">
              Required skills
            </div>
            {requiredSkills.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {requiredSkills.map((skill) => (
                  <span
                    key={skill}
                    className="rounded-full bg-accent px-2.5 py-1 text-[12px] font-semibold text-primary"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-ink-muted">None required.</p>
            )}
          </div>

          <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <MetaCell label="Score split">
              <span className="mono">
                {job.scoringWeights.technical}% /{" "}
                {job.scoringWeights.communication}%
              </span>
            </MetaCell>
            <MetaCell label="Threshold">
              <span className="mono">{job.rejectionThreshold}</span>
            </MetaCell>
            <MetaCell label="City gate">
              {job.eligibility.city || <Dash />}
            </MetaCell>
            <MetaCell label="Min. experience">
              {job.eligibility.minYearsExperience === null ? (
                <Dash />
              ) : (
                <span className="mono">
                  {job.eligibility.minYearsExperience} yrs
                </span>
              )}
            </MetaCell>
            <MetaCell label="Interview attempts">
              {job.maxAttempts === null ? (
                <span className="text-ink-muted">
                  Org default
                  {organization
                    ? ` (${organization.settings.maxInterviewAttempts})`
                    : ""}
                </span>
              ) : (
                <span className="mono">{job.maxAttempts}</span>
              )}
            </MetaCell>
            <MetaCell label="Shortlist threshold">
              <span className="mono">{job.rejectionThreshold}</span>
            </MetaCell>
          </div>
        </SectionCard>

        <SectionCard>
          <div className="mb-3.5 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-ink">
              Top ranked candidates
            </h2>
          </div>
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line-2 px-6 py-10 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-primary">
              <Users className="h-5 w-5" strokeWidth={1.7} />
            </span>
            <p className="text-[13.5px] font-semibold text-ink">
              No candidates have completed their interview yet
            </p>
            <p className="max-w-[340px] text-[12.5px] text-ink-muted">
              Share the invite link on the right — completed interviews will be
              ranked here.
            </p>
          </div>
        </SectionCard>
      </div>

      {/* Right column. `sticky` inside the two-column grid keeps the funnel
          card pinned as the left column (description + top candidates) scrolls
          past — the top offset is the 60px TopBar height + a small breathing
          gap. Falls back to normal flow on narrow layouts where the columns
          stack. */}
      <div className="grid gap-4 lg:sticky lg:top-3 lg:self-start">
        <FunnelCard kpi={kpi} />
      </div>
    </div>
  );
}

// ── Candidates tab ────────────────────────────────────────────────────

/**
 * Job-scoped candidates table. Rides the same list endpoint the org-wide
 * Candidates page uses, filtered to this job. Row click opens the interview
 * drawer via a two-step candidate → publicSessionId resolve; rows without an
 * interview toast the reason (the drawer is session-keyed).
 */
function CandidatesTab({
  jobId,
  jobTitle,
  onRowClick,
  onUpload,
  resolvingCandidateId,
}: {
  jobId: string;
  jobTitle: string;
  onRowClick: (row: CandidateListItem) => void;
  onUpload: () => void;
  resolvingCandidateId: string | null;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(ALL_STATUSES);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["candidates", { jobId, limit: 100 }],
    queryFn: () => listCandidates({ jobId, limit: 100 }),
  });

  const statusesQuery = useQuery({
    queryKey: ["candidateStatuses"],
    queryFn: listCandidateStatuses,
    staleTime: 5 * 60_000,
  });
  const statuses = useMemo<CandidateStatus[]>(
    () => statusesQuery.data ?? [],
    [statusesQuery.data],
  );
  const statusByKey = useMemo(
    () => new Map(statuses.map((s) => [s.key, s])),
    [statuses],
  );

  const rows = data?.data ?? [];
  const total = data?.count ?? rows.length;

  // Local filter — the spec calls for search-by-name/email and a status
  // dropdown that filters in-place rather than firing a new list read.
  const term = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (
        statusFilter !== ALL_STATUSES &&
        row.currentStatusId.key !== statusFilter
      ) {
        return false;
      }
      if (!term) return true;
      const hay = `${row.fullName ?? ""} ${row.email ?? ""}`.toLowerCase();
      return hay.includes(term);
    });
  }, [rows, term, statusFilter]);

  const shownCount = filtered.length;

  return (
    <div className="rounded-2xl border border-line bg-surface">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-[18px] py-[15px]">
        <div className="min-w-0">
          <span className="text-[13.5px] font-semibold text-ink">
            {shownCount} applicant{shownCount === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex-1" />
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or email…"
            className="h-9 w-full rounded-full border border-[var(--field-border)] bg-surface pl-9 pr-3 text-[13px] text-ink outline-none placeholder:text-ink-subtle focus:border-primary focus:shadow-[0_0_0_3px_var(--accent-ring)]"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger
            className="h-9 w-full shrink-0 rounded-full sm:w-[170px]"
            style={
              statusFilter !== ALL_STATUSES
                ? stageBadgeStyle(statusByKey.get(statusFilter)?.color)
                : undefined
            }
            aria-label="Status"
          >
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_STATUSES}>All statuses</SelectItem>
            {statuses.map((status) => (
              <SelectItem key={status._id} value={status.key}>
                <span className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{
                      backgroundColor: status.color ?? "var(--ink-muted)",
                    }}
                  />
                  {status.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Grid header */}
      <div
        className="grid items-center gap-3 border-b border-line bg-surface-3 px-[18px] py-2.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-muted"
        style={{ gridTemplateColumns: "1.7fr 1.3fr auto 1fr 0.8fr" }}
      >
        <span>Candidate</span>
        <span>Role</span>
        <span>Status</span>
        <span>AI score</span>
        <span>Date</span>
      </div>

      {isLoading ? (
        <div className="grid">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="grid items-center gap-3 border-b border-line px-[18px] py-3.5 last:border-b-0"
              style={{ gridTemplateColumns: "1.7fr 1.3fr auto 1fr 0.8fr" }}
            >
              <div className="flex items-center gap-2.5">
                <div className="h-[34px] w-[34px] shrink-0 animate-pulse rounded-full bg-surface-3" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="h-3 w-32 animate-pulse rounded bg-surface-3" />
                  <div className="h-2.5 w-40 animate-pulse rounded bg-surface-3" />
                </div>
              </div>
              <div className="h-3 w-24 animate-pulse rounded bg-surface-3" />
              <div className="h-5 w-20 animate-pulse rounded-full bg-surface-3" />
              <div className="h-2 w-[54px] animate-pulse rounded-full bg-surface-3" />
              <div className="h-3 w-16 animate-pulse rounded bg-surface-3" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center gap-2 px-6 py-16 text-center text-[13px] text-[var(--danger)]">
          Could not load candidates.
          <button onClick={() => refetch()} className="text-primary underline">
            Retry
          </button>
        </div>
      ) : total === 0 ? (
        <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-primary">
            <Users className="h-6 w-6" strokeWidth={1.7} />
          </span>
          <h3 className="text-[16px] font-semibold text-ink">
            No candidates for this job yet.
          </h3>
          <p className="max-w-[340px] text-[13.5px] text-ink-muted">
            Import CVs to start pre-screening for {jobTitle}.
          </p>
          <Button size="sm" onClick={onUpload} className="mt-2">
            <Upload className="h-4 w-4" strokeWidth={1.9} />
            Upload CVs
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-14 text-center text-[13px] text-ink-muted">
          No candidates match the current search or status filter.
        </div>
      ) : (
        <div>
          {filtered.map((row) => (
            <CandidateJobRow
              key={row._id}
              row={row}
              jobTitle={jobTitle}
              resolving={resolvingCandidateId === row._id}
              onClick={() => onRowClick(row)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CandidateJobRow({
  row,
  jobTitle,
  resolving,
  onClick,
}: {
  row: CandidateListItem;
  jobTitle: string;
  resolving: boolean;
  onClick: () => void;
}) {
  const status = row.currentStatusId;
  const scoreState = aiScoreState(row.latestInterviewId);

  return (
    <div
      onClick={onClick}
      className={cn(
        "grid cursor-pointer items-center gap-3 border-b border-line px-[18px] py-3.5 text-[13.5px] transition-colors last:border-b-0 hover:bg-hover",
      )}
      style={{ gridTemplateColumns: "1.7fr 1.3fr auto 1fr 0.8fr" }}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          aria-hidden
          className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-accent text-[12px] font-bold text-primary"
        >
          {initialsOf(row.fullName || row.email || "")}
        </span>
        <span className="min-w-0">
          <span
            className="block truncate text-[13.5px] font-semibold text-ink"
            title={row.fullName}
          >
            {row.fullName || "—"}
          </span>
          <span
            className="block truncate text-[11.5px] text-ink-subtle"
            title={row.email}
          >
            {row.email}
          </span>
        </span>
      </div>

      <span
        className="min-w-0 truncate text-[13px] text-ink-2"
        title={jobTitle}
      >
        {jobTitle || "This job"}
      </span>

      <span className="justify-self-start">
        {status ? (
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-semibold"
            style={stageBadgeStyle(status.color)}
          >
            <span
              className="h-[7px] w-[7px] shrink-0 rounded-full"
              style={{ backgroundColor: status.color ?? "var(--ink-muted)" }}
            />
            {status.label}
          </span>
        ) : (
          <span className="text-ink-muted">—</span>
        )}
      </span>

      <AiScoreCell state={scoreState} />

      <span className="flex items-center gap-2 text-[12.5px] text-ink-muted">
        {formatDate(row.createdAt)}
        {resolving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
        ) : null}
      </span>
    </div>
  );
}

/**
 * AI score readout — a 54px fill bar plus the mono value, or the reason there
 * isn't one yet. Mirrors the helper on CandidatesPage; both derive every state
 * from the shared `aiScoreState`, which the drawer's score card also uses, so
 * one candidate cannot read differently in two places.
 */
function AiScoreCell({ state }: { state: AiScoreState }) {
  if (state.kind !== "scored") {
    const label =
      state.kind === "scoring"
        ? "Scoring"
        : state.kind === "failed"
          ? "Scoring failed"
          : state.kind === "awaiting"
            ? "Awaiting interview"
            : "Not scored";
    return (
      <span
        className="inline-flex items-center gap-1.5 text-[13px]"
        style={{
          color: state.kind === "failed" ? "var(--danger)" : undefined,
        }}
      >
        {state.kind === "scoring" ? (
          <Loader className="h-3.5 w-3.5 animate-spin" strokeWidth={1.7} />
        ) : state.kind === "failed" ? (
          <AlertTriangle className="h-3.5 w-3.5" strokeWidth={1.7} />
        ) : (
          <Clock className="h-3.5 w-3.5" strokeWidth={1.7} />
        )}
        <span className={state.kind === "failed" ? "" : "text-ink-subtle"}>
          {label}
        </span>
      </span>
    );
  }
  const value = state.value;
  const barColor =
    value >= 70
      ? "var(--primary)"
      : value >= 50
        ? "var(--warning)"
        : "var(--danger)";
  return (
    <span className="flex items-center gap-2.5">
      <span
        className="inline-block h-1.5 w-[54px] overflow-hidden rounded-full"
        style={{ backgroundColor: "var(--surface-3)" }}
      >
        <span
          className="block h-full rounded-full"
          style={{ width: `${value}%`, backgroundColor: barColor }}
        />
      </span>
      <span className="mono text-[13px] font-bold" style={{ color: barColor }}>
        {value}
      </span>
    </span>
  );
}

// ── building blocks ──────────────────────────────────────────────────

function SectionCard({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
      {children}
    </div>
  );
}

/**
 * Loading placeholder for the whole job detail view. Mirrors the real page —
 * breadcrumb, header (title + status pill + classification chips + actions),
 * the four-tile KPI strip, the underline tab row, and the Overview tab's
 * two-column card grid — so the page holds its shape while the job loads.
 */
function JobDetailSkeleton() {
  return (
    <div className="mx-auto max-w-[1240px] px-6 py-6 lg:px-8 lg:py-8">
      {/* Breadcrumb */}
      <div className="mb-3 flex items-center gap-2">
        <Skeleton className="h-3.5 w-10" />
        <span className="text-ink-subtle">/</span>
        <Skeleton className="h-3.5 w-32" />
      </div>

      {/* Header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <Skeleton className="h-7 w-56 max-w-full" />
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-8 w-36 rounded-lg" />
          <Skeleton className="h-8 w-20 rounded-lg" />
          <Skeleton className="h-8 w-28 rounded-lg" />
        </div>
      </div>

      {/* KPI strip */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-line bg-surface p-4 sm:p-5"
          >
            <div className="flex items-center gap-2">
              <Skeleton className="h-6 w-6 rounded" />
              <Skeleton className="h-3.5 w-20" />
            </div>
            <Skeleton className="mono mt-2 h-7 w-12" />
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="mb-5 flex gap-6 border-b border-line pb-3">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-24" />
      </div>

      {/* Overview tab — two-column card grid */}
      <div className="grid gap-4 lg:grid-cols-[1.55fr_1fr] lg:items-start">
        <div className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
          <Skeleton className="h-4 w-40" />
          <div className="mt-3 space-y-2">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-11/12" />
            <Skeleton className="h-3.5 w-4/5" />
          </div>
          <Skeleton className="mt-6 h-3 w-28" />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-16 rounded-full" />
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
          <Skeleton className="h-4 w-32" />
          <div className="mt-4 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between gap-3">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3.5 w-16" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  icon,
  tint,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  tint: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex items-center gap-2 text-ink-muted">
        <span
          className="inline-flex h-6 w-6 items-center justify-center"
          style={{ color: tint }}
        >
          {icon}
        </span>
        <span className="text-[13px] font-medium">{label}</span>
      </div>
      <div className="mono mt-2 text-[30px] font-bold leading-none tracking-tight text-ink">
        {value}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative -mb-px border-b-2 px-1 pb-3 pt-1 text-[14px] font-semibold transition-colors ${
        active
          ? "border-primary text-ink"
          : "border-transparent text-ink-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function MetaCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-subtle">
        {label}
      </span>
      <span className="text-[13.5px] text-ink">{children}</span>
    </div>
  );
}

function Dash() {
  return <span className="text-ink-subtle">—</span>;
}

// ── Share / invite ───────────────────────────────────────────────────
// No matching backend endpoint exists for candidate invites on this page,
// so that part of the UI is limited to copy-to-clipboard on the share link.

/**
 * Per-stage counts for one job, shared by the KPI tiles and the funnel card
 * so the two can never disagree. `count: null` = not loaded yet.
 */
type JobKpi = {
  total: number | null;
  shortlisted: { label: string; count: number | null };
  finalRejected: { label: string; count: number | null };
  hired: { label: string; count: number | null };
};

/** A count, or a dash while the board is still loading. Never a placeholder 0. */
function countLabel(count: number | null): string {
  return count === null ? "—" : String(count);
}

/**
 * This job's funnel: how many of its applicants reached each outcome.
 *
 * Was a stub with three hardcoded dashes and 0%-wide bars, under a comment
 * saying no endpoint existed. One does — the same board read that feeds the
 * KPI tiles above, passed in rather than fetched again so the card and the
 * tiles can never show different numbers for the same job.
 *
 * Labels come from the catalog, so a renamed column renames the row.
 */
function FunnelCard({ kpi }: { kpi: JobKpi }) {
  const rows = [
    { ...kpi.shortlisted, tint: "var(--stage-shortlisted)" },
    { ...kpi.finalRejected, tint: "var(--danger)" },
    { ...kpi.hired, tint: "var(--success)" },
  ];
  return (
    <div className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[13.5px] font-bold text-ink">
          Funnel · Applied
        </span>
        <span className="mono text-[14px] font-bold text-ink">
          {countLabel(kpi.total)}
        </span>
      </div>
      <div className="grid gap-3">
        {rows.map((r) => {
          /*
           * Share of all applicants. The 6% floor keeps a real-but-tiny bar
           * visible (1 of 900 rounds to 0%) and must NOT apply to zero — a
           * stub of colour on an empty stage reads as "a few", which is the
           * one thing a funnel must never imply. Same rule as the overview
           * funnel; they are separate components but must not disagree.
           */
          const pct =
            kpi.total && r.count
              ? Math.max(6, Math.round((r.count / kpi.total) * 100))
              : 0;
          return (
            <div key={r.label}>
              <div className="mb-1.5 flex justify-between text-[12.5px]">
                <span className="font-medium text-ink-2">{r.label}</span>
                <span className="mono font-bold text-ink-muted">
                  {countLabel(r.count)}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${pct}%`, background: r.tint }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
