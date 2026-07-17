import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
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
  ChevronLeft,
  ChevronRight,
  Columns3,
  Download,
  Eye,
  FileText,
  Inbox,
  Loader2,
  MapPin,
  MoreVertical,
  RefreshCw,
  Rows3,
  Search,
  Send,
  Trash2,
  Upload,
  UserX,
  X,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { InterviewDetailDrawer } from "@/components/interviews/InterviewDetailDrawer";
import { PhoneActions } from "@/components/PhoneActions";
import { CandidateKanban } from "@/features/candidates/components/CandidateKanban";
import { UploadCvsDialog } from "@/features/candidates/components/UploadCvsDialog";
import {
  deleteCandidate,
  exportCandidatesCsv,
  getCandidate,
  getCandidateCvUrl,
  listCandidateStatuses,
  listCandidates,
  sendCandidateInvite,
  updateCandidateStatus,
} from "@/features/candidates/candidatesApi";
import {
  INVITABLE_STATUS_KEY,
  type CandidateListItem,
  type CandidateStatus,
} from "@/features/candidates/types";
import { JOB_OPTIONS_QUERY_KEY, listJobOptions } from "@/features/jobs/jobsApi";
import { formatDate } from "@/lib/date";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

/** Radix `Select` forbids an empty value — the "no filter" sentinel. */
const ALL = "all";

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 25;

/** Every column except the checkbox and Actions is content; drives the colSpan. */
const COLUMN_COUNT = 9;

/**
 * Trigger styling for the Status filter, tinted to the SELECTED status's own
 * colour so the operator sees not just that a filter is applied but what it's
 * filtering to. The hue is org data (custom columns included), so it comes
 * from the catalog row rather than a theme token; `color-mix` keeps the fill a
 * wash that works on both the light and dark surface.
 */
function statusTintStyle(color: string | null | undefined) {
  if (!color) return undefined;
  return {
    borderColor: color,
    backgroundColor: `color-mix(in oklch, ${color} 12%, transparent)`,
    color,
  };
}

