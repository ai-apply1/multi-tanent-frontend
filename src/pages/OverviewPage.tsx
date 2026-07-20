import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  ChevronRight,
  Clock,
  Filter,
  LayoutGrid,
  Loader2,
  Pencil,
  Plus,
  SquarePlus,
  Trash2,
  X,
} from "lucide-react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  bulkDeleteOverviewStats,
  createOverviewStat,
  deleteOverviewStat,
  fetchOverviewFilterOptions,
  fetchOverviewStats,
  reorderOverviewStats,
  updateOverviewStat,
} from "@/features/overview/overviewApi";
import type {
  OverviewFilterOption,
  OverviewStat,
  OverviewStatCriterion,
} from "@/features/overview/types";
import { OverviewFunnelDrawer } from "@/features/overview/OverviewFunnel";
import { JOB_OPTIONS_QUERY_KEY, listJobOptions } from "@/features/jobs/jobsApi";
import {
  getCandidate,
  listCandidates,
} from "@/features/candidates/candidatesApi";
import { InterviewDetailDrawer } from "@/components/interviews/InterviewDetailDrawer";
import { useAuth } from "@/features/auth/AuthContext";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

const STATS_QUERY_KEY = ["overviewStats"] as const;
const OPTIONS_QUERY_KEY = ["overviewFilterOptions"] as const;

/**
 * Ordered palette used to color the funnel bars. Matches the org-portal stage
 * palette so the same colors read across the app; cycles if there are more
 * cards than stages.
 */
const FUNNEL_COLORS = [
  "var(--stage-applied)",
  "var(--stage-prescreen)",
  "var(--stage-invited)",
  "var(--stage-interviewing)",
  "var(--stage-scored)",
  "var(--stage-shortlisted)",
  "var(--stage-hired)",
  "var(--stage-rejected)",
];

/**
 * A funnel-shaped icon for the "View funnel" header action. Mirrors the DevExcel
 * reference glyph so the header reads the same across the design and the app.
 */
function FunnelIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M1.5 3h13l-5 6v4l-3 1.5V9z" />
    </svg>
  );
}

/**
 * Compact count for the small metric cards: plain under 1,000, then abbreviated
 * (1.2K, 3.4M, 1.2B) so a big number never overflows a card. The exact,
 * comma-grouped value is exposed on hover via the element's `title`.
 */
