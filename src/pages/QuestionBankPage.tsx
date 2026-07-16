import { useState } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  ListChecks,
  Loader2,
  Pencil,
  Plus,
  RotateCw,
  Search,
  Trash2,
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
import { Label } from "@/components/ui/label";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { QuestionFormDialog } from "@/features/screening-questions/components/QuestionFormDialog";
import { TagsInput } from "@/features/screening-questions/components/TagsInput";
import {
  deleteScreeningQuestion,
  listScreeningQuestions,
} from "@/features/screening-questions/screeningQuestionsApi";
import {
  DIFFICULTY_LABELS,
  DIFFICULTY_LEVELS,
  difficultyVariant,
  type DifficultyLevel,
  type ScreeningQuestion,
} from "@/features/screening-questions/types";
import { formatDateTime } from "@/lib/date";
import { errorMessage as apiError } from "@/lib/errors";

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const DEFAULT_PAGE_SIZE = 20;

/** Sentinel for the "no filter" option (Radix Select forbids empty values). */
const ALL = "all";

/** Number of tag chips shown inline before the rest collapse into "+N". */
const TAGS_SHOWN = 2;

export function QuestionBankPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [search, setSearch] = useState("");
  const [difficultyFilter, setDifficultyFilter] = useState<DifficultyLevel | "">(
    "",
  );
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ScreeningQuestion | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ScreeningQuestion | null>(
    null,
  );
  // The delete-guard's 409 message names the jobs holding the question, so it
  // lives in the dialog until dismissed rather than in a toast that vanishes.
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: [
      "screeningQuestions",
      {
        page,
        limit: pageSize,
        search,
        difficultyLevel: difficultyFilter,
        tags: tagFilter,
      },
    ],
    queryFn: () =>
      listScreeningQuestions({
        page,
        limit: pageSize,
        search: search.trim() || undefined,
        difficultyLevel: difficultyFilter || undefined,
        tags: tagFilter.length > 0 ? tagFilter : undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const rows = data?.data ?? [];

  // The bank has no distinct-tags endpoint, so suggestions come from the rows
  // in hand. Under `$all` that's the right set: whatever co-occurs with the
  // current selection is what can still narrow to a non-empty result.
  const tagSuggestions = Array.from(new Set(rows.flatMap((q) => q.tags))).sort(
    (a, b) => a.localeCompare(b),
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
  const showingFrom = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const showingTo = Math.min(page * pageSize, total);

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <ListChecks className="h-6 w-6 text-primary" />
            Question Bank
          </h1>
          <p className="text-sm text-muted-foreground">
            The screening questions your jobs draw from. Attaching one to a job
            freezes its wording there.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Add question
        </Button>
      </div>

      <Card>
        <CardHeader className="border-b border-border">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle>Questions</CardTitle>
              <CardDescription>
                {total > 0
                  ? `Showing ${showingFrom}–${showingTo} of ${total}`
                  : "No questions yet."}
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
                  placeholder="Search questions…"
                  className="pl-9"
                />
              </div>
              <Select
                value={difficultyFilter || ALL}
                onValueChange={(v) => {
                  setDifficultyFilter(v === ALL ? "" : (v as DifficultyLevel));
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-9 w-full sm:w-40">
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

          {/* Tags get their own row: chips wrap, and a wrapping control would
              fight the h-9 filters above. */}
          <div className="mt-3 flex flex-col gap-1.5">
            <Label htmlFor="q-tag-filter" className="text-xs font-medium">
              Filter by tags
            </Label>
            <TagsInput
              id="q-tag-filter"
              value={tagFilter}
              onChange={(next) => {
                setTagFilter(next);
                setPage(1);
              }}
              suggestions={tagSuggestions}
              placeholder="Type a tag and press Enter"
              className="w-full lg:max-w-md"
            />
            <p className="text-xs text-muted-foreground">
              Narrowing filter — a question must carry <strong>all</strong> of
              these tags to show, not just one of them.
            </p>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <TooltipProvider delayDuration={300}>
            <Table containerClassName="max-h-[70vh]">
              {/* Sticky header: with up to 100 rows per page, pin the column
                  names to the top of the (height-bounded) scroll area.
                  `bg-card` keeps rows from showing through underneath. */}
              <TableHeader className="sticky top-0 z-20 bg-card [&_th]:bg-card">
                <TableRow>
                  <TableHead className="pl-6">Question</TableHead>
                  <TableHead className="w-32">Difficulty</TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead className="w-48">Updated</TableHead>
                  <TableHead className="w-28 pr-6 text-center">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-16 text-center text-sm text-muted-foreground"
                    >
                      <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-primary" />
                      Loading questions…
                    </TableCell>
                  </TableRow>
                ) : isError ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-16 text-center text-sm text-destructive"
                    >
                      Could not load questions.{" "}
                      <button onClick={() => refetch()} className="underline">
                        Retry
                      </button>
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-16 text-center text-sm text-muted-foreground"
                    >
                      No questions yet. Click "Add question" to create one.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => (
                    <TableRow key={row._id}>
                      <TableCell className="pl-6">
                        <p
                          className="line-clamp-2 max-w-xl leading-snug"
                          title={row.text}
                        >
                          {row.text}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={difficultyVariant[row.difficultyLevel]}
                          className="capitalize"
                        >
                          {row.difficultyLevel}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <TagChips tags={row.tags} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {formatDateTime(row.updatedAt)}
                      </TableCell>
                      <TableCell className="pr-6 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Edit question"
                            onClick={() => openEdit(row)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Delete question"
                            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => openDelete(row)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TooltipProvider>
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

      <QuestionFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        question={editTarget}
        tagSuggestions={tagSuggestions}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(o) => !o && closeDelete()}
        title="Delete this question?"
        description={
          // Spans, not divs: DialogDescription renders a <p>.
          <span className="block space-y-2">
            <span className="line-clamp-3 block rounded-md border border-border bg-muted/40 px-3 py-2 text-xs italic">
              {deleteTarget?.text}
            </span>
            {deleteError ? (
              <span className="block text-destructive">{deleteError}</span>
            ) : (
              <span className="block">
                Removes it from the bank. Interviews that already asked it keep
                their own copy of the wording. This cannot be undone.
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
 * Tag chips with "+N" overflow, mirroring the Overview cards' criteria chips.
 */
function TagChips({ tags }: { tags: string[] }) {
  if (tags.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }

  const shown = tags.slice(0, TAGS_SHOWN);
  const hidden = tags.slice(TAGS_SHOWN);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {shown.map((tag) => (
        <Badge
          key={tag}
          variant="secondary"
          className="min-w-0 max-w-40"
          title={tag}
        >
          <span className="min-w-0 truncate">{tag}</span>
        </Badge>
      ))}
      {hidden.length > 0 ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="muted" className="shrink-0 cursor-pointer">
              +{hidden.length}
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p className="mb-2 font-medium">
              {hidden.length} more {hidden.length === 1 ? "tag" : "tags"}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {hidden.map((tag) => (
                <Badge key={tag} variant="secondary">
                  {tag}
                </Badge>
              ))}
            </div>
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}