/**
 * Is the cv-parse/pre-screen pipeline still working on this row?
 *
 * `applied` alone can't answer it — the row sits at `applied` while the CV
 * is being read AND after a hard parse failure parked it there, because the
 * `applied → prescreened` transition only happens once the parse lands. So
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

export function CandidatesPage() {
  const queryClient = useQueryClient();
  // This page serves two routes: the org-wide `/dashboard/candidates` and
  // `/dashboard/jobs/:jobId/candidates`, which Jobs links to as "View
  // candidates". On the latter the job is the whole point of the URL, so it
  // seeds the filter and opens on the board — the per-job view that route
  // exists for. Without this the job id in the URL would be ignored entirely.
  const { jobId: routeJobId } = useParams<{ jobId: string }>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [jobFilter, setJobFilter] = useState<string>(routeJobId ?? ALL);
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"table" | "board">(
    routeJobId ? "board" : "table",
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<CandidateListItem | null>(
    null,
  );
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [inviteTarget, setInviteTarget] = useState<CandidateListItem | null>(
    null,
  );
  const [uploadOpen, setUploadOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  // The candidate whose interview the drawer should show. The drawer is keyed
  // by `publicSessionId`, which the LIST doesn't carry — resolving it costs a
  // detail read (see `interviewSessionId` below).
  const [drawerCandidateId, setDrawerCandidateId] = useState<string | null>(
    null,
  );

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

  /** The board endpoint is per-job, so the toggle needs exactly one job. */
  const selectedJob = jobFilter === ALL ? null : (jobsById.get(jobFilter) ?? null);
  const boardAvailable = jobFilter !== ALL;
  // Uploading creates candidates on the job, which only an `open` job accepts.
  const canUpload = selectedJob?.status === "open";
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

  // Re-seed when the URL's job changes under a mounted page (job A's board →
  // job B's). The `useState` initialisers above only cover the mount. Keyed on
  // `routeJobId` alone so it never fights the operator's own dropdown choice:
  // picking "All jobs" here leaves the param untouched and the effect idle.
  useEffect(() => {
    if (!routeJobId) return;
    setJobFilter(routeJobId);
    setView("board");
    setPage(1);
  }, [routeJobId]);

  // A job filter can't be board-less: falling back to the table keeps the
  // toggle honest instead of showing an empty board for "All jobs".
  useEffect(() => {
    if (!boardAvailable && view === "board") setView("table");
  }, [boardAvailable, view]);

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
    // The board owns its own query; keep the table's off the wire while it's
    // hidden so a drag doesn't race a list refetch.
    enabled: view === "table",
    // Overrides the global 30s. These rows change WITHOUT anyone touching
    // this page — the cv-parse worker moves them from `applied` to
    // invited/rejected seconds after an import. Under the global staleTime,
    // navigating away and back inside 30s replays the cache, so the operator
    // "refreshes" and sees the same stale rows, which reads as a broken
    // pipeline rather than a warm cache.
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
    setDrawerCandidateId(null);
  }, [detailQuery.isError, detailQuery.error]);

  // ── mutations ───────────────────────────────────────────────────────

  const invalidateCandidates = () => {
    queryClient.invalidateQueries({ queryKey: ["candidates"] });
    queryClient.invalidateQueries({ queryKey: ["candidateKanban"] });
  };

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteCandidate(id),
    onSuccess: (res) => {
      toast.success("Candidate deleted.");
      invalidateCandidates();
      queryClient.removeQueries({ queryKey: ["candidate", res.candidateId] });
      if (drawerCandidateId === res.candidateId) setDrawerCandidateId(null);
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
   * Open a candidate's CV in a new tab. The bucket is private, so a fresh
   * presigned GET is minted per click. The blank tab is opened SYNCHRONOUSLY
   * inside the click — doing it after the await lands outside the user-gesture
   * window and the browser blocks it as a popup. `noopener` is deliberately
   * NOT passed (it returns a handle whose `location` setter is a no-op, so the
   * redirect silently fails); we sever `opener` ourselves once the URL is set.
   */
  const handleOpenCv = async (candidateId: string) => {
    const win = window.open("about:blank", "_blank");
    try {
      const { downloadUrl } = await getCandidateCvUrl(candidateId);
      if (win) {
        win.location.href = downloadUrl;
        try {
          win.opener = null;
        } catch {
          /* some browsers freeze it */
        }
      } else {
        window.location.assign(downloadUrl);
      }
    } catch (err) {
      if (win) win.close();
      toast.error(errorMessage(err, "Could not open the CV."));
    }
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Inbox className="h-6 w-6 text-primary" />
            Candidates
          </h1>
          <p className="text-sm text-muted-foreground">
            Every applicant across your jobs — CVs, pre-screen verdicts, interview
            results, and where each one sits in the funnel.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching || view === "board"}
          >
            {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleExport()}
            disabled={exporting}
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Export CSV
          </Button>
          <ViewToggle
            view={view}
            onChange={setView}
            boardAvailable={boardAvailable}
          />
          <UploadCta
            canUpload={canUpload}
            jobSelected={jobFilter !== ALL}
            jobStatus={selectedJob?.status ?? null}
            jobsLoading={jobsLoading}
            onClick={() => setUploadOpen(true)}
          />
        </div>
      </div>

      <Card>
        <CardHeader className="border-b border-border">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>{view === "board" ? "Board" : "All candidates"}</CardTitle>
              <CardDescription>
                {view === "board"
                  ? `${selectedJob?.title ?? "This job"} — drag a card to move a candidate.`
                  : total > 0
                    ? `Showing ${showingFrom}–${showingTo} of ${total}`
                    : "No candidates yet."}
              </CardDescription>
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
              <div className="relative w-full sm:w-72">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    resetPage();
                  }}
                  placeholder="Search name, email, phone…"
                  className="pl-9"
                  // The board has no search — it's the whole job, always.
                  disabled={view === "board"}
                />
              </div>
              <Select
                value={jobFilter}
                onValueChange={(v) => {
                  setJobFilter(v);
                  resetPage();
                }}
              >
                <SelectTrigger
                  className={cn(
                    "w-full shrink-0 sm:w-[200px]",
                    jobFilter !== ALL && "border-primary bg-primary/10 text-primary",
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
              <Select
                value={statusFilter}
                onValueChange={(v) => {
                  setStatusFilter(v);
                  resetPage();
                }}
                disabled={view === "board"}
              >
                <SelectTrigger
                  className="w-full shrink-0 sm:w-[170px]"
                  style={statusTintStyle(statusByKey.get(statusFilter)?.color)}
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
                            backgroundColor: status.color ?? "var(--muted-foreground)",
                          }}
                        />
                        {status.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>

        {view === "board" && jobFilter !== ALL ? (
          <CardContent className="p-0">
            <CandidateKanban jobId={jobFilter} onOpenCandidate={setDrawerCandidateId} />
          </CardContent>
        ) : (
          <>
            {selectedCount > 0 ? (
              <div className="flex flex-col gap-2 border-b border-border bg-muted/40 px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">{selectedCount} selected</span>
                  <button
                    type="button"
                    onClick={() => setSelectedIds(new Set())}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                    Clear
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={bulkDeleteMutation.isPending}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setBulkDeleteOpen(true)}
                  >
                    {bulkDeleteMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
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
              <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-6 py-2.5">
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                <p className="text-xs text-muted-foreground">
                  <strong className="font-medium text-foreground">
                    {processingCount} CV{processingCount === 1 ? " is" : "s are"} still
                    being read.
                  </strong>{" "}
                  Their status updates once the AI finishes — this table won't update on
                  its own, so hit Refresh in a moment to see the result.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto h-7 shrink-0 text-xs"
                  onClick={() => refetch()}
                  disabled={isFetching}
                >
                  <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
                  Refresh
                </Button>
              </div>
            ) : null}

            <CardContent className="p-0">
              <Table className="min-w-[1000px]" containerClassName="max-h-[70vh]">
                {/* Sticky header: the `max-h` lives on the Table's scroll
                    wrapper (containerClassName), which is what a sticky
                    thead actually sticks to. */}
                <TableHeader className="sticky top-0 z-20 bg-card [&_th]:bg-card">
                  <TableRow>
                    <TableHead className="w-10 pl-6">
                      <Checkbox
                        checked={headerChecked}
                        onCheckedChange={toggleAll}
                        aria-label="Select all on this page"
                      />
                    </TableHead>
                    <TableHead>Candidate</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Job</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Experience</TableHead>
                    <TableHead>Interview</TableHead>
                    <TableHead>Applied</TableHead>
                    <TableHead className="pr-6 text-center">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell
                        colSpan={COLUMN_COUNT}
                        className="py-16 text-center text-sm text-muted-foreground"
                      >
                        <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-primary" />
                        Loading candidates…
                      </TableCell>
                    </TableRow>
                  ) : isError ? (
                    <TableRow>
                      <TableCell
                        colSpan={COLUMN_COUNT}
                        className="py-16 text-center text-sm text-destructive"
                      >
                        Could not load candidates.{" "}
                        <button onClick={() => refetch()} className="underline">
                          Retry
                        </button>
                      </TableCell>
                    </TableRow>
                  ) : rows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={COLUMN_COUNT}
                        className="py-16 text-center text-sm text-muted-foreground"
                      >
                        <Inbox className="mx-auto mb-2 h-6 w-6" />
                        {search.trim() || statusFilter !== ALL || jobFilter !== ALL
                          ? "No candidates match these filters."
                          : "No candidates yet. Pick an open job, then click Upload CVs to add some."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((row) => (
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
                        onOpenInterview={() => setDrawerCandidateId(row._id)}
                        onInvite={() => setInviteTarget(row)}
                        onChangeStatus={(statusKey) =>
                          statusMutation.mutate({ id: row._id, statusKey })
                        }
                        onDelete={() => setDeleteTarget(row)}
                      />
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>

            <div className="flex flex-col gap-3 border-t border-border px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Rows per page</span>
                  <Select
                    value={String(pageSize)}
                    onValueChange={(v) => {
                      setPageSize(Number(v));
                      resetPage();
                    }}
                  >
                    <SelectTrigger className="h-8 w-[72px]">
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
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>
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
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || isFetching}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!data?.nextPage || isFetching}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>

      {selectedJob ? (
        <UploadCvsDialog
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          jobId={selectedJob._id}
          jobTitle={selectedJob.title}
          onImported={invalidateCandidates}
        />
      ) : null}

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

      <InterviewDetailDrawer
        sessionId={interviewSessionId}
        onOpenChange={(open) => {
          if (!open) setDrawerCandidateId(null);
        }}
      />
    </div>
  );
}

/**
 * Table ⇄ board switch. The board endpoint is per-job, so it can only render
 * once a single job is picked — disabled (with the reason) rather than hidden,
 * so the capability is discoverable.
 */
function ViewToggle({
  view,
  onChange,
  boardAvailable,
}: {
  view: "table" | "board";
  onChange: (view: "table" | "board") => void;
  boardAvailable: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center rounded-md border border-border p-0.5">
      <Button
        variant={view === "table" ? "secondary" : "ghost"}
        size="sm"
        className="h-7"
        onClick={() => onChange("table")}
      >
        <Rows3 className="h-4 w-4" />
        Table
      </Button>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            {/* A disabled button emits no pointer events, so the tooltip needs
                a wrapper to hang the hover on. */}
            <span>
              <Button
                variant={view === "board" ? "secondary" : "ghost"}
                size="sm"
                className="h-7"
                disabled={!boardAvailable}
                onClick={() => onChange("board")}
              >
                <Columns3 className="h-4 w-4" />
                Board
              </Button>
            </span>
          </TooltipTrigger>
          {!boardAvailable ? (
            <TooltipContent>Pick a job to see the board</TooltipContent>
          ) : null}
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

/**
 * The page's one primary CTA. Uploading creates candidates on a job, and only
 * an `open` job accepts them (422 otherwise) — so the button explains which
 * precondition is missing instead of failing at submit.
 */
function UploadCta({
  canUpload,
  jobSelected,
  jobStatus,
  jobsLoading,
  onClick,
}: {
  canUpload: boolean;
  jobSelected: boolean;
  /** Null while the options list is loading AND for a job outside its cap. */
  jobStatus: string | null;
  jobsLoading: boolean;
  onClick: () => void;
}) {
  // `jobStatus` is null in three situations and only one of them is a status,
  // so it can only be interpolated once it's known to be one — reading it
  // blind is what rendered "This job is null" to operators. The branches
  // mirror `jobFilterLabel`'s, so the tooltip and the filter can't disagree.
  const reason = !jobSelected
    ? "Pick a job to upload CVs into"
    : jobStatus
      ? `This job is ${jobStatus} — only open jobs accept new candidates`
      : jobsLoading
        ? "Checking this job…"
        : "Can't confirm this job is open — it isn't in the jobs list";

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button size="sm" disabled={!canUpload} onClick={onClick}>
              <Upload className="h-4 w-4" />
              Upload CVs
            </Button>
          </span>
        </TooltipTrigger>
        {!canUpload ? <TooltipContent>{reason}</TooltipContent> : null}
      </Tooltip>
    </TooltipProvider>
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
  // The §3.2 endpoint accepts ONLY `prescreened` — anything else 409s with
  // INVALID_STATUS, so the action is gated rather than offered-then-refused.
  const canInvite = status?.key === INVITABLE_STATUS_KEY;
  const hasInterview = Boolean(row.latestInterviewId);

  return (
    <TableRow className={selected ? "bg-primary/5" : undefined}>
      <TableCell className="w-10 pl-6">
        <Checkbox
          checked={selected}
          onCheckedChange={onToggle}
          aria-label={`Select ${row.fullName || "candidate"}`}
        />
      </TableCell>
      <TableCell>
        <div className="font-medium leading-tight">{row.fullName || "—"}</div>
        <div className="truncate text-xs text-muted-foreground" title={row.email}>
          {row.email}
        </div>
      </TableCell>
      <TableCell>
        {row.phone ? (
          <PhoneActions phoneNumber={row.phone} />
        ) : (
          <span className="text-xs text-muted-foreground">No phone</span>
        )}
        <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <MapPin className="h-3 w-3 shrink-0" />
          {row.city || "—"}
        </div>
      </TableCell>
      <TableCell className="text-sm">
        {jobTitle ?? (
          // The job dropdown is capped at the API's 100-per-page max, so a
          // very large org can hold a row whose job we never fetched. Say so
          // rather than rendering a bare dash that reads like "no job".
          <span className="text-muted-foreground" title={row.jobId}>
            Job not listed
          </span>
        )}
      </TableCell>
      <TableCell>
        {status ? (
          <div className="flex flex-col items-start gap-1">
            <Badge variant="outline" style={statusTintStyle(status.color)}>
              {status.label}
            </Badge>
            {isProcessing(row) ? (
              // `applied` means two different things — "the CV is being read
              // right now" and "it was read and parked". The status alone
              // can't say which, so this pill does.
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Reading CV…
              </span>
            ) : null}
            {row.prescreenError ? (
              <span
                className="inline-flex items-center gap-1 text-[11px] text-destructive"
                title={row.prescreenError}
              >
                <AlertTriangle className="h-3 w-3 shrink-0" />
                CV couldn't be read
              </span>
            ) : null}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-sm">
        {row.yearsOfExperience === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          `${row.yearsOfExperience}y`
        )}
      </TableCell>
      <TableCell>
        {hasInterview ? (
          <Button
            variant="default"
            size="sm"
            onClick={onOpenInterview}
            disabled={resolvingInterview}
          >
            {resolvingInterview ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
            View result
          </Button>
        ) : (
          <Badge variant="muted" className="gap-1">
            <UserX className="h-3 w-3" />
            Not started
          </Badge>
        )}
        {row.attemptCount > 0 ? (
          <div className="mt-1 text-[11px] text-muted-foreground">
            {row.attemptCount} attempt{row.attemptCount === 1 ? "" : "s"}
          </div>
        ) : null}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {formatDate(row.createdAt)}
      </TableCell>
      <TableCell className="pr-6 text-center">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Row actions">
              {statusPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MoreVertical className="h-4 w-4" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
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
                        backgroundColor: option.color ?? "var(--muted-foreground)",
                      }}
                    />
                    {option.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {hasInterview ? (
              <DropdownMenuItem onSelect={onOpenInterview}>
                <Eye className="h-4 w-4" />
                View interview
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:bg-destructive/10 focus:text-destructive"
              onSelect={onDelete}
            >
              <Trash2 className="h-4 w-4" />
              Delete candidate
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}
