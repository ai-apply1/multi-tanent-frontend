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
  ChevronLeft,
  ChevronRight,
  Loader2,
  MoreVertical,
  Plus,
  RotateCw,
  Search,
} from "lucide-react";
import toast from "react-hot-toast";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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

const statusVariant: Record<
  JobStatus,
  "outline" | "success" | "secondary" | "muted"
> = {
  draft: "outline",
  open: "success",
  closed: "secondary",
  archived: "muted",
};

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
    // The state machine is mirrored client-side, so a 409 here means our map
    // has drifted from the backend's — show what it actually said.
    onError: (err) =>
      toast.error(errorMessage(err, "Could not change the job status.")),
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
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Briefcase className="h-6 w-6 text-primary" />
            Jobs
          </h1>
          <p className="text-sm text-muted-foreground">
            Every posting in your organization, its screening questions and its
            vetting rules.
          </p>
        </div>
        <Button onClick={() => navigate(ROUTES.JOB_NEW)}>
          <Plus className="h-4 w-4" />
          Create job
        </Button>
      </div>

      <Card>
        <CardHeader className="border-b border-border">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle>Postings</CardTitle>
              <CardDescription>
                {total > 0
                  ? `Showing ${showingFrom}–${showingTo} of ${total}`
                  : "No jobs yet."}
              </CardDescription>
            </div>
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center lg:w-auto">
              <div className="relative w-full sm:w-72">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Search job titles…"
                  className="pl-9"
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
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                disabled={isFetching}
              >
                {isFetching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RotateCw className="h-4 w-4" />
                )}
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <Table containerClassName="max-h-[calc(100vh-22rem)]">
            <TableHeader className="sticky top-0 z-20 bg-card [&_th]:bg-card">
              <TableRow>
                <TableHead className="pl-6">Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Classification</TableHead>
                <TableHead>Questions</TableHead>
                <TableHead>Threshold</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="pr-6 text-center">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-16 text-center text-sm text-muted-foreground"
                  >
                    <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-primary" />
                    Loading jobs…
                  </TableCell>
                </TableRow>
              ) : isError ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-16 text-center text-sm text-destructive"
                  >
                    Could not load jobs.{" "}
                    <button onClick={() => refetch()} className="underline">
                      Retry
                    </button>
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-16 text-center text-sm text-muted-foreground"
                  >
                    No jobs yet. Click "Create job" to create one.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row._id}>
                    <TableCell className="pl-6">
                      <Link
                        to={jobDetail(row._id)}
                        className="font-medium leading-tight hover:underline"
                      >
                        {row.title}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[row.status]}>
                        {JOB_STATUS_LABELS[row.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <JobClassification job={row} />
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">
                      {row.questionCount}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">
                      {row.rejectionThreshold}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(row.createdAt)}
                    </TableCell>
                    <TableCell className="pr-6 text-center">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Actions for ${row.title}`}
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
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
                            className="text-destructive focus:bg-destructive/10"
                            onSelect={() => setDeleteTarget(row)}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>

        <div className="flex flex-col gap-3 border-t border-border px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                Rows per page
              </span>
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
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
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
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || isFetching}
            >
              {isFetching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ChevronLeft className="h-4 w-4" />
              )}
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => p + 1)}
              disabled={!data?.nextPage || isFetching}
            >
              Next
              {isFetching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </Card>

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

/** The three optional classification chips, or a single `—` when all are null. */
function JobClassification({ job }: { job: JobListItem }) {
  const chips = [
    job.employmentType ? EMPLOYMENT_TYPE_LABELS[job.employmentType] : null,
    job.workMode ? WORK_MODE_LABELS[job.workMode] : null,
    job.seniorityLevel ? SENIORITY_LABELS[job.seniorityLevel] : null,
  ].filter((c): c is string => Boolean(c));

  if (chips.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      {chips.map((chip) => (
        <Badge key={chip} variant="secondary">
          {chip}
        </Badge>
      ))}
    </div>
  );
}
