import { useEffect, useState } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Library,
  Loader2,
  MessageCircleQuestion,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { QuestionFormDialog } from "@/features/screening-questions/components/QuestionFormDialog";
import { QuestionPreviewDialog } from "@/features/screening-questions/components/QuestionPreviewDialog";
import { TagsInput } from "@/features/screening-questions/components/TagsInput";
import {
  listQuestionCategories,
  QUESTION_CATEGORIES_QUERY_KEY,
} from "@/features/question-categories/questionCategoriesApi";
import {
  deleteScreeningQuestion,
  listScreeningQuestions,
} from "@/features/screening-questions/screeningQuestionsApi";
import {
  askableCount,
  DIFFICULTY_LABELS,
  DIFFICULTY_LEVELS,
  questionLabel,
  type DifficultyLevel,
  type ScreeningQuestion,
} from "@/features/screening-questions/types";
import { errorMessage as apiError } from "@/lib/errors";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const DEFAULT_PAGE_SIZE = 20;

/** Sentinel for the "no filter" option (Radix Select forbids empty values). */
const ALL = "all";

/** Design-token classes for the difficulty pill. */
const DIFFICULTY_PILL: Record<DifficultyLevel, string> = {
  easy: "bg-[var(--success-soft)] text-[var(--success)]",
  medium: "bg-[var(--warning-soft)] text-[var(--warning)]",
  hard: "bg-[var(--danger-soft)] text-[var(--danger)]",
};


