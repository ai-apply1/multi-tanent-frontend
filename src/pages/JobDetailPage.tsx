import type { ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronDown,
  Loader2,
  Pencil,
  Users,
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
import { Markdown } from "@/components/Markdown";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { JobQuestionsManager } from "@/features/jobs/components/JobQuestionsManager";
import { getJob, setJobStatus } from "@/features/jobs/jobsApi";
import {
  EMPLOYMENT_TYPE_LABELS,
  JOB_STATUS_LABELS,
  SENIORITY_LABELS,
  STATUS_TRANSITIONS,
  WORK_MODE_LABELS,
  type Job,
  type JobStatus,
} from "@/features/jobs/types";
import { useOrganization } from "@/features/organization/useOrganization";
import { ROUTES, jobCandidates, jobEdit } from "@/routes";
import { formatDate } from "@/lib/date";
import { errorMessage } from "@/lib/errors";

const statusVariant: Record<
  JobStatus,
  "outline" | "success" | "secondary" | "muted"
> = {
  draft: "outline",
  open: "success",
  closed: "secondary",
  archived: "muted",
};

export function JobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: job, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => getJob(jobId!),
    enabled: Boolean(jobId),
  });

  const statusMutation = useMutation({
    mutationFn: (status: JobStatus) => setJobStatus(jobId!, status),
    onSuccess: (saved) => {
      toast.success(`Job ${JOB_STATUS_LABELS[saved.status].toLowerCase()}.`);
      queryClient.setQueryData(["job", saved._id], saved);
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (err) =>
      toast.error(errorMessage(err, "Could not change the job status.")),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        Loading job…
      </div>
    );
  }

  if (isError || !job) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <p className="text-sm text-destructive">
            {errorMessage(error, "Could not load this job.")}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Retry
            </Button>
            <Button size="sm" onClick={() => navigate(ROUTES.JOBS)}>
              Back to jobs
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const transitions = STATUS_TRANSITIONS[job.status];

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
            {job.title}
            <Badge variant={statusVariant[job.status]}>
              {JOB_STATUS_LABELS[job.status]}
            </Badge>
          </h1>
          <p className="text-sm text-muted-foreground">
            Created {formatDate(job.createdAt)} · updated{" "}
            {formatDate(job.updatedAt)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(ROUTES.JOBS)}
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(jobCandidates(job._id))}
          >
            <Users className="h-4 w-4" />
            View candidates
          </Button>
          {/* Only the transitions legal from THIS status — the backend 409s on
              anything else, and `archived` is terminal (no menu at all). */}
          {transitions.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={statusMutation.isPending}
                >
                  {statusMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  Change status
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {transitions.map((t) => (
                  <DropdownMenuItem
                    key={t.status}
                    onSelect={() => statusMutation.mutate(t.status)}
                  >
                    {t.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <Button size="sm" onClick={() => navigate(jobEdit(job._id))}>
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
        </div>
      </div>

      <JobSummaryCard job={job} />
      <JobQuestionsManager job={job} />
    </div>
  );
}

/** One labelled value in the summary grid. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-sm">{children}</span>
    </div>
  );
}

const EMPTY = <span className="text-muted-foreground">—</span>;

function JobSummaryCard({ job }: { job: Job }) {
  const { data: organization } = useOrganization();
  const requiredSkills = job.eligibility.requiredSkills;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Summary</CardTitle>
        <CardDescription>
          The posting, its scoring split and the gates the CV pre-screen runs.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Employment type">
            {job.employmentType
              ? EMPLOYMENT_TYPE_LABELS[job.employmentType]
              : EMPTY}
          </Field>
          <Field label="Work mode">
            {job.workMode ? WORK_MODE_LABELS[job.workMode] : EMPTY}
          </Field>
          <Field label="Seniority">
            {job.seniorityLevel ? SENIORITY_LABELS[job.seniorityLevel] : EMPTY}
          </Field>
          <Field label="Interview attempts">
            {job.maxAttempts === null ? (
              <span className="text-muted-foreground">
                Org default
                {organization
                  ? ` (${organization.settings.maxInterviewAttempts})`
                  : ""}
              </span>
            ) : (
              job.maxAttempts
            )}
          </Field>
          <Field label="Score split">
            Technical {job.scoringWeights.technical}% / Communication{" "}
            {job.scoringWeights.communication}%
          </Field>
          <Field label="Shortlist threshold">{job.rejectionThreshold}</Field>
          <Field label="City gate">{job.eligibility.city || EMPTY}</Field>
          <Field label="Minimum experience">
            {job.eligibility.minYearsExperience === null
              ? EMPTY
              : `${job.eligibility.minYearsExperience} yrs`}
          </Field>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Required skills
          </span>
          {requiredSkills.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {requiredSkills.map((skill) => (
                <Badge key={skill} variant="secondary">
                  {skill}
                </Badge>
              ))}
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">
              None — no skill is a hard requirement.
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Description
          </span>
          {job.description.trim() ? (
            <Markdown content={job.description} />
          ) : (
            <span className="text-sm text-muted-foreground">
              No description.
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