function formatCount(value: number): string {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

/** Two-letter initials for the awaiting-decision avatar. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]![0] ?? "";
  const second = parts.length > 1 ? parts[parts.length - 1]![0] ?? "" : "";
  return (first + second).toUpperCase();
}

/** Preserve the catalog's order while bucketing options under their group. */
function groupOptions(
  options: OverviewFilterOption[],
): { group: string; options: OverviewFilterOption[] }[] {
  const order: string[] = [];
  const buckets = new Map<string, OverviewFilterOption[]>();
  for (const option of options) {
    const bucket = buckets.get(option.group);
    if (bucket) {
      bucket.push(option);
    } else {
      order.push(option.group);
      buckets.set(option.group, [option]);
    }
  }
  return order.map((group) => ({ group, options: buckets.get(group) ?? [] }));
}

export function OverviewPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // Page-level Job overlay. Folded into the stats query key so switching it
  // refetches every card's count scoped to that job; "all" sends no param. The
  // backend ANDs it over every card, the "All applicants" one included.
  const [jobFilter, setJobFilter] = useState<string>("all");
  const statsQueryKey = useMemo(
    () => [...STATS_QUERY_KEY, jobFilter] as const,
    [jobFilter],
  );

  // Shares the Candidates page's key + fetcher: one request, one cache entry.
  const { data: jobs } = useQuery({
    queryKey: JOB_OPTIONS_QUERY_KEY,
    queryFn: listJobOptions,
    staleTime: 5 * 60 * 1000,
  });
  const jobOptions = useMemo(
    () => [
      { value: "all", label: "All jobs" },
      ...(jobs ?? []).map((job) => ({ value: job._id, label: job.title })),
    ],
    [jobs],
  );

  const {
    data: stats,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: statsQueryKey,
    queryFn: () =>
      fetchOverviewStats(jobFilter === "all" ? undefined : jobFilter),
    placeholderData: keepPreviousData,
  });

  // The two card kinds share the KPI grid but keep their own edit dialogs.
  // Order within each section preserves the backend's position sort; the merged
  // list (metrics first, manual after) is what drag-reorder persists.
  const manualStats = useMemo(
    () => stats?.filter((s) => s.kind === "manual") ?? [],
    [stats],
  );
  const metricStats = useMemo(
    () => stats?.filter((s) => s.kind !== "manual") ?? [],
    [stats],
  );
  const combinedStats = useMemo(
    () => [...metricStats, ...manualStats],
    [metricStats, manualStats],
  );
  const combinedIds = useMemo(
    () => combinedStats.map((s) => s.id),
    [combinedStats],
  );

  const [createOpen, setCreateOpen] = useState(false);
  // Cards being edited (null = the edit dialog is closed).
  const [editMetricTarget, setEditMetricTarget] = useState<OverviewStat | null>(
    null,
  );
  const [funnelOpen, setFunnelOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<OverviewStat | null>(null);
  // Multi-select: ids the operator has ticked. Drives the bulk delete bar.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  // Awaiting your decision: reuse the shared candidates list endpoint scoped to
  // the `scored` status. Guarded on `user` so it never fires before sign-in.
  const { data: awaitingData } = useQuery({
    queryKey: ["awaiting-decision"],
    queryFn: () => listCandidates({ statusKey: "scored", limit: 5 }),
    enabled: Boolean(user),
  });
  const awaiting = useMemo(() => awaitingData?.data ?? [], [awaitingData]);

  // Interview drawer wiring. `GET /admin/candidates` returns `latestInterviewId`
  // as a raw ObjectId, but the drawer is keyed by `publicSessionId` — resolve
  // it via a detail read once the row is clicked.
  const [drawerCandidateId, setDrawerCandidateId] = useState<string | null>(
    null,
  );
  const drawerDetailQuery = useQuery({
    queryKey: ["candidate", drawerCandidateId],
    queryFn: () => getCandidate(drawerCandidateId as string),
    enabled: Boolean(drawerCandidateId),
  });
  const interviewSessionId =
    drawerDetailQuery.data?.latestInterviewId?.publicSessionId ?? null;
  useEffect(() => {
    if (!drawerDetailQuery.isError) return;
    toast.error(
      errorMessage(drawerDetailQuery.error, "Could not open the interview."),
    );
    setDrawerCandidateId(null);
  }, [drawerDetailQuery.isError, drawerDetailQuery.error]);

  // Prune the selection whenever the live cards change (a single-card delete,
  // a refetch, etc.) so an id that no longer exists can't linger in a bulk
  // action. Skips the state update when nothing actually dropped.
  useEffect(() => {
    if (!stats) return;
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const liveIds = new Set(stats.map((s) => s.id));
      const next = new Set<string>();
      prev.forEach((id) => {
        if (liveIds.has(id)) next.add(id);
      });
      return next.size === prev.size ? prev : next;
    });
  }, [stats]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Select-all applies only to the filter-metric cards (bulk delete is scoped
  // to metrics; manual cards keep their own single-item delete).
  const allMetricIds = useMemo(
    () => metricStats.map((s) => s.id),
    [metricStats],
  );
  const selectedCount = selectedIds.size;
  const allSelected =
    allMetricIds.length > 0 && allMetricIds.every((id) => selectedIds.has(id));
  const headerChecked: boolean | "indeterminate" = allSelected
    ? true
    : selectedCount > 0
      ? "indeterminate"
      : false;

  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(allMetricIds));
  };

  // Drag-and-drop reorder. A small activation distance keeps a plain click on
  // the card from starting a drag; the keyboard sensor makes it accessible.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Persist a new order. Optimistically reorder the cached list so the cards
  // stay put under the cursor, then write the full id order to the backend
  // (position = index). On error we roll the cache back. No refetch on success:
  // the cache already matches what we persisted, and a refetch would needlessly
  // recompute every card's count.
  const reorderMutation = useMutation({
    mutationFn: (orderedIds: string[]) => reorderOverviewStats(orderedIds),
    onMutate: async (orderedIds) => {
      // Operate on the currently displayed (job-scoped) list so the cards stay
      // put under the cursor. Card order/position is job-independent, so
      // persisting from the filtered view is correct.
      await queryClient.cancelQueries({ queryKey: statsQueryKey });
      const previous = queryClient.getQueryData<OverviewStat[]>(statsQueryKey);
      if (previous) {
        const byId = new Map(previous.map((s) => [s.id, s]));
        const reordered = orderedIds
          .map((id) => byId.get(id))
          .filter((s): s is OverviewStat => Boolean(s));
        queryClient.setQueryData(statsQueryKey, reordered);
      }
      return { previous };
    },
    onError: (err, _orderedIds, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(statsQueryKey, ctx.previous);
      }
      toast.error(errorMessage(err, "Could not save the new order."));
    },
  });

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = combinedIds.indexOf(String(active.id));
    const newIndex = combinedIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(combinedIds, oldIndex, newIndex);
    reorderMutation.mutate(reordered);
  };

  // Funnel rows for the left card: each metric becomes a bar, normalized to
  // the largest count so the widest bar fills the track.
  const funnelMax = useMemo(
    () => metricStats.reduce((m, s) => Math.max(m, s.count), 0),
    [metricStats],
  );

  return (
    <div className="mx-auto max-w-[1240px] px-6 py-6 lg:px-8 lg:py-8">
      {/* Page header */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="inline-flex text-primary">
              <LayoutGrid className="h-[18px] w-[18px]" strokeWidth={1.7} />
            </span>
            <h1 className="text-[23px] font-semibold tracking-tight">
              Overview
            </h1>
          </div>
          <p className="mt-1.5 max-w-[620px] text-[13.5px] text-ink-muted">
            What needs you across your pipeline today. Drag cards to reorder.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={jobFilter} onValueChange={(v) => setJobFilter(v)}>
            <SelectTrigger
              className={cn(
                "h-9 w-[170px] shrink-0 rounded-full border-[var(--field-border)] bg-surface text-[12.5px]",
                jobFilter !== "all" &&
                  "border-primary bg-[var(--accent-soft)] text-primary",
              )}
              aria-label="Job"
            >
              <SelectValue placeholder="All jobs" />
            </SelectTrigger>
            <SelectContent>
              {jobOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setFunnelOpen(true)}
            // Only filter cards become funnel stages, so counting every card
            // would enable the button on a board the drawer renders empty.
            disabled={metricStats.length < 2}
          >
            <FunnelIcon className="h-3.5 w-3.5" />
            View funnel
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            Add metric
          </Button>
        </div>
      </div>

      {/* KPI grid — filter metrics and manual cards flow together so drag
          reorder can move either kind and the layout matches the design. */}
      {isLoading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-line bg-surface py-16 text-ink-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading metrics...
        </div>
      ) : isError ? (
        <div className="rounded-2xl border border-line bg-surface">
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <p className="text-[13.5px] text-[var(--danger)]">
              Could not load your metrics.
            </p>
            <Button variant="secondary" size="sm" onClick={() => refetch()}>
              Try again
            </Button>
          </div>
        </div>
      ) : !stats || stats.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface">
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <span className="flex h-[50px] w-[50px] items-center justify-center rounded-[14px] bg-accent text-primary">
              <LayoutGrid className="h-[26px] w-[26px]" strokeWidth={1.6} />
            </span>
            <h3 className="text-[16px] font-semibold">No metrics yet</h3>
            <p className="max-w-[340px] text-[13.5px] text-ink-muted">
              Add a live metric — for example the number of applicants at
              pre-screened — to start building your pipeline funnel.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                Add metric
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Select / bulk-delete toolbar (only relevant to filter metrics). */}
          {metricStats.length > 0 ? (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-ink-muted">
                <Checkbox
                  checked={headerChecked}
                  onCheckedChange={toggleSelectAll}
                  aria-label="Select all metrics"
                />
                {selectedCount > 0
                  ? `${selectedCount} selected`
                  : "Select all metrics"}
              </label>
              {selectedCount > 0 ? (
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedIds(new Set())}
                  >
                    <X className="h-4 w-4" />
                    Clear
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => setBulkDeleteOpen(true)}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete selected
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={combinedIds} strategy={rectSortingStrategy}>
              <div className="mb-4 grid min-w-0 grid-cols-1 gap-3 overflow-hidden sm:grid-cols-2 md:[grid-template-columns:repeat(auto-fit,minmax(210px,1fr))]">
                {metricStats.map((stat) => (
                  <SortableStatCard
                    key={stat.id}
                    stat={stat}
                    selected={selectedIds.has(stat.id)}
                    onToggleSelect={() => toggleSelect(stat.id)}
                    onEdit={() => setEditMetricTarget(stat)}
                    onDelete={() => setDeleteTarget(stat)}
                  />
                ))}
                {manualStats.map((stat) => (
                  <SortableManualCard
                    key={stat.id}
                    stat={stat}
                    onDelete={() => setDeleteTarget(stat)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          {/* Two-column: pipeline funnel + awaiting-decision list. Render even
              when metricStats is empty so the shell is present; the funnel body
              shows a hint until the operator adds a filter metric. */}
          <div className="grid grid-cols-1 items-start gap-4 md:[grid-template-columns:1.15fr_1fr]">
            <div className="rounded-2xl border border-line bg-surface">
              <div className="flex items-center justify-between border-b border-line px-[18px] py-4">
                <h2 className="text-[15px] font-semibold">Pipeline funnel</h2>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setFunnelOpen(true)}
                  disabled={metricStats.length < 2}
                >
                  Expand funnel
                  <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.8} />
                </Button>
              </div>
              <div className="scroll grid max-h-[360px] gap-2.5 overflow-y-auto px-[18px] py-4">
                {metricStats.length === 0 ? (
                  <p className="py-8 text-center text-[13px] text-ink-muted">
                    Add a filter metric to build your pipeline funnel.
                  </p>
                ) : (
                  metricStats.map((stat, i) => {
                    const color = FUNNEL_COLORS[i % FUNNEL_COLORS.length];
                    const pct =
                      funnelMax > 0
                        ? Math.max(
                            6,
                            Math.round((stat.count / funnelMax) * 100),
                          )
                        : 0;
                    return (
                      <div
                        key={stat.id}
                        className="grid items-center gap-3 [grid-template-columns:110px_1fr_34px]"
                      >
                        <span
                          className="truncate text-[13px] font-medium text-ink-2"
                          title={stat.title}
                        >
                          {stat.title}
                        </span>
                        <div className="h-[26px] overflow-hidden rounded-lg bg-surface-3">
                          <div
                            className="h-full opacity-90"
                            style={{
                              width: `${pct}%`,
                              minWidth: stat.count > 0 ? 8 : 0,
                              background: color,
                            }}
                          />
                        </div>
                        <span
                          className="mono text-right text-[13px] font-semibold"
                          title={stat.count.toLocaleString()}
                        >
                          {formatCount(stat.count)}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-line bg-surface">
              <div className="flex items-center gap-2 border-b border-line px-[18px] py-4">
                <span className="inline-flex text-[var(--warning)]">
                  <Clock className="h-[18px] w-[18px]" strokeWidth={1.8} />
                </span>
                <h2 className="text-[15px] font-semibold">
                  Awaiting your decision
                </h2>
                <span className="mono ml-auto rounded-md bg-[var(--warning-soft)] px-2 py-0.5 text-[11.5px] font-semibold text-[var(--warning)]">
                  {awaiting.length} open
                </span>
              </div>
              {awaiting.length === 0 ? (
                <div className="py-8 text-center text-[13px] text-ink-muted">
                  All caught up — no interviews waiting.
                </div>
              ) : (
                <div className="scroll max-h-[360px] overflow-y-auto">
                  {awaiting.map((cand) => (
                    <button
                      key={cand._id}
                      type="button"
                      onClick={() => setDrawerCandidateId(cand._id)}
                      className="flex w-full items-center gap-3 border-b border-line px-[18px] py-3.5 text-left last:border-b-0 hover:bg-hover"
                    >
                      <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-accent text-[12px] font-bold text-primary">
                        {initials(cand.fullName)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13.5px] font-semibold text-ink">
                          {cand.fullName}
                        </div>
                        <div className="truncate text-[12px] text-ink-muted">
                          {cand.currentStatusId?.label ?? "Scored"}
                        </div>
                      </div>
                      <ChevronRight
                        className="h-4 w-4 text-ink-subtle"
                        strokeWidth={1.8}
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <OverviewFunnelDrawer
        open={funnelOpen}
        onOpenChange={setFunnelOpen}
        stats={stats ?? []}
      />

      <StatDialog
        open={createOpen}
        editing={null}
        onOpenChange={setCreateOpen}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: STATS_QUERY_KEY });
        }}
      />

      <StatDialog
        open={Boolean(editMetricTarget)}
        editing={editMetricTarget}
        onOpenChange={(open) => {
          if (!open) setEditMetricTarget(null);
        }}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: STATS_QUERY_KEY });
          setEditMetricTarget(null);
        }}
      />

      <DeleteStatDialog
        target={deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onDeleted={() => {
          queryClient.invalidateQueries({ queryKey: STATS_QUERY_KEY });
          setDeleteTarget(null);
        }}
      />

      <BulkDeleteStatsDialog
        open={bulkDeleteOpen}
        count={selectedCount}
        ids={Array.from(selectedIds)}
        onOpenChange={(open) => {
          if (!open) setBulkDeleteOpen(false);
        }}
        onDeleted={() => {
          queryClient.invalidateQueries({ queryKey: STATS_QUERY_KEY });
          setSelectedIds(new Set());
          setBulkDeleteOpen(false);
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

/** Sortable wrapper: feeds dnd-kit's refs/listeners into the visual StatCard. */
function SortableStatCard(props: {
  stat: OverviewStat;
  selected: boolean;
  onToggleSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.stat.id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    willChange: "transform",
    touchAction: "none",
  };
  return (
    <StatCard
      {...props}
      sortableRef={setNodeRef}
      style={style}
      isDragging={isDragging}
      dragHandleListeners={listeners}
      dragHandleAttributes={attributes}
    />
  );
}

interface StatCardProps {
  stat: OverviewStat;
  selected: boolean;
  onToggleSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  // Drag-and-drop wiring from useSortable; when omitted the card is static.
  sortableRef?: (node: HTMLElement | null) => void;
  style?: CSSProperties;
  isDragging?: boolean;
  dragHandleListeners?: ReturnType<typeof useSortable>["listeners"];
  dragHandleAttributes?: ReturnType<typeof useSortable>["attributes"];
}

/**
 * KPI card for a live filter metric. The whole card is the drag activator (a
 * short activation distance keeps a click on a nested button from starting a
 * drag). Header shows the drag glyph + label on the left; the right slot shows
 * a small filter icon by default and swaps to the checkbox + edit/delete row
 * on hover (or when the card is already selected).
 */
function StatCard({
  stat,
  selected,
  onToggleSelect,
  onEdit,
  onDelete,
  sortableRef,
  style,
  isDragging,
  dragHandleListeners,
  dragHandleAttributes,
}: StatCardProps) {
  const shown = stat.criteria.slice(-1);
  const hidden = stat.criteria.slice(0, stat.criteria.length - shown.length);
  return (
    <div
      ref={sortableRef}
      style={style}
      {...dragHandleAttributes}
      {...dragHandleListeners}
      className={cn(
        "group relative cursor-grab select-none rounded-2xl border border-line bg-surface p-4 transition-shadow active:cursor-grabbing",
        selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        isDragging && "z-10 opacity-70 shadow-lg",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className="select-none text-[13px] leading-none text-ink-subtle"
            aria-hidden="true"
          >
            ⠿
          </span>
          <span
            className="truncate text-[12.5px] font-medium text-ink-muted"
            title={stat.title}
          >
            {stat.title}
          </span>
        </div>
        {/* Fixed-width, stacked area — the Filter glyph and the hover
            controls occupy the SAME slot so the header layout can't shift
            when the pointer enters/leaves. Two absolute layers cross-fade
            via opacity instead of `hidden`, which was the jitter cause. */}
        <div className="relative h-5 w-[74px] shrink-0">
          {/* Default: small filter glyph. */}
          <span
            className={cn(
              "absolute inset-y-0 right-0 flex items-center text-ink-subtle transition-opacity",
              selected ? "opacity-0" : "opacity-100 group-hover:opacity-0",
            )}
            aria-hidden="true"
          >
            <Filter className="h-3.5 w-3.5" strokeWidth={1.7} />
          </span>
          {/* Hover / selected: checkbox + edit + delete. */}
          <div
            className={cn(
              "absolute inset-y-0 right-0 flex items-center gap-0.5 transition-opacity",
              selected
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
            )}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <Checkbox
              checked={selected}
              onCheckedChange={() => onToggleSelect()}
              aria-label={`Select ${stat.title}`}
              className="mr-1"
            />
            <button
              type="button"
              className="rounded-md p-1 text-ink-subtle hover:bg-hover hover:text-ink"
              aria-label={`Edit ${stat.title}`}
              title="Edit metric"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
            >
              <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
            <button
              type="button"
              className="rounded-md p-1 text-ink-subtle hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
              aria-label={`Delete ${stat.title}`}
              title="Delete metric"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
          </div>
        </div>
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <span
          className="mono text-[28px] font-semibold tracking-[-0.02em]"
          title={stat.count.toLocaleString()}
        >
          {formatCount(stat.count)}
        </span>
      </div>

      <div className="mt-0.5 min-h-[16px] text-[11.5px] text-ink-subtle">
        {stat.criteria.length === 0 ? (
          <span>All applicants</span>
        ) : (
          <TooltipProvider delayDuration={300}>
            <div className="flex flex-wrap items-center gap-1.5">
              {shown.map((criterion) => (
                <span
                  key={criterion.key}
                  className="inline-flex min-w-0 max-w-full items-center rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-ink-2"
                  title={criterion.label}
                >
                  <span className="min-w-0 truncate">{criterion.label}</span>
                </span>
              ))}
              {hidden.length > 0 ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex shrink-0 cursor-pointer items-center rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-ink-muted">
                      +{hidden.length}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p className="mb-2 font-medium">
                      {hidden.length} more{" "}
                      {hidden.length === 1 ? "filter" : "filters"}
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {hidden.map((criterion) => (
                        <span
                          key={criterion.key}
                          className="inline-flex items-center justify-center rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-ink-2"
                        >
                          {criterion.label}
                        </span>
                      ))}
                    </div>
                  </TooltipContent>
                </Tooltip>
              ) : null}
            </div>
          </TooltipProvider>
        )}
      </div>
    </div>
  );
}

/** Sortable wrapper: feeds dnd-kit's refs/listeners into the visual ManualCard. */
function SortableManualCard(props: {
  stat: OverviewStat;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.stat.id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    willChange: "transform",
    touchAction: "none",
  };
  return (
    <ManualCard
      {...props}
      sortableRef={setNodeRef}
      style={style}
      isDragging={isDragging}
      dragHandleListeners={listeners}
      dragHandleAttributes={attributes}
    />
  );
}

interface ManualCardProps {
  stat: OverviewStat;
  onDelete: () => void;
  // Drag-and-drop wiring from useSortable; when omitted the card is static.
  sortableRef?: (node: HTMLElement | null) => void;
  style?: CSSProperties;
  isDragging?: boolean;
  dragHandleListeners?: ReturnType<typeof useSortable>["listeners"];
  dragHandleAttributes?: ReturnType<typeof useSortable>["attributes"];
}

/**
 * A manual card: just the title and the fixed number the admin typed. Shares
 * the KPI grid with filter metrics; has no select checkbox (bulk delete is
 * metric-only). Editing is no longer offered — manual cards can be deleted
 * only. The header shows a SquarePlus glyph by default and swaps to a delete
 * icon on hover.
 */
function ManualCard({
  stat,
  onDelete,
  sortableRef,
  style,
  isDragging,
  dragHandleListeners,
  dragHandleAttributes,
}: ManualCardProps) {
  return (
    <div
      ref={sortableRef}
      style={style}
      {...dragHandleAttributes}
      {...dragHandleListeners}
      className={cn(
        "group relative cursor-grab select-none rounded-2xl border border-line bg-surface p-4 transition-shadow active:cursor-grabbing",
        isDragging && "z-10 opacity-70 shadow-lg",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className="select-none text-[13px] leading-none text-ink-subtle"
            aria-hidden="true"
          >
            ⠿
          </span>
          <span
            className="truncate text-[12.5px] font-medium text-ink-muted"
            title={stat.title}
          >
            {stat.title}
          </span>
        </div>
        {/* Cross-fade in a fixed slot — same fix as FilterMetricCard so the
            manual-card header can't nudge on hover either. */}
        <div className="relative h-5 w-6 shrink-0">
          <span
            className="absolute inset-y-0 right-0 flex items-center text-ink-subtle transition-opacity group-hover:opacity-0"
            aria-hidden="true"
          >
            <SquarePlus className="h-3.5 w-3.5" strokeWidth={1.7} />
          </span>
          <div
            className="absolute inset-y-0 right-0 flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="rounded-md p-1 text-ink-subtle hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
              aria-label={`Delete ${stat.title}`}
              title="Delete card"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
          </div>
        </div>
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <span
          className="mono text-[28px] font-semibold tracking-[-0.02em]"
          title={stat.count.toLocaleString()}
        >
          {formatCount(stat.count)}
        </span>
      </div>

      <div className="mt-0.5 min-h-[16px] text-[11.5px] text-ink-subtle">
        Manual entry
      </div>
    </div>
  );
}

interface StatDialogProps {
  open: boolean;
  /** The metric being edited, or null to create a new one. */
  editing: OverviewStat | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

/** Create or edit a filter metric (a title plus the filters to count by). */
function StatDialog({ open, editing, onOpenChange, onSaved }: StatDialogProps) {
  const isEditing = Boolean(editing);
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  // Prefill from the edited metric each time the dialog opens (or clear for a
  // new one). Keyed on the metric id so reopening on a different card re-syncs.
  useEffect(() => {
    if (!open) return;
    setTitle(editing?.title ?? "");
    setSelected(editing ? editing.criteria.map((c) => c.key) : []);
  }, [open, editing]);

  const { data: options, isLoading: optionsLoading } = useQuery({
    queryKey: OPTIONS_QUERY_KEY,
    queryFn: fetchOverviewFilterOptions,
    staleTime: Infinity,
    enabled: open,
  });

  const grouped = useMemo(() => groupOptions(options ?? []), [options]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  // The card stores each criterion's label/group, not just its key, so a chip
  // still reads after the job or status it points at is renamed or deleted.
  // The card's own saved criteria seed the map so a key that has since left the
  // registry keeps its snapshot instead of being dropped on the next save; a
  // live option then overwrites it, picking up any rename.
  const criterionByKey = useMemo(() => {
    const map = new Map<string, OverviewStatCriterion>();
    for (const criterion of editing?.criteria ?? []) {
      map.set(criterion.key, criterion);
    }
    for (const option of options ?? []) map.set(option.key, option);
    return map;
  }, [editing, options]);

  const mutation = useMutation({
    mutationFn: (payload: {
      title: string;
      criteria: OverviewStatCriterion[];
    }) =>
      editing
        ? updateOverviewStat(editing.id, payload)
        : createOverviewStat(payload),
    onSuccess: () => {
      toast.success(isEditing ? "Metric updated." : "Metric created.");
      onOpenChange(false);
      onSaved();
    },
    onError: (err: unknown) => {
      toast.error(
        errorMessage(
          err,
          isEditing
            ? "Could not update the metric."
            : "Could not create the metric.",
        ),
      );
    },
  });

  const toggle = (key: string) => {
    setSelected((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  const trimmedTitle = title.trim();
  // No filters is allowed: the metric then counts every applicant (total).
  const canSubmit = trimmedTitle.length > 0 && !mutation.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && mutation.isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit metric" : "New metric"}</DialogTitle>
          <DialogDescription>
            Give the metric a title and choose the filters to count by, the same
            filters as the Candidates page. Filters in the same group are
            combined with OR (an applicant in any of them is counted), while
            filters from different groups are combined with AND. Leave the
            filters empty to count all applicants.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit) return;
            const criteria = selected
              .map((key) => criterionByKey.get(key))
              .filter((c): c is OverviewStatCriterion => Boolean(c));
            mutation.mutate({ title: trimmedTitle, criteria });
          }}
        >
          <div className="space-y-1.5">
            <label
              htmlFor="overview-stat-title"
              className="mb-1.5 block text-[13px] font-semibold text-ink"
            >
              Title
            </label>
            <input
              id="overview-stat-title"
              value={title}
              maxLength={120}
              placeholder="e.g. Applicants at pre-screened"
              onChange={(e) => setTitle(e.target.value)}
              autoComplete="off"
              className="h-11 w-full rounded-lg border border-[var(--field-border)] bg-surface px-3.5 text-[14px] text-ink outline-none placeholder:text-ink-subtle focus:border-primary focus:shadow-[0_0_0_3px_var(--accent-ring)]"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold text-ink">
                Filters
              </span>
              <span className="text-[12px] text-ink-muted">
                {selected.length === 0
                  ? "None selected, counts all applicants"
                  : `${selected.length} selected`}
              </span>
            </div>
            <div className="max-h-72 overflow-y-auto rounded-lg border border-line">
              {optionsLoading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-ink-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading filters...
                </div>
              ) : grouped.length === 0 ? (
                <div className="py-10 text-center text-[13px] text-ink-muted">
                  No filters available.
                </div>
              ) : (
                grouped.map((section) => (
                  <div
                    key={section.group}
                    className="border-b border-line last:border-b-0"
                  >
                    <p className="bg-surface-3 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-muted">
                      {section.group}
                    </p>
                    <div className="p-1">
                      {section.options.map((option) => {
                        const checked = selectedSet.has(option.key);
                        return (
                          <label
                            key={option.key}
                            className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13.5px] text-ink transition-colors hover:bg-hover"
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={() => toggle(option.key)}
                            />
                            <span>{option.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {mutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {isEditing ? "Saving..." : "Creating..."}
                </>
              ) : isEditing ? (
                "Save changes"
              ) : (
                "Create metric"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface DeleteStatDialogProps {
  target: OverviewStat | null;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}

function DeleteStatDialog({
  target,
  onOpenChange,
  onDeleted,
}: DeleteStatDialogProps) {
  // A manual card and a filter metric share this dialog; word it to match.
  const noun = target?.kind === "manual" ? "card" : "metric";

  const mutation = useMutation({
    mutationFn: (id: string) => deleteOverviewStat(id),
    onSuccess: () => {
      toast.success(`${noun === "card" ? "Card" : "Metric"} deleted.`);
      onDeleted();
    },
    onError: (err: unknown) => {
      toast.error(errorMessage(err, `Could not delete the ${noun}.`));
    },
  });

  return (
    <Dialog
      open={Boolean(target)}
      onOpenChange={(next) => {
        if (!next && mutation.isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete {noun}</DialogTitle>
          <DialogDescription>
            Remove
            {target ? ` "${target.title}"` : ` this ${noun}`} from the Overview
            dashboard? This does not affect any applicants.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={!target || mutation.isPending}
            onClick={() => {
              if (target) mutation.mutate(target.id);
            }}
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Deleting...
              </>
            ) : (
              "Delete"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface BulkDeleteStatsDialogProps {
  open: boolean;
  count: number;
  ids: string[];
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}

function BulkDeleteStatsDialog({
  open,
  count,
  ids,
  onOpenChange,
  onDeleted,
}: BulkDeleteStatsDialogProps) {
  const mutation = useMutation({
    mutationFn: (statIds: string[]) => bulkDeleteOverviewStats(statIds),
    onSuccess: (res) => {
      toast.success(
        `Deleted ${res.deleted} metric${res.deleted === 1 ? "" : "s"}.`,
      );
      onDeleted();
    },
    onError: (err: unknown) => {
      toast.error(errorMessage(err, "Could not delete the metrics."));
    },
  });

  const label = `${count} metric${count === 1 ? "" : "s"}`;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && mutation.isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete {label}</DialogTitle>
          <DialogDescription>
            Remove the{" "}
            {count === 1 ? "selected metric" : `${count} selected metrics`} from
            the Overview dashboard? This does not affect any applicants.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={ids.length === 0 || mutation.isPending}
            onClick={() => mutation.mutate(ids)}
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Deleting...
              </>
            ) : (
              `Delete ${label}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
