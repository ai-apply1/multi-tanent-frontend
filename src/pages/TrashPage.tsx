import { useState } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ArchiveRestore,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RotateCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/date";
import { errorMessage as apiError } from "@/lib/errors";
import { useAuth } from "@/features/auth/AuthContext";
import { useOrgTimezone } from "@/features/organization/useOrgTimezone";
import { invalidateCandidateDataAndJobCounts } from "@/features/candidates/candidatesCache";
import {
  listTrashCandidates,
  listTrashInterviews,
  listTrashJobs,
  purgeTrashCandidate,
  purgeTrashInterview,
  purgeTrashJob,
  restoreTrashCandidate,
  restoreTrashInterview,
  restoreTrashJob,
  type TrashCandidateRow,
  type TrashInterviewRow,
  type TrashJobRow,
} from "@/features/trash/trashApi";

const PAGE_SIZE = 20;

type TrashTab = "candidates" | "interviews" | "jobs";

const TAB_LABELS: Record<TrashTab, string> = {
  candidates: "Candidates",
  interviews: "Interviews",
  jobs: "Jobs",
};

/** Whole days until the automatic purge erases the row (never negative). */
function daysUntil(purgeAt: string): number {
  const ms = new Date(purgeAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

function ErasesIn({ purgeAt }: { purgeAt: string }) {
  const days = daysUntil(purgeAt);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold",
        days <= 3
          ? "bg-[var(--danger-soft)] text-[var(--danger)]"
          : "bg-surface-3 text-ink-muted",
      )}
    >
      {days === 0 ? "erases today" : `${days} day${days === 1 ? "" : "s"} left`}
    </span>
  );
}

/**
 * "Recently deleted" — where deleted candidates, interview attempts and
 * jobs sit for the retention window before the automatic purge erases
 * them for good. Restore puts a row back exactly as it was; Delete
 * forever erases it now.
 *
 * The Interviews tab lists only attempts deleted on their own. Attempts
 * that fell together with a deleted candidate restore with that
 * candidate and are deliberately not listed as separate rows.
 */
