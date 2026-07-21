import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import axios from "axios";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Eye,
  FileText,
  Inbox,
  Loader2,
  Loader,
  MoreVertical,
  RefreshCw,
  Search,
  Send,
  Trash2,
  Users2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { InterviewDetailDrawer } from "@/components/interviews/InterviewDetailDrawer";
import {
  deleteCandidate,
  exportCandidatesCsv,
  getCandidate,
  listCandidateStatuses,
  listCandidates,
  sendCandidateInvite,
  updateCandidateStatus,
} from "@/features/candidates/candidatesApi";
import { invalidateCandidateData } from "@/features/candidates/candidatesCache";
import { aiScoreState, type AiScoreState } from "@/features/candidates/aiScore";
import {
  type CandidateListItem,
  type CandidateStatus,
} from "@/features/candidates/types";
import { JOB_OPTIONS_QUERY_KEY, listJobOptions } from "@/features/jobs/jobsApi";
import { ROUTES, jobDetail } from "@/routes";
import { formatDate } from "@/lib/date";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

/** Radix `Select` forbids an empty value — the "no filter" sentinel. */
const ALL = "all";

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 25;

/**
 * DevExcel grid columns — Candidate / Role / Status / AI score / Date / kebab.
 *
 * Every column is a fixed `fr` (or px), NEVER `auto`. The header and each data
 * row are SEPARATE grid containers, so an `auto` column sizes to whatever THAT
 * container holds — "Status" in the header, a short "Rejected" pill in one row,
 * "Applied" + a "CV couldn't be read" line in the next. Three different widths
 * means every column after it lands at a different x per row. `fr` units are a
 * fraction of the shared container width, so they line up across all rows.
 */
const ROW_GRID = "grid-cols-[1.7fr_1.3fr_1.1fr_1.1fr_0.8fr_40px]";

/**
 * Stage badge tint. The org owns the hue (custom columns included), so the
 * fill/text pair is computed from the catalog's colour rather than a theme
 * token — `color-mix` keeps the wash readable on both surface tones. Falls
 * back to a neutral muted pair when the org cleared the colour.
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

/**
 * Is the cv-parse/pre-screen pipeline still working on this row?
 *
 * `applied` alone can't answer it — the row sits at `applied` while the CV
 * is being read AND after a hard parse failure parked it there, because the
 * `applied → needs_review` transition only happens once the parse lands. So
 * the three conditions together are the honest test:
 *   - `applied`          — the worker hasn't moved it on yet,
 *   - has a `cvKey`      — there is something to parse (no CV = nothing to
 *                          wait for; the worker skips those),
 *   - no `prescreenFailedAt` — it hasn't already given up.
 *
 * Without the last one a corrupt PDF would spin "Reading CV…" forever, which
 * is exactly the lie a spinner must never tell.
 */
function isProcessing(row: CandidateListItem): boolean {
  return (
    row.currentStatusId?.key === "applied" &&
    Boolean(row.cvKey) &&
    !row.prescreenFailedAt
  );
}

