import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Briefcase,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MoreVertical,
  Plus,
  RotateCw,
  Search,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
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
import { deleteJob, listJobs, setJobStatus } from "@/features/jobs/jobsApi";
import {
  EMPLOYMENT_TYPE_LABELS,
  JOB_STATUS_LABELS,
  SENIORITY_LABELS,
  STATUS_TRANSITIONS,
  WORK_MODE_LABELS,
  type JobListItem,
  type JobStatus,
} from "@/features/jobs/types";
import { ROUTES, jobCandidates, jobDetail, jobEdit } from "@/routes";
import { formatDate } from "@/lib/date";
import { errorMessage } from "@/lib/errors";

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const DEFAULT_PAGE_SIZE = 20;

/** Sentinel for the "no filter" option (Radix Select forbids empty values). */
const ALL = "all";

const JOB_STATUSES: JobStatus[] = ["draft", "open", "closed", "archived"];

/** Column ratios mirror the DevExcel spec — kept in one const so header and
 * rows can never drift out of alignment. */
const COLS =
  "grid-cols-[2.2fr_0.8fr_1.2fr_0.7fr_0.7fr_0.7fr_0.9fr_40px]";

export function JobsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<JobStatus | "">("");
  const [deleteTarget, setDeleteTarget] = useState<JobListItem | null>(null);

  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: ["jobs", { page, limit: pageSize, search, status: statusFilter }],
    queryFn: () =>
      listJobs({
        page,
        limit: pageSize,
        search: search.trim() || undefined,
        status: statusFilter || undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: JobStatus }) =>
      setJobStatus(id, status),
    onSuccess: (job) => {
      toast.success(`Job ${JOB_STATUS_LABELS[job.status].toLowerCase()}.`);
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.setQueryData(["job", job._id], job);
    },
    // The state machine is mirrored client-side, so a 409 here means either our
    // map has drifted from the backend's, or (far more often) this list is
    // stale and the job already moved on elsewhere — another tab, another user,
    // a script. Show what the server actually said, then refetch so the row's
    // menu rebuilds from the real status instead of offering the same
    // impossible transition again.
    onError: (err) => {
      toast.error(errorMessage(err, "Could not change the job status."));
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteJob(id),
    onSuccess: () => {
      toast.success("Job deleted.");
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      setDeleteTarget(null);
    },
    onError: (err) => {
      // The 409 names the reason (not draft/archived, or candidates exist) —
      // that IS the guidance, so pass it through verbatim.
      toast.error(errorMessage(err, "Could not delete the job."));
      setDeleteTarget(null);
    },
  });

  const rows = data?.data ?? [];
  const total = data?.count ?? 0;
  const totalPages = data?.totalPage ?? 0;
  const showingFrom = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const showingTo = Math.min(page * pageSize, total);

  return (
    <div className="mx-auto max-w-[1240px] px-6 py-6 lg:px-8 lg:py-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="text-primary">
              <Briefcase className="h-[18px] w-[18px]" strokeWidth={1.7} />
            </span>
            <h1 className="text-[23px] font-semibold tracking-tight text-ink">
              Jobs
            </h1>
          </div>
          <p className="mt-1.5 max-w-[620px] text-[13.5px] text-ink-muted">
            Every posting in your organization, its screening questions and its
            vetting rules.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => navigate(ROUTES.JOB_NEW)}>
            <Plus className="h-4 w-4" strokeWidth={2.2} />
            Create job
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-surface">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-ink">Postings</div>
            <div className="text-[12px] text-ink-muted">
              {total > 0
                ? `Showing ${showingFrom}–${showingTo} of ${total}`
                : "No jobs yet."}
            </div>
          </div>
          <div className="flex-1" />
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search job titles…"
              className="h-9 w-full rounded-lg border border-line bg-surface-3 pl-9 pr-3 text-[13.5px] text-ink outline-none placeholder:text-ink-subtle focus:border-primary focus:shadow-[0_0_0_3px_var(--accent-ring)]"
            />
          </div>
          <Select
            value={statusFilter || ALL}
            onValueChange={(v) => {
              setStatusFilter(v === ALL ? "" : (v as JobStatus));
              setPage(1);
            }}
          >
            <SelectTrigger className="h-9 w-full sm:w-40">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {JOB_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {JOB_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            aria-label="Refresh"
          >
            {isFetching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RotateCw className="h-4 w-4" strokeWidth={1.9} />
            )}
          </Button>
        </div>

        {/* Table */}
        <div>
          {/* Header row */}
          <div
            className={`grid ${COLS} items-center gap-3 border-b border-line bg-surface-3 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-muted`}
          >
            <span>Title</span>
            <span>Status</span>
            <span>Classification</span>
            <span className="text-right">Applicants</span>
            <span className="text-right">Questions</span>
            <span className="text-right">Threshold</span>
            <span>Created</span>
            <span />
          </div>

          {isLoading ? (
            <JobsTableSkeleton />
          ) : isError ? (
            <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
              <p className="text-[13.5px] text-[var(--danger)]">
                Could not load jobs.
              </p>
              <Button variant="secondary" size="sm" onClick={() => refetch()}>
                Retry
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-primary">
                <Briefcase className="h-6 w-6" strokeWidth={1.7} />
              </span>
              <h3 className="text-[16px] font-semibold text-ink">
                {search || statusFilter
                  ? "No jobs match your search"
                  : "No jobs yet"}
              </h3>
              <p className="max-w-[340px] text-[13.5px] text-ink-muted">
                {search || statusFilter
                  ? "Try a different title or clear the status filter."
                  : "Create your first posting to start collecting applicants."}
              </p>
              <Button size="sm" onClick={() => navigate(ROUTES.JOB_NEW)}>
                <Plus className="h-4 w-4" strokeWidth={2.2} />
                Create job
              </Button>
            </div>
          ) : (
            rows.map((row) => (
              <div
                key={row._id}
                onClick={() => navigate(jobDetail(row._id))}
                className={`grid ${COLS} cursor-pointer items-center gap-3 border-b border-line px-5 py-3.5 text-[13.5px] text-ink last:border-b-0 hover:bg-hover`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-lg bg-accent text-primary">
                    <Briefcase className="h-[17px] w-[17px]" strokeWidth={1.7} />
                  </span>
                  <Link
                    to={jobDetail(row._id)}
                    onClick={(e) => e.stopPropagation()}
                    className="truncate font-semibold text-ink hover:underline"
                  >
                    {row.title}
                  </Link>
                </div>
                <div>
                  <JobStatusBadge status={row.status} />
                </div>
                <div>
                  <JobClassification job={row} />
                </div>
                <div className="mono text-right text-ink-subtle">—</div>
                <div className="mono text-right font-semibold text-ink">
                  {row.questionCount}
                </div>
                <div className="mono text-right font-semibold text-ink">
                  {row.rejectionThreshold}
                </div>
                <div className="text-[12.5px] text-ink-muted">
                  {formatDate(row.createdAt)}
                </div>
                <div className="flex justify-end">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Actions for ${row.title}`}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-hover hover:text-ink"
                      >
                        <MoreVertical className="h-4 w-4" strokeWidth={1.9} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="w-48"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <DropdownMenuItem
                        onSelect={() => navigate(jobDetail(row._id))}
                      >
                        Open
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => navigate(jobEdit(row._id))}
                      >
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => navigate(jobCandidates(row._id))}
                      >
                        View candidates
                      </DropdownMenuItem>
                      {/* Only the transitions legal from THIS status —
                          anything else is a 409. `archived` is terminal,
                          so its list is empty and the separator with it. */}
                      {STATUS_TRANSITIONS[row.status].length > 0 ? (
                        <>
                          <DropdownMenuSeparator />
                          {STATUS_TRANSITIONS[row.status].map((t) => (
                            <DropdownMenuItem
                              key={t.status}
                              disabled={statusMutation.isPending}
                              onSelect={() =>
                                statusMutation.mutate({
                                  id: row._id,
                                  status: t.status,
                                })
                              }
                            >
                              {t.label}
                            </DropdownMenuItem>
                          ))}
                        </>
                      ) : null}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-[var(--danger)] focus:bg-[var(--danger-soft)] focus:text-[var(--danger)]"
                        onSelect={() => setDeleteTarget(row)}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Pagination footer */}
        <div className="flex flex-col gap-3 border-t border-line px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-ink-muted">Rows per page</span>
              <Select
                value={String(pageSize)}
                onValueChange={(v) => {
                  setPageSize(Number(v));
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-8 w-18">
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
              <span>
                Page {page} of {Math.max(totalPages, 1)}
              </span>
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
              <ChevronLeft className="h-4 w-4" strokeWidth={1.9} />
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage((p) => p + 1)}
              disabled={!data?.nextPage || isFetching}
            >
              Next
              <ChevronRight className="h-4 w-4" strokeWidth={1.9} />
            </Button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={`Delete "${deleteTarget?.title ?? "job"}"?`}
        description="Only draft or archived jobs with no candidates can be deleted. Anything else must be archived instead, so its candidates keep a valid parent. This cannot be undone."
        confirmLabel="Delete"
        loadingLabel="Deleting…"
        destructive
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget._id)}
      />
    </div>
  );
}

/** Status pill — mirrors the DevExcel `jobStatusBadge` helper. Open gets a
 * check + success tint; closed gets an x + muted tint; the transitional
 * states (draft, archived) keep the same shape so the column doesn't jump. */
export function JobStatusBadge({ status }: { status: JobStatus }) {
  const base =
    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-semibold";
  if (status === "open") {
    return (
      <span
        className={`${base} bg-[var(--success-soft)] text-[var(--success)]`}
      >
        <Check className="h-3 w-3" strokeWidth={2.6} />
        Open
      </span>
    );
  }
  if (status === "draft") {
    return (
      <span
        className={`${base} bg-[var(--warning-soft)] text-[var(--warning)]`}
      >
        Draft
      </span>
    );
  }
  if (status === "closed") {
    return (
      <span className={`${base} bg-ink-faint text-ink-muted`}>
        <X className="h-3 w-3" strokeWidth={2.6} />
        Closed
      </span>
    );
  }
  // archived — terminal, kept visually neutral.
  return (
    <span className={`${base} bg-ink-faint text-ink-muted`}>Archived</span>
  );
}

/**
 * Loading placeholder for the table body. Renders skeleton rows on the SAME
 * `COLS` grid the real rows use, so the columns line up under the live header
 * and nothing shifts when the data arrives — a title cell (avatar + name bar),
 * a status pill, classification chips, three right-aligned numeric cells, a
 * created date and the trailing actions slot.
 */
function JobsTableSkeleton() {
  return (
    <div>
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className={`grid ${COLS} items-center gap-3 border-b border-line px-5 py-3.5 last:border-b-0`}
        >
          <div className="flex min-w-0 items-center gap-3">
            <Skeleton className="h-[34px] w-[34px] flex-none rounded-lg" />
            <Skeleton className="h-3.5 w-40 max-w-full" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
          <div className="flex gap-1.5">
            <Skeleton className="h-5 w-14 rounded-full" />
            <Skeleton className="h-5 w-12 rounded-full" />
          </div>
          <Skeleton className="ml-auto h-3.5 w-6" />
          <Skeleton className="ml-auto h-3.5 w-6" />
          <Skeleton className="ml-auto h-3.5 w-6" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="ml-auto h-8 w-8 rounded-md" />
        </div>
      ))}
    </div>
  );
}

/** The three optional classification chips, or a single `—` when all are null. */
function JobClassification({ job }: { job: JobListItem }) {
  const chips = [
    job.employmentType ? EMPLOYMENT_TYPE_LABELS[job.employmentType] : null,
    job.workMode ? WORK_MODE_LABELS[job.workMode] : null,
    job.seniorityLevel ? SENIORITY_LABELS[job.seniorityLevel] : null,
  ].filter((c): c is string => Boolean(c));

  if (chips.length === 0) {
    return <span className="text-ink-subtle">—</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <span
          key={chip}
          className="rounded-full bg-surface-3 px-2 py-0.5 text-[11.5px] font-semibold text-ink-2"
        >
          {chip}
        </span>
      ))}
    </div>
  );
}