export function TrashPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const tz = useOrgTimezone();
  const [tab, setTab] = useState<TrashTab>("candidates");
  const [page, setPage] = useState<Record<TrashTab, number>>({
    candidates: 1,
    interviews: 1,
    jobs: 1,
  });
  const [purgeTarget, setPurgeTarget] = useState<{
    tab: TrashTab;
    id: string;
    label: string;
  } | null>(null);

  // The backend 403s interviewers on every /admin/trash route; don't fire
  // requests a hand-typed URL can't use.
  const canUse = user?.role === "org_admin" || user?.role === "hr";

  const candidatesQuery = useQuery({
    queryKey: ["trash", "candidates", page.candidates],
    queryFn: () =>
      listTrashCandidates({ page: page.candidates, limit: PAGE_SIZE }),
    enabled: canUse,
    placeholderData: keepPreviousData,
  });
  const interviewsQuery = useQuery({
    queryKey: ["trash", "interviews", page.interviews],
    queryFn: () =>
      listTrashInterviews({ page: page.interviews, limit: PAGE_SIZE }),
    enabled: canUse,
    placeholderData: keepPreviousData,
  });
  const jobsQuery = useQuery({
    queryKey: ["trash", "jobs", page.jobs],
    queryFn: () => listTrashJobs({ page: page.jobs, limit: PAGE_SIZE }),
    enabled: canUse,
    placeholderData: keepPreviousData,
  });

  const queries = {
    candidates: candidatesQuery,
    interviews: interviewsQuery,
    jobs: jobsQuery,
  } as const;
  const active = queries[tab];

  const refreshEverything = (which: TrashTab) => {
    queryClient.invalidateQueries({ queryKey: ["trash"] });
    if (which === "candidates") {
      invalidateCandidateDataAndJobCounts(queryClient);
      queryClient.invalidateQueries({ queryKey: ["interviews"] });
    } else if (which === "interviews") {
      invalidateCandidateDataAndJobCounts(queryClient);
      queryClient.invalidateQueries({ queryKey: ["interviews"] });
    } else {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    }
  };

  const restoreMutation = useMutation({
    mutationFn: async ({ which, id }: { which: TrashTab; id: string }) => {
      if (which === "candidates") return restoreTrashCandidate(id);
      if (which === "interviews") return restoreTrashInterview(id);
      return restoreTrashJob(id);
    },
    onSuccess: (_data, { which }) => {
      toast.success(
        which === "candidates"
          ? "Candidate restored."
          : which === "interviews"
            ? "Interview restored."
            : "Job restored.",
      );
      refreshEverything(which);
    },
    onError: (err) => toast.error(apiError(err, "Could not restore.")),
  });

  const purgeMutation = useMutation({
    mutationFn: async ({ which, id }: { which: TrashTab; id: string }) => {
      if (which === "candidates") return purgeTrashCandidate(id);
      if (which === "interviews") return purgeTrashInterview(id);
      return purgeTrashJob(id);
    },
    onSuccess: (_data, { which }) => {
      toast.success("Deleted forever.");
      setPurgeTarget(null);
      refreshEverything(which);
    },
    onError: (err) => {
      toast.error(apiError(err, "Could not delete."));
      setPurgeTarget(null);
    },
  });

  if (!canUse) {
    return (
      <div className="mx-auto max-w-[1240px] px-6 py-6 lg:px-8 lg:py-8">
        <Header retentionDays={null} />
        <div className="rounded-2xl border border-line bg-surface">
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-primary">
              <ShieldCheck className="h-6 w-6" strokeWidth={1.7} />
            </span>
            <h3 className="text-[16px] font-semibold text-ink">
              Admins and recruiters only
            </h3>
            <p className="max-w-[340px] text-[13.5px] text-ink-muted">
              Your role can&apos;t manage deleted records. Ask an org admin if
              something needs restoring.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const retentionDays =
    candidatesQuery.data?.retentionDays ??
    interviewsQuery.data?.retentionDays ??
    jobsQuery.data?.retentionDays ??
    null;

  const total = active.data?.total ?? 0;
  const currentPage = page[tab];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Clamp during render (adjust-state-during-render, the Sidebar's
  // pattern): restoring or purging the last row of a trailing page shrinks
  // totalPages below the stored page, which would otherwise strand the tab
  // on a blank list with the pagination footer (and its Previous button)
  // unmounted. Guarded on fresh data so the placeholder page during a
  // fetch never triggers it; converges in one pass since the next render
  // sees currentPage === totalPages.
  if (active.data && !active.isFetching && currentPage > totalPages) {
    setPage((p) => ({ ...p, [tab]: totalPages }));
  }

  const restoringId = restoreMutation.isPending
    ? restoreMutation.variables?.id
    : null;

  return (
    <div className="mx-auto max-w-[1240px] px-6 py-6 lg:px-8 lg:py-8">
      <Header retentionDays={retentionDays} />

      <div className="rounded-2xl border border-line bg-surface">
        {/* Tabs + refresh */}
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
          <div className="flex rounded-lg border border-line bg-surface-3 p-0.5">
            {(Object.keys(TAB_LABELS) as TrashTab[]).map((t) => {
              const count = queries[t].data?.total;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-[13px] font-medium transition-colors",
                    tab === t
                      ? "bg-surface text-ink shadow-sm"
                      : "text-ink-muted hover:text-ink-2",
                  )}
                >
                  {TAB_LABELS[t]}
                  {typeof count === "number" && count > 0 ? (
                    <span
                      className={cn(
                        "rounded-full px-1.5 text-[11px] font-semibold",
                        tab === t
                          ? "bg-accent text-primary"
                          : "bg-surface text-ink-muted",
                      )}
                    >
                      {count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <div className="flex-1" />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => active.refetch()}
            disabled={active.isFetching}
            aria-label="Refresh"
          >
            {active.isFetching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RotateCw className="h-4 w-4" strokeWidth={1.9} />
            )}
          </Button>
        </div>

        {/* Rows */}
        {active.isLoading ? (
          <TrashSkeleton />
        ) : active.isError ? (
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <p className="text-[13.5px] text-[var(--danger)]">
              Could not load Recently deleted.
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => active.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : total === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-primary">
              <Trash2 className="h-6 w-6" strokeWidth={1.7} />
            </span>
            <h3 className="text-[16px] font-semibold text-ink">
              Nothing in the trash
            </h3>
            <p className="max-w-[380px] text-[13.5px] text-ink-muted">
              Deleted {tab} land here and can be restored
              {retentionDays
                ? ` for ${retentionDays} days before they are erased for good`
                : " until they are erased for good"}
              .
            </p>
          </div>
        ) : (
          <div>
            {tab === "candidates"
              ? (active.data?.data as TrashCandidateRow[]).map((row) => (
                  <TrashRowShell
                    key={row.id}
                    title={row.fullName || row.email}
                    subtitle={[row.email, row.jobTitle ?? undefined]
                      .filter(Boolean)
                      .join(" · ")}
                    deletedLine={deletedLine(row.deletedAt, row.deletedByName, tz)}
                    purgeAt={row.purgeAt}
                    restoring={restoringId === row.id}
                    busy={restoreMutation.isPending || purgeMutation.isPending}
                    onRestore={() =>
                      restoreMutation.mutate({ which: "candidates", id: row.id })
                    }
                    onPurge={() =>
                      setPurgeTarget({
                        tab: "candidates",
                        id: row.id,
                        label: row.fullName || row.email,
                      })
                    }
                  />
                ))
              : null}
            {tab === "interviews"
              ? (active.data?.data as TrashInterviewRow[]).map((row) => (
                  <TrashRowShell
                    key={row.sessionId}
                    title={`${row.candidateName || row.email}, attempt ${row.attemptNumber}`}
                    subtitle={[row.email, row.jobTitle ?? undefined]
                      .filter(Boolean)
                      .join(" · ")}
                    deletedLine={deletedLine(row.deletedAt, row.deletedByName, tz)}
                    purgeAt={row.purgeAt}
                    restoring={restoringId === row.sessionId}
                    busy={restoreMutation.isPending || purgeMutation.isPending}
                    onRestore={() =>
                      restoreMutation.mutate({
                        which: "interviews",
                        id: row.sessionId,
                      })
                    }
                    onPurge={() =>
                      setPurgeTarget({
                        tab: "interviews",
                        id: row.sessionId,
                        label: `${row.candidateName || row.email} (attempt ${row.attemptNumber})`,
                      })
                    }
                  />
                ))
              : null}
            {tab === "jobs"
              ? (active.data?.data as TrashJobRow[]).map((row) => (
                  <TrashRowShell
                    key={row.id}
                    title={row.title}
                    subtitle={row.status ? `was ${row.status}` : undefined}
                    deletedLine={deletedLine(row.deletedAt, row.deletedByName, tz)}
                    purgeAt={row.purgeAt}
                    restoring={restoringId === row.id}
                    busy={restoreMutation.isPending || purgeMutation.isPending}
                    onRestore={() =>
                      restoreMutation.mutate({ which: "jobs", id: row.id })
                    }
                    onPurge={() =>
                      setPurgeTarget({ tab: "jobs", id: row.id, label: row.title })
                    }
                  />
                ))
              : null}
          </div>
        )}

        {/* Pagination footer */}
        {total > PAGE_SIZE ? (
          <div className="flex items-center justify-between border-t border-line px-5 py-3">
            <span className="text-[12px] text-ink-muted">
              Page {currentPage} of {totalPages}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  setPage((p) => ({ ...p, [tab]: Math.max(1, p[tab] - 1) }))
                }
                disabled={currentPage <= 1 || active.isFetching}
              >
                <ChevronLeft className="h-4 w-4" strokeWidth={1.9} />
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPage((p) => ({ ...p, [tab]: p[tab] + 1 }))}
                disabled={currentPage >= totalPages || active.isFetching}
              >
                Next
                <ChevronRight className="h-4 w-4" strokeWidth={1.9} />
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Delete forever — the irreversible half of the two-step delete. */}
      <ConfirmDialog
        open={Boolean(purgeTarget)}
        onOpenChange={(o) => !o && setPurgeTarget(null)}
        title={`Delete ${purgeTarget?.label ?? "this"} forever?`}
        description={
          purgeTarget?.tab === "candidates"
            ? "This erases the candidate, their CV, every interview recording and every score right now, instead of waiting out the retention window. This cannot be undone."
            : purgeTarget?.tab === "interviews"
              ? "This erases the interview attempt, its recording, transcript and scores right now, instead of waiting out the retention window. This cannot be undone."
              : "This erases the job posting right now, instead of waiting out the retention window. This cannot be undone."
        }
        destructive
        confirmLabel="Delete forever"
        loadingLabel="Deleting…"
        loading={purgeMutation.isPending}
        onConfirm={() =>
          purgeTarget &&
          purgeMutation.mutate({ which: purgeTarget.tab, id: purgeTarget.id })
        }
      />
    </div>
  );
}

function Header({ retentionDays }: { retentionDays: number | null }) {
  return (
    <div className="mb-5">
      <div className="flex items-center gap-2.5">
        <span className="text-primary">
          <Trash2 className="h-[18px] w-[18px]" strokeWidth={1.7} />
        </span>
        <h1 className="text-[23px] font-semibold tracking-tight text-ink">
          Recently deleted
        </h1>
      </div>
      <p className="mt-1.5 max-w-[680px] text-[13.5px] text-ink-muted">
        Deleted candidates, interviews and jobs stay here
        {retentionDays ? ` for ${retentionDays} days` : " for a while"} and can
        be restored exactly as they were. After that they are erased for good,
        including CVs and recordings.
      </p>
    </div>
  );
}

function deletedLine(
  deletedAt: string,
  deletedByName: string | null,
  tz: string,
): string {
  const when = formatDateTime(deletedAt, tz);
  return deletedByName ? `Deleted ${when} by ${deletedByName}` : `Deleted ${when}`;
}

function TrashRowShell({
  title,
  subtitle,
  deletedLine,
  purgeAt,
  restoring,
  busy,
  onRestore,
  onPurge,
}: {
  title: string;
  subtitle?: string;
  deletedLine: string;
  purgeAt: string;
  restoring: boolean;
  busy: boolean;
  onRestore: () => void;
  onPurge: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13.5px] font-semibold text-ink">
            {title}
          </span>
          <ErasesIn purgeAt={purgeAt} />
        </div>
        {subtitle ? (
          <div className="truncate text-[12.5px] text-ink-muted">{subtitle}</div>
        ) : null}
        <div className="text-[12px] text-ink-subtle">{deletedLine}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={onRestore}
          disabled={busy}
        >
          {restoring ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArchiveRestore className="h-4 w-4" strokeWidth={1.8} />
          )}
          Restore
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={onPurge}
          disabled={busy}
          className="text-[var(--danger)] hover:bg-[var(--danger-soft)]"
        >
          <Trash2 className="h-4 w-4" strokeWidth={1.8} />
          Delete forever
        </Button>
      </div>
    </div>
  );
}

function TrashSkeleton() {
  return (
    <div>
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 border-b border-line px-5 py-3.5 last:border-b-0"
        >
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-48 max-w-full" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
          <Skeleton className="h-8 w-24 rounded-md" />
          <Skeleton className="h-8 w-32 rounded-md" />
        </div>
      ))}
    </div>
  );
}