export function QuestionBankPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [search, setSearch] = useState("");
  const [difficultyFilter, setDifficultyFilter] = useState<DifficultyLevel | "">(
    "",
  );
  const [categoryFilter, setCategoryFilter] = useState("");
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ScreeningQuestion | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ScreeningQuestion | null>(
    null,
  );
  // Row clicks open the read-only preview; the edit dialog is reserved for
  // the row's edit icon and the kebab's "Edit" action.
  const [previewQuestion, setPreviewQuestion] =
    useState<ScreeningQuestion | null>(null);
  // The delete-guard's 409 message names the jobs holding the question, so it
  // lives in the dialog until dismissed rather than in a toast that vanishes.
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search);

  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: [
      "screeningQuestions",
      {
        page,
        limit: pageSize,
        search: debouncedSearch,
        difficultyLevel: difficultyFilter,
        categoryId: categoryFilter,
        tags: tagFilter,
      },
    ],
    queryFn: () =>
      listScreeningQuestions({
        page,
        limit: pageSize,
        search: debouncedSearch.trim() || undefined,
        difficultyLevel: difficultyFilter || undefined,
        categoryId: categoryFilter || undefined,
        tags: tagFilter.length > 0 ? tagFilter : undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const rows = data?.data ?? [];

  // Category catalog — feeds the category filter and the row-label lookup
  // (translating categoryId → name).
  const categoriesQuery = useQuery({
    queryKey: QUESTION_CATEGORIES_QUERY_KEY,
    queryFn: listQuestionCategories,
  });
  const categoryById = new Map(
    (categoriesQuery.data ?? []).map((c) => [c._id, c] as const),
  );

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteScreeningQuestion(id),
    onSuccess: () => {
      toast.success("Question deleted.");
      queryClient.invalidateQueries({ queryKey: ["screeningQuestions"] });
      setDeleteTarget(null);
    },
    onError: (err) => {
      setDeleteError(apiError(err, "Could not delete question."));
    },
  });

  const openCreate = () => {
    setEditTarget(null);
    setFormOpen(true);
  };

  const openEdit = (row: ScreeningQuestion) => {
    setEditTarget(row);
    setFormOpen(true);
  };

  const openDelete = (row: ScreeningQuestion) => {
    setDeleteError(null);
    setDeleteTarget(row);
  };

  const closeDelete = () => {
    setDeleteTarget(null);
    setDeleteError(null);
  };

  const total = data?.count ?? 0;
  const totalPages = data?.totalPage ?? 0;

  // Deleting the last row on a non-first page leaves `page` pointing past the
  // end: the backend returns an empty `data` for the out-of-range page while
  // `count` still reports the survivors, which would strand the user on a
  // false "No questions yet" screen with the pager hidden. Clamp `page` back
  // into range so the next fetch lands on a real page. Gated on `!isFetching`
  // so it reads the resolved response, not a transient keepPreviousData frame.
  useEffect(() => {
    if (!isFetching && total > 0 && rows.length === 0 && page > totalPages) {
      setPage(Math.max(1, totalPages));
    }
  }, [isFetching, total, rows.length, page, totalPages]);

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-6 lg:px-8 lg:py-8">
      {/* Page header */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="inline-flex text-primary">
              <Library className="h-[18px] w-[18px]" strokeWidth={1.7} />
            </span>
            <h1 className="text-[23px] font-semibold tracking-tight text-ink">
              Question bank
            </h1>
          </div>
          <p className="mt-1.5 max-w-[620px] text-[13.5px] text-ink-muted">
            Every screening question your jobs can draw from. Editing here never
            changes a job that already uses one.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Add question
          </Button>
        </div>
      </div>

      {/* Body card */}
      <div className="rounded-2xl border border-line bg-surface">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-[18px] py-[15px]">
          <div className="text-[14px] font-semibold text-ink">
            {total} {total === 1 ? "question" : "questions"}
          </div>
          <div className="flex-1" />
          <div className="relative w-full max-w-[260px] flex-shrink">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-ink-subtle"
              strokeWidth={1.7}
            />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search questions…"
              className="h-[37px] w-full rounded-[9px] border border-[var(--field-border)] bg-surface pl-9 pr-3 text-[13px] text-ink outline-none placeholder:text-ink-subtle focus:border-primary focus:shadow-[0_0_0_3px_var(--accent-ring)]"
            />
          </div>
          <Select
            value={categoryFilter || ALL}
            onValueChange={(v) => {
              setCategoryFilter(v === ALL ? "" : v);
              setPage(1);
            }}
          >
            <SelectTrigger className="h-[37px] w-[160px] rounded-[9px] border-[var(--field-border)] bg-surface text-[13px]">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All categories</SelectItem>
              {(categoriesQuery.data ?? []).map((c) => (
                <SelectItem key={c._id} value={c._id}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={difficultyFilter || ALL}
            onValueChange={(v) => {
              setDifficultyFilter(v === ALL ? "" : (v as DifficultyLevel));
              setPage(1);
            }}
          >
            <SelectTrigger className="h-[37px] w-[160px] rounded-[9px] border-[var(--field-border)] bg-surface text-[13px]">
              <SelectValue placeholder="All difficulties" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All difficulties</SelectItem>
              {DIFFICULTY_LEVELS.map((d) => (
                <SelectItem key={d} value={d}>
                  {DIFFICULTY_LABELS[d]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <TagsInput
            value={tagFilter}
            onChange={(next) => {
              setTagFilter(next);
              setPage(1);
            }}
            placeholder="Filter by tags…"
            className="min-w-[220px] flex-1 basis-[220px]"
          />
        </div>

        {/* Rows */}
        <TooltipProvider delayDuration={300}>
          {isLoading ? (
            <QuestionListSkeleton />
          ) : isError ? (
            <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center text-[13.5px] text-[var(--danger)]">
              Could not load questions.
              <button
                onClick={() => refetch()}
                className="text-primary underline"
              >
                Retry
              </button>
            </div>
          ) : total === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
              <span className="flex h-[50px] w-[50px] items-center justify-center rounded-[14px] bg-accent text-primary">
                <Library className="h-[26px] w-[26px]" strokeWidth={1.6} />
              </span>
              <h3 className="text-[16px] font-semibold text-ink">
                No questions yet
              </h3>
              <p className="max-w-[340px] text-[13.5px] text-ink-muted">
                Add your first screening question to start building a bank your
                jobs can draw from.
              </p>
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4" />
                Add question
              </Button>
            </div>
          ) : (
            <div>
              {rows.map((row) => {
                const askable = askableCount(row);
                const label = questionLabel(row);
                const category = row.categoryId
                  ? categoryById.get(row.categoryId)?.label ?? null
                  : null;
                const otherTags = row.tags;
                return (
                  <div
                    key={row._id}
                    onClick={() => setPreviewQuestion(row)}
                    className="flex cursor-pointer items-start gap-3.5 border-b border-line bg-surface px-[18px] py-[15px] last:border-b-0 hover:bg-hover"
                  >
                    <span className="mt-0.5 flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-lg bg-surface-3 text-ink-subtle">
                      <MessageCircleQuestion className="h-4 w-4" strokeWidth={1.6} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p
                        className="line-clamp-2 text-[14px] font-medium leading-[1.4] text-ink"
                        title={label}
                      >
                        {label}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {category ? (
                          <span
                            className="inline-flex items-center rounded-full bg-accent px-2.5 py-0.5 text-[11.5px] font-semibold text-primary"
                            title={`Category: ${category}`}
                          >
                            {category}
                          </span>
                        ) : null}
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${
                            DIFFICULTY_PILL[row.difficultyLevel]
                          }`}
                        >
                          {DIFFICULTY_LABELS[row.difficultyLevel]}
                        </span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${
                                askable > 1
                                  ? "bg-[color-mix(in_oklab,var(--info),white_88%)] text-[var(--info)]"
                                  : "bg-surface-3 text-ink-subtle"
                              }`}
                            >
                              <Sparkles
                                className="h-[11px] w-[11px]"
                                strokeWidth={1.8}
                              />
                              {askable} wording{askable === 1 ? "" : "s"}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            {askable === 1
                              ? "Every candidate is asked these exact words. Add wordings so they can't compare notes."
                              : `Each candidate is asked one of ${askable} wordings, picked at random.`}
                          </TooltipContent>
                        </Tooltip>
                        {otherTags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex max-w-40 items-center rounded-full bg-surface-3 px-2.5 py-0.5 text-[11.5px] font-medium text-ink-muted"
                            title={tag}
                          >
                            <span className="min-w-0 truncate">{tag}</span>
                          </span>
                        ))}
                        {otherTags.length > 3 ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex cursor-pointer items-center rounded-full bg-surface-3 px-2.5 py-0.5 text-[11.5px] font-medium text-ink-muted">
                                +{otherTags.length - 3}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              <div className="flex flex-wrap gap-1.5">
                                {otherTags.slice(3).map((tag) => (
                                  <span
                                    key={tag}
                                    className="inline-flex items-center rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-medium text-ink-muted"
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        ) : null}
                      </div>
                    </div>
                    <div
                      className="flex flex-shrink-0 items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => openEdit(row)}
                        title="Edit question"
                        className="flex h-[30px] w-[30px] items-center justify-center rounded-lg text-ink-muted hover:bg-surface-3"
                      >
                        <Pencil className="h-4 w-4" strokeWidth={1.7} />
                      </button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            title="More"
                            className="flex h-[28px] w-[28px] items-center justify-center rounded-lg text-ink-subtle hover:bg-surface-3"
                          >
                            <MoreHorizontal
                              className="h-4 w-4"
                              strokeWidth={1.7}
                            />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => openEdit(row)}>
                            <Pencil className="h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onSelect={() => openDelete(row)}
                            className="text-[var(--danger)] focus:bg-[var(--danger-soft)] focus:text-[var(--danger)]"
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TooltipProvider>

        {/* Footer / pagination */}
        {total > 0 ? (
          <div className="flex flex-col gap-3 border-t border-line px-[18px] py-3 sm:flex-row sm:items-center sm:justify-between">
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
                  <SelectTrigger className="h-8 w-[72px] rounded-[8px] border-[var(--field-border)] bg-surface text-[12.5px]">
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
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPage((p) => p + 1)}
                disabled={!data?.nextPage || isFetching}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <QuestionFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        question={editTarget}
      />

      <QuestionPreviewDialog
        open={Boolean(previewQuestion)}
        onOpenChange={(o) => !o && setPreviewQuestion(null)}
        question={previewQuestion}
        onEdit={(q) => {
          setPreviewQuestion(null);
          openEdit(q);
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(o) => !o && closeDelete()}
        title="Delete this question?"
        description={
          // Spans, not divs: DialogDescription renders a <p>.
          <span className="block space-y-2">
            <span className="line-clamp-3 block rounded-md border border-line bg-surface-2 px-3 py-2 text-[12px] italic text-ink-2">
              {deleteTarget ? questionLabel(deleteTarget) : ""}
            </span>
            {deleteError ? (
              <span className="block text-[var(--danger)]">{deleteError}</span>
            ) : (
              <span className="block">
                Removes it and all of its wordings from the bank. Interviews
                that already asked it keep the exact words they used. This
                cannot be undone.
              </span>
            )}
          </span>
        }
        confirmLabel="Delete"
        cancelLabel={deleteError ? "Close" : "Cancel"}
        loadingLabel="Deleting…"
        destructive
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (!deleteTarget) return;
          // Clear a previous guard message: the retry may well succeed now
          // that the operator has detached the question elsewhere.
          setDeleteError(null);
          deleteMutation.mutate(deleteTarget._id);
        }}
      />
    </div>
  );
}

/**
 * Loading placeholder for the question list. Mirrors a real row's flex layout —
 * a rounded icon tile, two lines of question text, a row of pills (category /
 * difficulty / wordings / tags) and the trailing edit + kebab controls — so
 * the list doesn't jump when the questions arrive. Pill widths are varied per
 * row so the shimmer reads as content rather than a repeating pattern.
 */
function QuestionListSkeleton() {
  const pillSets = ["w-16 w-14 w-20", "w-20 w-16 w-12", "w-14 w-20 w-16"];
  return (
    <div>
      {Array.from({ length: 6 }).map((_, i) => {
        const widths = pillSets[i % pillSets.length].split(" ");
        return (
          <div
            key={i}
            className="flex items-start gap-3.5 border-b border-line bg-surface px-[18px] py-[15px] last:border-b-0"
          >
            <Skeleton className="mt-0.5 h-[30px] w-[30px] flex-shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-3.5 w-3/4 max-w-full" />
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {widths.map((w, j) => (
                  <Skeleton key={j} className={`h-5 ${w} rounded-full`} />
                ))}
              </div>
            </div>
            <div className="flex flex-shrink-0 items-center gap-1">
              <Skeleton className="h-[30px] w-[30px] rounded-lg" />
              <Skeleton className="h-[28px] w-[28px] rounded-lg" />
            </div>
          </div>
        );
      })}
    </div>
  );
}