/** Two initials, uppercased. Empty string collapses to a single dash. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function CandidatesPage() {
  const queryClient = useQueryClient();
  // This page serves two routes: the org-wide `/dashboard/candidates` and
  // `/dashboard/jobs/:jobId/candidates`, which Jobs links to as "View
  // candidates". On the latter the job is the whole point of the URL, so it
  // seeds the filter. Without this the job id in the URL would be ignored.
  const { jobId: routeJobId } = useParams<{ jobId: string }>();

  // ── URL-backed view state ───────────────────────────────────────────
  // Filters, pagination and the open candidate drawer all live in the query
  // string, so a refresh (or a shared link) restores the exact view instead of
  // dumping the reviewer back to an empty, unfiltered list with the drawer
  // closed. These `useState`s seed ONCE from the URL (lazy initialisers) to
  // stay snappy for typing; the effect further down mirrors them back. Purely
  // ephemeral UI (row selection, dialogs) stays in memory on purpose.
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState(() => {
    const p = Number(searchParams.get("page"));
    return Number.isInteger(p) && p > 0 ? p : 1;
  });
  const [pageSize, setPageSize] = useState(() => {
    const s = Number(searchParams.get("size"));
    return PAGE_SIZE_OPTIONS.includes(s) ? s : DEFAULT_PAGE_SIZE;
  });
  const [jobFilter, setJobFilter] = useState<string>(
    () => searchParams.get("job") ?? routeJobId ?? ALL,
  );
  const [statusFilter, setStatusFilter] = useState<string>(
    () => searchParams.get("status") ?? ALL,
  );
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<CandidateListItem | null>(
    null,
  );
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [inviteTarget, setInviteTarget] = useState<CandidateListItem | null>(
    null,
  );
  const [exporting, setExporting] = useState(false);

  // The candidate whose interview the drawer shows, read straight from the URL
  // so it survives a refresh and supports deep-links (the Command Palette
  // navigates here with `?candidate=<id>`). The drawer is keyed by
  // `publicSessionId`, which the LIST doesn't carry, so resolving it costs a
  // detail read (see `interviewSessionId` below).
  const drawerCandidateId = searchParams.get("candidate");
  const openDrawer = useCallback(
    (candidateId: string) => {
      // Push (not replace), so the browser Back button closes the drawer.
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set("candidate", candidateId);
        return next;
      });
    },
    [setSearchParams],
  );
  const closeDrawer = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("candidate");
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  // Mirror the filters + pagination into the URL. `replace` so typing in the
  // search box doesn't spawn a history entry per keystroke; the functional
  // update preserves the drawer's `candidate` param, which is managed above.
  useEffect(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        const put = (key: string, value: string, isDefault: boolean) => {
          if (isDefault || !value) next.delete(key);
          else next.set(key, value);
        };
        put("q", search.trim(), false);
        put("status", statusFilter, statusFilter === ALL);
        put("page", String(page), page === 1);
        put("size", String(pageSize), pageSize === DEFAULT_PAGE_SIZE);
        // On the job-scoped route the path owns the job; only the org-wide
        // route carries it as a query param.
        if (routeJobId) next.delete("job");
        else put("job", jobFilter, jobFilter === ALL);
        return next;
      },
      { replace: true },
    );
  }, [
    search,
    statusFilter,
    page,
    pageSize,
    jobFilter,
    routeJobId,
    setSearchParams,
  ]);

  const statusesQuery = useQuery({
    queryKey: ["candidateStatuses"],
    queryFn: listCandidateStatuses,
    staleTime: 5 * 60_000,
  });

  const jobsQuery = useQuery({
    queryKey: JOB_OPTIONS_QUERY_KEY,
    queryFn: listJobOptions,
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
  const jobsById = useMemo(
    () => new Map((jobsQuery.data ?? []).map((j) => [j._id, j])),
    [jobsQuery.data],
  );

  const selectedJob = jobFilter === ALL ? null : (jobsById.get(jobFilter) ?? null);
  // `selectedJob` is null for THREE different reasons — no job filter, a job
  // outside the options list's cap, or a list that simply hasn't arrived yet —
  // and anything that puts the selection into words has to tell them apart.
  // Without this, `/dashboard/jobs/:jobId/candidates` flashes the not-listed
  // copy on every single load, in the window before `jobsQuery` settles.
  const jobsLoading = jobsQuery.isPending;

  /**
   * The Job filter's own label. Radix renders the SELECTED ITEM's text on the
   * trigger and `placeholder` only covers an EMPTY value — so a `jobFilter`
   * with no matching `SelectItem` (the options list is capped at the API's
   * 100-per-page max) left the trigger completely blank while the board below
   * was visibly filtered to that job. Passing explicit children makes the
   * label ours in every state — which also means spelling out the two cases
   * Radix used to derive on its own.
   */
  const jobFilterLabel =
    jobFilter === ALL
      ? "All jobs"
      : selectedJob
        ? selectedJob.title
        : jobsLoading
          ? "Loading…"
          : "Job not listed";

  // Re-seed when the URL's job changes under a mounted page (job A → job B).
  // The `useState` initialisers above only cover the mount. Keyed on
  // `routeJobId` alone so it never fights the operator's own dropdown choice:
  // picking "All jobs" here leaves the param untouched and the effect idle.
  useEffect(() => {
    if (!routeJobId) return;
    setJobFilter(routeJobId);
    setPage(1);
  }, [routeJobId]);

  const listParams = {
    page,
    limit: pageSize,
    ...(jobFilter !== ALL ? { jobId: jobFilter } : {}),
    ...(statusFilter !== ALL ? { statusKey: statusFilter } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
  };

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["candidates", listParams],
    queryFn: () => listCandidates(listParams),
    placeholderData: keepPreviousData,
    // Overrides the global 30s. These rows change WITHOUT anyone touching
    // this page — the cv-parse worker moves them from `applied` to
    // invited/rejected seconds after an import. Under the global staleTime,
    // navigating away and back inside 30s replays the cache, so the operator
    // "refreshes" and sees the same stale rows, which reads as a broken
    // pipeline rather than a warm cache. (Board view was removed with the
    // design refresh — the table now owns this query unconditionally.)
    staleTime: 0,
  });

  const rows = useMemo(() => data?.data ?? [], [data]);
  /** Rows this page is knowingly showing a soon-to-be-stale status for. */
  const processingCount = useMemo(
    () => rows.filter(isProcessing).length,
    [rows],
  );
  const total = data?.count ?? 0;
  const totalPages = data?.totalPage ?? 0;
  const showingFrom = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const showingTo = Math.min(page * pageSize, total);

  // ── the drawer's session pointer ────────────────────────────────────
  // `GET /admin/candidates` returns `latestInterviewId` as a raw ObjectId,
  // but every `/admin/interviews/*` route (and the drawer) is keyed by the
  // interview's `publicSessionId` UUID. Only the DETAIL route populates the
  // pointer, so opening the drawer is a two-step: remember the candidate,
  // read the detail, hand the drawer the resolved session id.
  const detailQuery = useQuery({
    queryKey: ["candidate", drawerCandidateId],
    queryFn: () => getCandidate(drawerCandidateId as string),
    enabled: Boolean(drawerCandidateId),
  });
  const interviewSessionId =
    detailQuery.data?.latestInterviewId?.publicSessionId ?? null;

  useEffect(() => {
    if (!detailQuery.isError) return;
    toast.error(errorMessage(detailQuery.error, "Could not open the interview."));
    closeDrawer();
  }, [detailQuery.isError, detailQuery.error, closeDrawer]);

  // ── mutations ───────────────────────────────────────────────────────

  const invalidateCandidates = () => invalidateCandidateData(queryClient);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteCandidate(id),
    onSuccess: (res) => {
      toast.success("Candidate deleted.");
      invalidateCandidates();
      queryClient.removeQueries({ queryKey: ["candidate", res.candidateId] });
      if (drawerCandidateId === res.candidateId) closeDrawer();
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(res.candidateId);
        return next;
      });
      setDeleteTarget(null);
    },
    onError: (err: unknown) => {
      toast.error(errorMessage(err, "Could not delete the candidate."));
    },
  });

  /**
   * Bulk delete. There is no bulk endpoint — this fans out into N single
   * deletes and reports the real split, rather than claiming success because
   * the first one worked.
   */
  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const outcomes = await Promise.allSettled(ids.map((id) => deleteCandidate(id)));
      const deleted = outcomes.filter((o) => o.status === "fulfilled").length;
      const failed = outcomes.length - deleted;
      const firstFailure = outcomes.find((o) => o.status === "rejected");
      return {
        deleted,
        failed,
        reason:
          firstFailure && firstFailure.status === "rejected"
            ? errorMessage(firstFailure.reason, "Some candidates could not be deleted.")
            : null,
      };
    },
    onSuccess: ({ deleted, failed, reason }) => {
      if (deleted > 0) {
        toast.success(`Deleted ${deleted} candidate${deleted === 1 ? "" : "s"}.`);
      }
      if (failed > 0) {
        toast.error(
          `${failed} could not be deleted${reason ? `: ${reason}` : "."}`,
        );
      }
      invalidateCandidates();
      setSelectedIds(new Set());
      setBulkDeleteOpen(false);
    },
    onError: (err: unknown) => {
      toast.error(errorMessage(err, "Could not delete the selected candidates."));
    },
  });

  const statusMutation = useMutation({
    mutationFn: (vars: { id: string; statusKey: string }) =>
      updateCandidateStatus(vars.id, { statusKey: vars.statusKey }),
    onSuccess: (_res, vars) => {
      toast.success("Status updated.");
      invalidateCandidates();
      queryClient.invalidateQueries({ queryKey: ["candidate", vars.id] });
    },
    onError: (err: unknown) => {
      toast.error(errorMessage(err, "Could not update the status."));
    },
  });

  /**
   * The manual-invite escape hatch. Every guard is server-side and each
   * failure names the real reason — 409 INVALID_STATUS (not pre-screened
   * any more), 422 (the job closed), 409 MAX_ATTEMPTS (cap spent) — so the
   * message is surfaced verbatim instead of being flattened into one
   * generic line.
   */
  const inviteMutation = useMutation({
    mutationFn: (id: string) => sendCandidateInvite(id),
    onSuccess: (res) => {
      toast.success(
        `Invite sent — attempt ${res.attemptNumber}, link expires ${formatDate(
          res.expiresAt,
        )}.`,
      );
      invalidateCandidates();
      queryClient.invalidateQueries({ queryKey: ["candidate", res.candidateId] });
      setInviteTarget(null);
    },
    onError: (err: unknown) => {
      toast.error(errorMessage(err, "Could not send the invite."));
    },
  });

  // ── selection ───────────────────────────────────────────────────────

  const pageIds = useMemo(() => rows.map((r) => r._id), [rows]);
  const allSelected =
    pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const someSelected = pageIds.some((id) => selectedIds.has(id));
  const headerChecked: boolean | "indeterminate" = allSelected
    ? true
    : someSelected
      ? "indeterminate"
      : false;

  const toggleAll = (checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) pageIds.forEach((id) => next.add(id));
      else pageIds.forEach((id) => next.delete(id));
      return next;
    });
  };

  const toggleOne = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const selectedCount = selectedIds.size;

  /**
   * Open a candidate's CV in a new tab, at the standalone viewer route
   * (`/cv-view/<id>`). The viewer page fetches the CV and renders it from a
   * blob, so the address bar stays a clean URL and a download manager (IDM)
   * never sees a PDF download to grab (see `CvViewerPage`). A plain synchronous
   * `window.open` inside the click, so the popup blocker doesn't kill it.
   */
  const handleOpenCv = (candidateId: string) => {
    window.open(`/cv-view/${candidateId}`, "_blank", "noopener");
  };

  /**
   * CSV export. `@SkipCrypto` on the backend, so this is raw bytes rather than
   * the usual envelope. Honours only the Job filter — that is the endpoint's
   * whole filter surface, so the copy says "this job" and never implies the
   * Status/Search filters carried over.
   */
  const handleExport = async () => {
    setExporting(true);
    try {
      const { blob, count, truncated } = await exportCandidatesCsv(
        jobFilter === ALL ? undefined : jobFilter,
      );
      // Prepend a UTF-8 BOM so Excel honours the encoding for non-ASCII names.
      const withBom = new Blob([String.fromCharCode(0xfeff), blob], {
        type: "text/csv;charset=utf-8;",
      });
      const url = URL.createObjectURL(withBom);
      const a = document.createElement("a");
      a.href = url;
      a.download = `candidates-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(
        count === null
          ? "Export downloaded."
          : `Exported ${count} candidate${count === 1 ? "" : "s"}${
              truncated ? " (capped at 50k rows)" : ""
            }.`,
      );
    } catch (err) {
      // `responseType: "blob"` means a failure body arrives as opaque bytes,
      // so `errorMessage` would read `.message` off a Blob, miss, and surface
      // raw axios noise. Branch on the status instead, like the interview
      // drawer's downloads do.
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      toast.error(
        status === 400
          ? "That export request was rejected. Try clearing the job filter."
          : "Could not export the CSV.",
      );
    } finally {
      setExporting(false);
    }
  };

  const resetPage = () => setPage(1);

  const headline = selectedJob
    ? `Candidates · ${selectedJob.title}`
    : "Candidates";
  const subtitle = routeJobId
    ? "Applicants for this job — CVs, pre-screen verdicts, interview results and funnel stage."
    : "Every applicant across your jobs CVs, pre-screen verdicts, interview results, and where each one sits in the funnel.";
  const cardTitle = selectedJob ? "Applicants" : "All candidates";
  const cardSubline =
    total > 0
      ? `Showing ${showingFrom}–${showingTo} of ${total}`
      : "No candidates yet.";

  return (
    <div className="mx-auto max-w-[1240px] px-6 py-6 lg:px-8 lg:py-8">
      {routeJobId ? (
        <nav
          aria-label="Breadcrumb"
          className="mb-3.5 flex items-center gap-2 text-[13px] text-ink-muted"
        >
          <Link to={ROUTES.JOBS} className="font-medium hover:text-ink">
            Jobs
          </Link>
          <span className="text-ink-subtle">/</span>
          {selectedJob ? (
            <Link
              to={jobDetail(selectedJob._id)}
              className="font-medium hover:text-ink"
            >
              {selectedJob.title}
            </Link>
          ) : (
            <span className="font-medium">
              {jobsLoading ? "Loading…" : "Job"}
            </span>
          )}
          <span className="text-ink-subtle">/</span>
          <span className="font-semibold text-ink">Candidates</span>
        </nav>
      ) : null}

      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="text-primary">
              <Users2 className="h-[18px] w-[18px]" strokeWidth={1.7} />
            </span>
            <h1 className="text-[23px] font-semibold tracking-tight">
              {headline}
            </h1>
          </div>
          <p className="mt-1.5 max-w-[620px] text-[13.5px] text-ink-muted">
            {subtitle}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {routeJobId && selectedJob ? (
            <Button variant="secondary" size="sm" asChild>
              <Link to={jobDetail(selectedJob._id)}>
                <ArrowLeft className="h-4 w-4" strokeWidth={1.7} />
                Back to job
              </Link>
            </Button>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void refetch()}
            disabled={isFetching}
            aria-label="Refresh candidates"
          >
            <RefreshCw
              className={cn("h-4 w-4", isFetching && "animate-spin")}
              strokeWidth={1.7}
            />
            Refresh
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleExport()}
            disabled={exporting}
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" strokeWidth={1.7} />
            )}
            Export CSV
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-surface">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-ink">{cardTitle}</div>
            <div className="text-[12px] text-ink-muted">{cardSubline}</div>
          </div>
          <div className="flex-1" />
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                resetPage();
              }}
              placeholder="Search name, email, phone…"
              className="h-9 w-full rounded-full border border-[var(--field-border)] bg-surface pl-9 pr-3 text-[13px] text-ink outline-none placeholder:text-ink-subtle focus:border-primary focus:shadow-[0_0_0_3px_var(--accent-ring)] disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>
          {!routeJobId ? (
            <Select
              value={jobFilter}
              onValueChange={(v) => {
                setJobFilter(v);
                resetPage();
              }}
            >
              <SelectTrigger
                className={cn(
                  "h-9 w-full shrink-0 rounded-full sm:w-[200px]",
                  jobFilter !== ALL &&
                    "border-primary bg-[var(--accent-soft)] text-primary",
                )}
                aria-label="Job"
              >
                <SelectValue>{jobFilterLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All jobs</SelectItem>
                {(jobsQuery.data ?? []).map((job) => (
                  <SelectItem key={job._id} value={job._id}>
                    {job.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Select
            value={statusFilter}
            onValueChange={(v) => {
              setStatusFilter(v);
              resetPage();
            }}
          >
            <SelectTrigger
              className="h-9 w-full shrink-0 rounded-full sm:w-[170px]"
              style={
                statusFilter !== ALL
                  ? stageBadgeStyle(statusByKey.get(statusFilter)?.color)
                  : undefined
              }
              aria-label="Status"
            >
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {statuses.map((status) => (
                <SelectItem key={status._id} value={status.key}>
                  <span className="flex items-center gap-2">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{
                        backgroundColor:
                          status.color ?? "var(--ink-muted)",
                      }}
                    />
                    {status.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedCount > 0 ? (
              <div className="flex flex-col gap-2 border-b border-line bg-[var(--accent-softer)] px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3 text-[13px]">
                  <span className="font-semibold text-ink">
                    {selectedCount} selected
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedIds(new Set())}
                    className="inline-flex items-center gap-1 text-[12px] text-ink-muted hover:text-ink"
                  >
                    <X className="h-3.5 w-3.5" />
                    Clear
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={bulkDeleteMutation.isPending}
                    onClick={() => setBulkDeleteOpen(true)}
                  >
                    {bulkDeleteMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" strokeWidth={1.7} />
                    )}
                    Delete
                  </Button>
                </div>
              </div>
            ) : null}

            {/* Shown only while the worker is actually mid-flight. The table
                does NOT poll, so these rows will change on the server with
                nothing here to notice — say so plainly rather than let the
                operator conclude the pipeline is stuck. It disappears by
                itself once the last row lands. */}
            {processingCount > 0 ? (
              <div className="flex items-center gap-2 border-b border-line bg-[var(--warning-soft)] px-5 py-2.5">
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--warning)]" />
                <p className="text-[12.5px] text-ink-2">
                  <strong className="font-semibold text-ink">
                    {processingCount} CV{processingCount === 1 ? " is" : "s are"} still being read.
                  </strong>{" "}
                  Their status updates once the AI finishes — this table won&apos;t update on
                  its own, so hit Refresh in a moment to see the result.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="ml-auto h-7 shrink-0"
                  onClick={() => refetch()}
                  disabled={isFetching}
                >
                  <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
                  Refresh
                </Button>
              </div>
            ) : null}

            {/* Grid header */}
            <div
              className={cn(
                "grid items-center gap-3 border-b border-line bg-surface-3 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-muted",
                ROW_GRID,
              )}
            >
              <span className="flex items-center gap-2.5">
                <Checkbox
                  checked={headerChecked}
                  onCheckedChange={(c) => toggleAll(Boolean(c))}
                  aria-label="Select all on this page"
                />
                Candidate
              </span>
              <span>Role</span>
              <span>Status</span>
              <span className="text-center">AI score</span>
              <span>Date</span>
              <span />
            </div>

            {isLoading ? (
              <CandidatesTableSkeleton />
            ) : isError ? (
              <div className="flex flex-col items-center gap-2 px-6 py-16 text-center text-[13px] text-[var(--danger)]">
                Could not load candidates.
                <button
                  onClick={() => refetch()}
                  className="text-primary underline"
                >
                  Retry
                </button>
              </div>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-primary">
                  <Inbox className="h-6 w-6" strokeWidth={1.7} />
                </span>
                <h3 className="text-[16px] font-semibold text-ink">
                  {search.trim() ||
                  statusFilter !== ALL ||
                  jobFilter !== ALL
                    ? "No candidates match"
                    : "No candidates yet"}
                </h3>
                <p className="max-w-[340px] text-[13.5px] text-ink-muted">
                  {search.trim() ||
                  statusFilter !== ALL ||
                  jobFilter !== ALL
                    ? "Adjust your search or filters to see applicants."
                    : "Open a job and upload CVs from its Candidates tab to add some."}
                </p>
              </div>
            ) : (
              <div>
                {rows.map((row) => (
                  <CandidateRow
                    key={row._id}
                    row={row}
                    selected={selectedIds.has(row._id)}
                    jobTitle={jobsById.get(row.jobId)?.title ?? null}
                    statuses={statuses}
                    resolvingInterview={
                      drawerCandidateId === row._id && detailQuery.isLoading
                    }
                    statusPending={
                      statusMutation.isPending &&
                      statusMutation.variables?.id === row._id
                    }
                    onToggle={(c) => toggleOne(row._id, c)}
                    onOpenCv={() => void handleOpenCv(row._id)}
                    onOpenInterview={() => openDrawer(row._id)}
                    onInvite={() => setInviteTarget(row)}
                    onChangeStatus={(statusKey) =>
                      statusMutation.mutate({ id: row._id, statusKey })
                    }
                    onDelete={() => setDeleteTarget(row)}
                  />
                ))}
              </div>
            )}

            {/* Pagination footer */}
            <div className="flex flex-col gap-3 border-t border-line px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-ink-muted">
                    Rows per page
                  </span>
                  <Select
                    value={String(pageSize)}
                    onValueChange={(v) => {
                      setPageSize(Number(v));
                      resetPage();
                    }}
                  >
                    <SelectTrigger className="h-8 w-[72px] rounded-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAGE_SIZE_OPTIONS.map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2 text-[12px] text-ink-muted">
                  <span className="mono">
                    Page {page} of {Math.max(totalPages, 1)}
                  </span>
                  {/* Rows stay put via keepPreviousData, so without this a page
                      change would feel like nothing happened. */}
                  {isFetching ? (
                    <span className="inline-flex items-center gap-1">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Loading…
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || isFetching}
                >
                  <ChevronLeft className="h-4 w-4" strokeWidth={1.7} />
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!data?.nextPage || isFetching}
                >
                  Next
                  <ChevronRight className="h-4 w-4" strokeWidth={1.7} />
                </Button>
              </div>
            </div>
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={`Delete ${deleteTarget?.fullName || "this candidate"}?`}
        description={
          <>
            This permanently removes <strong>{deleteTarget?.fullName}</strong>, their
            CV, and their interview recordings. Any live invite link stops working
            immediately. The activity timeline is kept as an audit trail.{" "}
            <strong>This can&apos;t be undone.</strong>
          </>
        }
        confirmLabel="Delete candidate"
        loadingLabel="Deleting…"
        destructive
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget._id);
        }}
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={(open) => {
          if (!open) setBulkDeleteOpen(false);
        }}
        title={`Delete ${selectedCount} candidate${selectedCount === 1 ? "" : "s"}?`}
        description={
          <>
            This permanently removes the <strong>{selectedCount}</strong> selected
            candidate{selectedCount === 1 ? "" : "s"}, each one&apos;s CV, and their
            interview recordings. Live invite links stop working immediately.{" "}
            <strong>This can&apos;t be undone.</strong>
          </>
        }
        confirmLabel="Delete selected"
        loadingLabel="Deleting…"
        destructive
        loading={bulkDeleteMutation.isPending}
        onConfirm={() => {
          const ids = Array.from(selectedIds);
          if (ids.length > 0) bulkDeleteMutation.mutate(ids);
        }}
      />

      <ConfirmDialog
        open={Boolean(inviteTarget)}
        onOpenChange={(open) => {
          if (!open) setInviteTarget(null);
        }}
        title={`Invite ${inviteTarget?.fullName || "this candidate"} to interview?`}
        description={
          <>
            The CV vetting engine scored{" "}
            <strong>{inviteTarget?.fullName}</strong> between the auto-invite and
            auto-reject thresholds, so it parked them at{" "}
            <strong>Pre-screened</strong> for a human to decide. Inviting them now
            mints their interview link, emails it, and moves them to{" "}
            <strong>Invited</strong>.
          </>
        }
        confirmLabel="Send invite"
        loadingLabel="Sending…"
        loading={inviteMutation.isPending}
        onConfirm={() => {
          if (inviteTarget) inviteMutation.mutate(inviteTarget._id);
        }}
      />

      {/* `candidateId` is passed alongside `sessionId` so the drawer opens
          for rows without an interview yet — rejected pre-screens, invited
          but not started, etc. Otherwise those clicks silently no-op'd
          because `interviewSessionId` stays null until the detail resolves. */}
      <InterviewDetailDrawer
        sessionId={interviewSessionId}
        candidateId={drawerCandidateId}
        onOpenChange={(open) => {
          if (!open) closeDrawer();
        }}
      />
    </div>
  );
}

/**
 * AI score readout — a 54px fill bar plus the mono value, or the reason there
 * isn't one yet. The colour thresholds match the design's
 * accent/warning/danger split.
 *
 * The number and the four waiting states both come from `aiScoreState`, which
 * the drawer's score card also uses: the two views showing different numbers
 * for one candidate is the bug this replaced.
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

/**
 * Loading placeholder for the candidate table. Renders skeleton rows on the
 * SAME `ROW_GRID` as `CandidateRow` (and the live header above it), so the
 * six columns — checkbox+avatar+name, role, status pill, AI score, date,
 * kebab — stay aligned and nothing reflows when data arrives.
 */
function CandidatesTableSkeleton() {
  return (
    <div>
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "grid items-start gap-3 border-b border-line px-5 py-3.5 last:border-b-0",
            ROW_GRID,
          )}
        >
          {/* Candidate — checkbox + avatar + name/email */}
          <div className="flex min-w-0 items-center gap-2.5">
            <Skeleton className="h-4 w-4 rounded" />
            <Skeleton className="h-[34px] w-[34px] shrink-0 rounded-full" />
            <div className="flex min-w-0 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-28 max-w-full" />
              <Skeleton className="h-2.5 w-36 max-w-full" />
            </div>
          </div>
          {/* Role */}
          <Skeleton className="h-3.5 w-24 max-w-full" />
          {/* Status pill */}
          <Skeleton className="h-5 w-20 rounded-full" />
          {/* AI score — centered */}
          <Skeleton className="mx-auto h-5 w-9 rounded-full" />
          {/* Date */}
          <Skeleton className="h-3 w-16" />
          {/* Kebab */}
          <Skeleton className="h-8 w-8 justify-self-end rounded-full" />
        </div>
      ))}
    </div>
  );
}

function CandidateRow({
  row,
  selected,
  jobTitle,
  statuses,
  resolvingInterview,
  statusPending,
  onToggle,
  onOpenCv,
  onOpenInterview,
  onInvite,
  onChangeStatus,
  onDelete,
}: {
  row: CandidateListItem;
  selected: boolean;
  jobTitle: string | null;
  statuses: CandidateStatus[];
  resolvingInterview: boolean;
  statusPending: boolean;
  onToggle: (checked: boolean) => void;
  onOpenCv: () => void;
  onOpenInterview: () => void;
  onInvite: () => void;
  onChangeStatus: (statusKey: string) => void;
  onDelete: () => void;
}) {
  const status = row.currentStatusId;
  // Always offered — the invite endpoint now accepts any status (it only
  // refuses on a closed job / spent attempt cap, with a clear message).
  const canInvite = true;
  const hasInterview = Boolean(row.latestInterviewId);
  const scoreState = aiScoreState(row.latestInterviewId);

  return (
    <div
      onClick={onOpenInterview}
      className={cn(
        // `items-start`, not `items-center`: a status cell can stack a
        // "Reading CV…" / "CV couldn't be read" line under its badge, and
        // centering pushed the badge above the other columns on those rows.
        // Top-aligning keeps the badge level with the name and scores; the
        // extra line just hangs below, like the email under the name.
        "grid cursor-pointer items-start gap-3 border-b border-line px-5 py-3.5 text-[13.5px] transition-colors last:border-b-0 hover:bg-hover",
        ROW_GRID,
        selected && "bg-[var(--accent-softer)]",
      )}
    >
      {/* Candidate — checkbox + avatar + name/email */}
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          onClick={(e) => e.stopPropagation()}
          className="flex items-center"
        >
          <Checkbox
            checked={selected}
            onCheckedChange={(c) => onToggle(Boolean(c))}
            aria-label={`Select ${row.fullName || "candidate"}`}
          />
        </span>
        <span
          aria-hidden
          className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-accent text-[12px] font-bold text-primary"
        >
          {initialsOf(row.fullName || row.email || "")}
        </span>
        <span className="min-w-0">
          <span
            className="block truncate font-bold text-ink"
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

      {/* Role */}
      <span className="min-w-0 truncate text-[13px] text-ink-2">
        {jobTitle ?? (
          // The job dropdown is capped at the API's 100-per-page max, so a
          // very large org can hold a row whose job we never fetched. Say so
          // rather than rendering a bare dash that reads like "no job".
          <span className="text-ink-muted" title={row.jobId}>
            Job not listed
          </span>
        )}
      </span>

      {/* Status — stage pill with dot */}
      <span className="justify-self-start">
        {status ? (
          // Vertical stack so the "Reading CV…" spinner and any parse-error
          // indicator can live under the stage pill without changing its
          // width — the grid column stays at its intrinsic 1.1fr while the
          // row grows only for the rare rows that need it.
          <span className="flex flex-col items-start gap-1">
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-semibold"
              style={stageBadgeStyle(status.color)}
            >
              <span
                className="h-[7px] w-[7px] shrink-0 rounded-full"
                style={{
                  backgroundColor: status.color ?? "var(--ink-muted)",
                }}
              />
              {status.label}
            </span>
            {isProcessing(row) ? (
              // `applied` means two different things — "the CV is being read
              // right now" and "it was read and parked". The status alone
              // can't say which, so this pill does.
              <span className="inline-flex items-center gap-1 text-[11px] text-ink-muted">
                <Loader2 className="h-3 w-3 animate-spin" />
                Reading CV…
              </span>
            ) : null}
            {row.prescreenError ? (
              <span
                className="inline-flex items-center gap-1 text-[11px] text-[var(--danger)]"
                title={row.prescreenError}
              >
                <AlertTriangle className="h-3 w-3 shrink-0" />
                CV couldn&apos;t be read
              </span>
            ) : null}
          </span>
        ) : (
          <span className="text-ink-muted">—</span>
        )}
      </span>

      {/* AI score — centered under its header */}
      <div className="flex justify-center">
        <AiScoreCell state={scoreState} />
      </div>

      {/* Date */}
      <span className="text-[12.5px] text-ink-muted">
        {formatDate(row.createdAt)}
      </span>

      {/* Kebab */}
      <span
        onClick={(e) => e.stopPropagation()}
        className="justify-self-end"
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Row actions"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-muted hover:bg-surface-3 hover:text-ink"
            >
              {statusPending || resolvingInterview ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MoreVertical className="h-4 w-4" strokeWidth={1.7} />
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {hasInterview ? (
              <DropdownMenuItem onSelect={onOpenInterview}>
                <Eye className="h-4 w-4" />
                View interview
              </DropdownMenuItem>
            ) : null}
            {row.cvKey ? (
              <DropdownMenuItem onSelect={onOpenCv}>
                <FileText className="h-4 w-4" />
                Open CV
              </DropdownMenuItem>
            ) : null}
            {canInvite ? (
              <DropdownMenuItem onSelect={onInvite}>
                <Send className="h-4 w-4" />
                Send invite
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Change status</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-48">
                {statuses.map((option) => (
                  <DropdownMenuItem
                    key={option._id}
                    disabled={option.key === status?.key}
                    onSelect={() => onChangeStatus(option.key)}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{
                        backgroundColor:
                          option.color ?? "var(--ink-muted)",
                      }}
                    />
                    {option.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-[var(--danger)] focus:bg-[var(--danger-soft)] focus:text-[var(--danger)]"
              onSelect={onDelete}
            >
              <Trash2 className="h-4 w-4" />
              Delete candidate
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </div>
  );
}
