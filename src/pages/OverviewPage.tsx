import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  Filter,
  GripVertical,
  LayoutDashboard,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
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
  createManualOverviewStat,
  createOverviewStat,
  deleteOverviewStat,
  fetchOverviewFilterOptions,
  fetchOverviewStats,
  reorderOverviewStats,
  updateManualOverviewStat,
  updateOverviewStat,
} from "@/features/overview/overviewApi";
import type {
  OverviewFilterOption,
  OverviewStat,
  OverviewStatCriterion,
} from "@/features/overview/types";
import { OverviewFunnelDrawer } from "@/features/overview/OverviewFunnel";
import { JOB_OPTIONS_QUERY_KEY, listJobOptions } from "@/features/jobs/jobsApi";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

const STATS_QUERY_KEY = ["overviewStats"] as const;
const OPTIONS_QUERY_KEY = ["overviewFilterOptions"] as const;

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
    isFetching,
    refetch,
  } = useQuery({
    queryKey: statsQueryKey,
    queryFn: () =>
      fetchOverviewStats(jobFilter === "all" ? undefined : jobFilter),
    placeholderData: keepPreviousData,
  });

  // The two card kinds render as separate sections: manual cards (a title + a
  // number the admin typed) sit directly under the header, while the live
  // filter metrics keep the grid below with select-all / reorder / bulk delete.
  // Order within each section preserves the backend's position sort.
  const manualStats = useMemo(
    () => stats?.filter((s) => s.kind === "manual") ?? [],
    [stats],
  );
  const metricStats = useMemo(
    () => stats?.filter((s) => s.kind !== "manual") ?? [],
    [stats],
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [manualCreateOpen, setManualCreateOpen] = useState(false);
  // Cards being edited (null = the corresponding edit dialog is closed).
  const [editMetricTarget, setEditMetricTarget] = useState<OverviewStat | null>(
    null,
  );
  const [editManualTarget, setEditManualTarget] = useState<OverviewStat | null>(
    null,
  );
  const [funnelOpen, setFunnelOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<OverviewStat | null>(null);
  // Multi-select: ids the operator has ticked. Drives the bulk delete bar.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

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

  // Select-all and drag reorder apply only to the filter-metric grid.
  const allIds = useMemo(() => metricStats.map((s) => s.id), [metricStats]);
  const selectedCount = selectedIds.size;
  const allSelected =
    allIds.length > 0 && allIds.every((id) => selectedIds.has(id));
  const headerChecked: boolean | "indeterminate" = allSelected
    ? true
    : selectedCount > 0
      ? "indeterminate"
      : false;

  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(allIds));
  };

  // Drag-and-drop reorder. A small activation distance keeps a plain click on
  // the handle from starting a drag; the keyboard sensor makes it accessible.
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
    const oldIndex = metricStats.findIndex((s) => s.id === active.id);
    const newIndex = metricStats.findIndex((s) => s.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reorderedMetrics = arrayMove(metricStats, oldIndex, newIndex);
    // Persist the FULL id order (reordered metrics + the untouched manual cards)
    // so the optimistic cache keeps every card and manual positions stay valid.
    reorderMutation.mutate(
      [...reorderedMetrics, ...manualStats].map((s) => s.id),
    );
  };

  // Manual cards reorder within their own section; same "persist the full id
  // order" contract, with the metric cards left untouched.
  const handleManualDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = manualStats.findIndex((s) => s.id === active.id);
    const newIndex = manualStats.findIndex((s) => s.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reorderedManual = arrayMove(manualStats, oldIndex, newIndex);
    reorderMutation.mutate(
      [...metricStats, ...reorderedManual].map((s) => s.id),
    );
  };

  const manualIds = useMemo(() => manualStats.map((s) => s.id), [manualStats]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <LayoutDashboard className="h-6 w-6 text-primary" />
            Overview
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Select value={jobFilter} onValueChange={(v) => setJobFilter(v)}>
            <SelectTrigger
              className={cn(
                "h-8 w-[150px] shrink-0 text-xs",
                jobFilter !== "all" &&
                  "border-primary bg-primary/10 text-primary",
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
            variant="outline"
            size="sm"
            onClick={() => setFunnelOpen(true)}
            disabled={!stats || stats.length < 2}
          >
            <Filter className="h-4 w-4" />
            View Funnel
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw
              className={isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"}
            />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setManualCreateOpen(true)}
          >
            <SquarePlus className="h-4 w-4" />
            Add card
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            Add metric
          </Button>
        </div>
      </div>

      {/* Manual cards: a title + a number the admin typed. Shown directly under
          the header, kept separate from the live filter metrics below. Drag to
          reorder, pencil to edit. */}
      {!isLoading && !isError && manualStats.length > 0 ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleManualDragEnd}
        >
          <SortableContext items={manualIds} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
              {manualStats.map((stat) => (
                <SortableManualCard
                  key={stat.id}
                  stat={stat}
                  onEdit={() => setEditManualTarget(stat)}
                  onDelete={() => setDeleteTarget(stat)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : null}

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading metrics...
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm text-destructive">
              Could not load your metrics.
            </p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : !stats || stats.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <LayoutDashboard className="h-6 w-6" />
            </div>
            <div>
              <p className="font-medium">No metrics yet</p>
              <p className="text-sm text-muted-foreground">
                Add a live metric (for example the number of applicants at
                pre-screened), or a manual card with a title and number you type
                yourself.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setManualCreateOpen(true)}
              >
                <SquarePlus className="h-4 w-4" />
                Add card
              </Button>
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                Add metric
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : metricStats.length > 0 ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
              <Checkbox
                checked={headerChecked}
                onCheckedChange={toggleSelectAll}
                aria-label="Select all metrics"
              />
              {selectedCount > 0 ? `${selectedCount} selected` : "Select all"}
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
                  variant="destructive"
                  size="sm"
                  onClick={() => setBulkDeleteOpen(true)}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete selected
                </Button>
              </div>
            ) : null}
          </div>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={allIds} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
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
              </div>
            </SortableContext>
          </DndContext>
        </div>
      ) : null}

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

      <ManualCardDialog
        open={manualCreateOpen}
        editing={null}
        onOpenChange={setManualCreateOpen}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: STATS_QUERY_KEY });
        }}
      />

      <ManualCardDialog
        open={Boolean(editManualTarget)}
        editing={editManualTarget}
        onOpenChange={(open) => {
          if (!open) setEditManualTarget(null);
        }}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: STATS_QUERY_KEY });
          setEditManualTarget(null);
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
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.stat.id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <StatCard
      {...props}
      sortableRef={setNodeRef}
      style={style}
      isDragging={isDragging}
      dragHandleRef={setActivatorNodeRef}
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
  dragHandleRef?: (node: HTMLElement | null) => void;
  dragHandleListeners?: ReturnType<typeof useSortable>["listeners"];
  dragHandleAttributes?: ReturnType<typeof useSortable>["attributes"];
}

