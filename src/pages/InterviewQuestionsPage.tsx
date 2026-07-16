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
  Paperclip,
  Pencil,
  Plus,
  RotateCw,
  Search,
  Trash2,
} from "lucide-react";
import toast from "react-hot-toast";
import axios from "axios";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Combobox } from "@/components/ui/combobox";
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
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { InterviewQuestionFormDialog } from "@/features/interview-questions/components/InterviewQuestionFormDialog";
import {
  deleteInterviewQuestion,
  listInterviewQuestions,
  listQuestionDifficultyOptions,
  listQuestionEnvironmentOptions,
  listQuestionTypeOptions,
} from "@/features/interview-questions/interviewQuestionsApi";
import {
  QUESTION_DIFFICULTIES,
  QUESTION_ENVIRONMENTS,
  QUESTION_ENVIRONMENT_LABELS,
  formatTypeLabel,
  type InterviewQuestionDifficulty,
  type InterviewQuestionListItem,
  type QuestionEnvironment,
  type QuestionEnumOption,
} from "@/features/interview-questions/types";

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const DEFAULT_PAGE_SIZE = 20;

/** Sentinel for the "no filter" option (Radix Select forbids empty values). */
const ALL = "all";

/** Humanize a fallback enum value, e.g. "easy" -> "Easy". */
const humanize = (value: string) =>
  value
    .split(/[_-]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

const apiError = (err: unknown, fallback: string) =>
  axios.isAxiosError(err) &&
  (err.response?.data as { message?: string } | undefined)?.message
    ? (err.response!.data as { message: string }).message
    : fallback;

const difficultyVariant: Record<
  InterviewQuestionDifficulty,
  "success" | "warning" | "destructive"
> = {
  easy: "success",
  medium: "warning",
  hard: "destructive",
};

export function InterviewQuestionsPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [search, setSearch] = useState("");
  const [environmentFilter, setEnvironmentFilter] = useState<
    QuestionEnvironment | ""
  >("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [difficultyFilter, setDifficultyFilter] = useState<
    InterviewQuestionDifficulty | ""
  >("");
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<InterviewQuestionListItem | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] =
    useState<InterviewQuestionListItem | null>(null);

  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: [
      "interviewQuestions",
      {
        page,
        limit: pageSize,
        search,
        environment: environmentFilter,
        type: typeFilter,
        difficultyFilter,
      },
    ],
    queryFn: () =>
      listInterviewQuestions({
        page,
        limit: pageSize,
        search: search.trim() || undefined,
        environment: environmentFilter || undefined,
        type: typeFilter.trim() || undefined,
        difficultyLevel: difficultyFilter || undefined,
      }),
    placeholderData: keepPreviousData,
  });

  // Filter dropdown options come from the backend enum endpoints so new
  // enum values surface automatically; static arrays are the fallback.
  // `types` here are free-form autocomplete suggestions, not a fixed enum.
  const typeOptionsQuery = useQuery({
    queryKey: ["questionEnums", "types"],
    queryFn: listQuestionTypeOptions,
    staleTime: Infinity,
  });
  const environmentOptionsQuery = useQuery({
    queryKey: ["questionEnums", "environments"],
    queryFn: listQuestionEnvironmentOptions,
    staleTime: Infinity,
  });
  const difficultyOptionsQuery = useQuery({
    queryKey: ["questionEnums", "difficulties"],
    queryFn: listQuestionDifficultyOptions,
    staleTime: Infinity,
  });

  const environmentOptions: QuestionEnumOption[] =
    environmentOptionsQuery.data ??
    QUESTION_ENVIRONMENTS.map((e) => ({
      value: e,
      label: QUESTION_ENVIRONMENT_LABELS[e],
    }));
  const typeSuggestions: QuestionEnumOption[] = typeOptionsQuery.data ?? [];
  const difficultyOptions: QuestionEnumOption[] =
    difficultyOptionsQuery.data ??
    QUESTION_DIFFICULTIES.map((d) => ({ value: d, label: humanize(d) }));

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteInterviewQuestion(id),
    onSuccess: () => {
      toast.success("Question deleted.");
      queryClient.invalidateQueries({ queryKey: ["interviewQuestions"] });
      setDeleteTarget(null);
    },
    onError: (err) => {
      toast.error(apiError(err, "Could not delete question."));
      setDeleteTarget(null);
    },
  });

  const openCreate = () => {
    setEditTarget(null);
    setFormOpen(true);
  };

  const openEdit = (row: InterviewQuestionListItem) => {
    setEditTarget(row);
    setFormOpen(true);
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
            Interview Questions
          </h1>
          <p className="text-sm text-muted-foreground">
            Create and manage the question bank used across AI interviews.
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
                  placeholder="Search name…"
                  className="pl-9"
                />
              </div>
              <Select
                value={environmentFilter || ALL}
                onValueChange={(v) => {
                  setEnvironmentFilter(
                    v === ALL ? "" : (v as QuestionEnvironment),
                  );
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-9 w-full sm:w-40">
                  <SelectValue placeholder="All environments" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All environments</SelectItem>
                  {environmentOptions.map((e) => (
                    <SelectItem key={e.value} value={e.value}>
                      {e.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Combobox
                value={typeFilter}
                onValueChange={(v) => {
                  setTypeFilter(v.toLowerCase());
                  setPage(1);
                }}
                options={typeSuggestions}
                placeholder="Filter by type…"
                className="w-full sm:w-40"
                inputClassName="h-9"
              />
              <Select
                value={difficultyFilter || ALL}
                onValueChange={(v) => {
                  setDifficultyFilter(
                    v === ALL ? "" : (v as InterviewQuestionDifficulty),
                  );
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-9 w-full sm:w-40">
                  <SelectValue placeholder="All difficulties" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All difficulties</SelectItem>
                  {difficultyOptions.map((d) => (
                    <SelectItem key={d.value} value={d.value}>
                      {d.label}
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Name</TableHead>
                <TableHead>Environment</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Difficulty</TableHead>
                <TableHead>Time limit</TableHead>
                <TableHead>Files</TableHead>
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
                    Loading questions…
                  </TableCell>
                </TableRow>
              ) : isError ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-16 text-center text-sm text-destructive"
                  >
                    Failed to load questions.{" "}
                    <button onClick={() => refetch()} className="underline">
                      Retry
                    </button>
                  </TableCell>
                </TableRow>
              ) : (data?.data ?? []).length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-16 text-center text-sm text-muted-foreground"
                  >
                    No questions yet. Click "Add question" to create one.
                  </TableCell>
                </TableRow>
              ) : (
                (data?.data ?? []).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="pl-6">
                      <div className="font-medium leading-tight">
                        {row.name}
                      </div>
                      {row.description ? (
                        <div className="line-clamp-1 max-w-md text-xs text-muted-foreground">
                          {row.description}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {QUESTION_ENVIRONMENT_LABELS[row.environment] ??
                          row.environment ??
                          "—"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {row.type ? (
                        <Badge variant="secondary">
                          {formatTypeLabel(row.type)}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={difficultyVariant[row.difficultyLevel]}
                        className="capitalize"
                      >
                        {row.difficultyLevel}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {row.timeLimit} min
                    </TableCell>
                    <TableCell className="text-sm">
                      {row.fileCount > 0 ? (
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <Paperclip className="h-3.5 w-3.5" />
                          {row.fileCount}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
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
                          onClick={() => setDeleteTarget(row)}
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

      <InterviewQuestionFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        question={editTarget}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={`Delete "${deleteTarget?.name ?? "question"}"?`}
        description="Removes the question and its file references. This cannot be undone."
        confirmLabel="Delete"
        loadingLabel="Deleting…"
        destructive
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
      />
    </div>
  );
}