function StatCard({
  stat,
  selected,
  onToggleSelect,
  onEdit,
  onDelete,
  sortableRef,
  style,
  isDragging,
  dragHandleRef,
  dragHandleListeners,
  dragHandleAttributes,
}: StatCardProps) {
  return (
    <Card
      ref={sortableRef}
      style={style}
      className={cn(
        "flex flex-col overflow-hidden transition-shadow",
        selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        isDragging && "z-10 opacity-60 shadow-lg",
      )}
    >
      <CardHeader className="flex-row items-start justify-between gap-1.5 space-y-0 p-3 pb-2">
        <div className="flex min-w-0 items-start gap-2">
          <Checkbox
            checked={selected}
            onCheckedChange={() => onToggleSelect()}
            aria-label={`Select ${stat.title}`}
            className="mt-0.5 shrink-0"
          />
          <CardTitle
            className="line-clamp-2 min-w-0 wrap-break-word text-sm leading-snug"
            title={stat.title}
          >
            {stat.title}
          </CardTitle>
        </div>
        <div className="-mr-1 -mt-1 flex shrink-0 items-center">
          {dragHandleListeners ? (
            <button
              type="button"
              ref={dragHandleRef}
              {...dragHandleAttributes}
              {...dragHandleListeners}
              className="cursor-grab touch-none rounded p-1 text-muted-foreground/70 hover:text-foreground active:cursor-grabbing"
              aria-label={`Drag to reorder ${stat.title}`}
              title="Drag to reorder"
            >
              <GripVertical className="h-4 w-4" />
            </button>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            aria-label={`Edit ${stat.title}`}
            title="Edit metric"
            onClick={onEdit}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            aria-label={`Delete ${stat.title}`}
            title="Delete metric"
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3.5 p-3 pt-0">
        <p
          className="text-2xl font-semibold leading-none tabular-nums tracking-tight"
          title={stat.count.toLocaleString()}
        >
          {formatCount(stat.count)}
        </p>
        {stat.criteria.length === 0 ? (
          <Badge variant="muted" className="w-fit max-w-full font-normal">
            All applicants
          </Badge>
        ) : (
          <TooltipProvider delayDuration={300}>
            <div className="flex flex-wrap items-center gap-1.5">
              {(() => {
                // Mirror the Applicants table's chip overflow: show only the
                // latest (last-added) filter inline and tuck the rest behind a
                // "+N" badge revealed on hover, so a small square card stays a
                // single tidy row.
                const shown = stat.criteria.slice(-1);
                const hidden = stat.criteria.slice(
                  0,
                  stat.criteria.length - shown.length,
                );
                return (
                  <>
                    {shown.map((criterion) => (
                      <Badge
                        key={criterion.key}
                        variant="secondary"
                        className="min-w-0 max-w-full"
                        title={criterion.label}
                      >
                        <span className="min-w-0 truncate">
                          {criterion.label}
                        </span>
                      </Badge>
                    ))}
                    {hidden.length > 0 ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge
                            variant="muted"
                            className="shrink-0 cursor-pointer"
                          >
                            +{hidden.length}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          <p className="mb-2 font-medium">
                            {hidden.length} more{" "}
                            {hidden.length === 1 ? "filter" : "filters"}
                          </p>
                          <div className="grid grid-cols-2 gap-2">
                            {hidden.map((criterion) => (
                              <Badge
                                key={criterion.key}
                                variant="secondary"
                                className="justify-center"
                              >
                                {criterion.label}
                              </Badge>
                            ))}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    ) : null}
                  </>
                );
              })()}
            </div>
          </TooltipProvider>
        )}
      </CardContent>
    </Card>
  );
}

/** Sortable wrapper: feeds dnd-kit's refs/listeners into the visual ManualCard. */
function SortableManualCard(props: {
  stat: OverviewStat;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.stat.id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <ManualCard
      {...props}
      sortableRef={setNodeRef}
      style={style}
      isDragging={isDragging}
      dragHandleRef={setActivatorNodeRef}
      dragHandleListeners={listeners}
      dragHandleAttributes={attributes}
    />
  );
}

interface ManualCardProps {
  stat: OverviewStat;
  onEdit: () => void;
  onDelete: () => void;
  // Drag-and-drop wiring from useSortable; when omitted the card is static.
  sortableRef?: (node: HTMLElement | null) => void;
  style?: CSSProperties;
  isDragging?: boolean;
  dragHandleRef?: (node: HTMLElement | null) => void;
  dragHandleListeners?: ReturnType<typeof useSortable>["listeners"];
  dragHandleAttributes?: ReturnType<typeof useSortable>["attributes"];
}

/**
 * A manual card: just the title and the fixed number the admin typed. Rendered
 * in its own section above the filter-metric grid, so it has no kind badge and
 * no select checkbox, only drag-to-reorder, edit, and delete actions.
 */
function ManualCard({
  stat,
  onEdit,
  onDelete,
  sortableRef,
  style,
  isDragging,
  dragHandleRef,
  dragHandleListeners,
  dragHandleAttributes,
}: ManualCardProps) {
  return (
    <Card
      ref={sortableRef}
      style={style}
      className={cn(
        "flex flex-col overflow-hidden transition-shadow",
        isDragging && "z-10 opacity-60 shadow-lg",
      )}
    >
      <CardHeader className="flex-row items-start justify-between gap-1.5 space-y-0 p-3 pb-2">
        <CardTitle
          className="line-clamp-2 min-w-0 wrap-break-word text-sm leading-snug"
          title={stat.title}
        >
          {stat.title}
        </CardTitle>
        <div className="-mr-1 -mt-1 flex shrink-0 items-center">
          {dragHandleListeners ? (
            <button
              type="button"
              ref={dragHandleRef}
              {...dragHandleAttributes}
              {...dragHandleListeners}
              className="cursor-grab touch-none rounded p-1 text-muted-foreground/70 hover:text-foreground active:cursor-grabbing"
              aria-label={`Drag to reorder ${stat.title}`}
              title="Drag to reorder"
            >
              <GripVertical className="h-4 w-4" />
            </button>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            aria-label={`Edit ${stat.title}`}
            title="Edit card"
            onClick={onEdit}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            aria-label={`Delete ${stat.title}`}
            title="Delete card"
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        <p
          className="text-2xl font-semibold leading-none tabular-nums tracking-tight"
          title={stat.count.toLocaleString()}
        >
          {formatCount(stat.count)}
        </p>
      </CardContent>
    </Card>
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
              className="text-sm font-medium"
            >
              Title
            </label>
            <Input
              id="overview-stat-title"
              value={title}
              maxLength={120}
              placeholder="e.g. Applicants at pre-screened"
              onChange={(e) => setTitle(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Filters</span>
              <span className="text-xs text-muted-foreground">
                {selected.length === 0
                  ? "None selected, counts all applicants"
                  : `${selected.length} selected`}
              </span>
            </div>
            <div className="max-h-72 overflow-y-auto rounded-md border border-border">
              {optionsLoading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading filters...
                </div>
              ) : grouped.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  No filters available.
                </div>
              ) : (
                grouped.map((section) => (
                  <div
                    key={section.group}
                    className="border-b border-border last:border-b-0"
                  >
                    <p className="bg-muted/50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {section.group}
                    </p>
                    <div className="p-1">
                      {section.options.map((option) => {
                        const checked = selectedSet.has(option.key);
                        return (
                          <button
                            key={option.key}
                            type="button"
                            onClick={() => toggle(option.key)}
                            className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
                          >
                            <Checkbox checked={checked} />
                            <span>{option.label}</span>
                          </button>
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
              variant="outline"
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

interface ManualCardDialogProps {
  open: boolean;
  /** The manual card being edited, or null to create a new one. */
  editing: OverviewStat | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

/**
 * Create or edit a manual card: just a title and a fixed number the admin types.
 * Unlike a filter metric, this number is stored and shown verbatim, it never
 * recalculates from candidate data and ignores the page Job overlay.
 */
function ManualCardDialog({
  open,
  editing,
  onOpenChange,
  onSaved,
}: ManualCardDialogProps) {
  const isEditing = Boolean(editing);
  const [title, setTitle] = useState("");
  // Kept as the raw string so the field can be empty while typing; parsed and
  // validated to a non-negative integer on submit.
  const [value, setValue] = useState("");

  // Prefill from the edited card each time the dialog opens (or clear for new).
  useEffect(() => {
    if (!open) return;
    setTitle(editing?.title ?? "");
    setValue(editing ? String(editing.value) : "");
  }, [open, editing]);

  const mutation = useMutation({
    mutationFn: (payload: { title: string; value: number }) =>
      editing
        ? updateManualOverviewStat(editing.id, payload)
        : createManualOverviewStat(payload),
    onSuccess: () => {
      toast.success(isEditing ? "Card updated." : "Card created.");
      onOpenChange(false);
      onSaved();
    },
    onError: (err: unknown) => {
      toast.error(
        errorMessage(
          err,
          isEditing ? "Could not update the card." : "Could not create the card.",
        ),
      );
    },
  });

  const trimmedTitle = title.trim();
  const parsedValue = Number(value);
  const validValue =
    value.trim().length > 0 &&
    Number.isInteger(parsedValue) &&
    parsedValue >= 0;
  const canSubmit =
    trimmedTitle.length > 0 && validValue && !mutation.isPending;

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
          <DialogTitle>{isEditing ? "Edit card" : "New card"}</DialogTitle>
          <DialogDescription>
            A simple card with a title and a number you type yourself. It is
            saved for the whole team and never recalculates, it always shows the
            number you enter here.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit) return;
            mutation.mutate({ title: trimmedTitle, value: parsedValue });
          }}
        >
          <div className="space-y-1.5">
            <label
              htmlFor="overview-manual-title"
              className="text-sm font-medium"
            >
              Title
            </label>
            <Input
              id="overview-manual-title"
              value={title}
              maxLength={120}
              placeholder="e.g. Offers accepted"
              onChange={(e) => setTitle(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="overview-manual-value"
              className="text-sm font-medium"
            >
              Number
            </label>
            <Input
              id="overview-manual-value"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={value}
              placeholder="e.g. 42"
              onChange={(e) => setValue(e.target.value)}
              autoComplete="off"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
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
                "Create card"
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
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
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
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
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
