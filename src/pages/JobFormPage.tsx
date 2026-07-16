import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Briefcase, Loader2, Plus, Save, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/Markdown";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChipInput } from "@/features/jobs/components/ChipInput";
import { createJob, getJob, updateJob } from "@/features/jobs/jobsApi";
import {
  EMPLOYMENT_TYPE_LABELS,
  SENIORITY_LABELS,
  WORK_MODE_LABELS,
  type CreateJobPayload,
  type EmploymentType,
  type Job,
  type JobEligibilityPayload,
  type SeniorityLevel,
  type VettingConfigPayload,
  type WorkMode,
} from "@/features/jobs/types";
import { useOrganization } from "@/features/organization/useOrganization";
import { ROUTES, jobDetail } from "@/routes";
import { errorMessage } from "@/lib/errors";

/** Sentinel for the "Not specified" option (Radix Select forbids empty values). */
const NONE = "none";

/** The scoring split presets, as `technical` percentages. */
const WEIGHT_PRESETS = [60, 50, 70];

const EMPLOYMENT_TYPES = Object.keys(
  EMPLOYMENT_TYPE_LABELS,
) as EmploymentType[];
const WORK_MODES = Object.keys(WORK_MODE_LABELS) as WorkMode[];
const SENIORITY_LEVELS = Object.keys(SENIORITY_LABELS) as SeniorityLevel[];

/** A vetting-metric row. `key` is local only — it keeps React reconciliation
 *  stable while the name (the natural id) is still being typed. */
interface MetricRow {
  key: number;
  name: string;
  rule: string;
  weight: string;
}

/** Parse a numeric field that is allowed to be blank. */
const parseOptionalNumber = (raw: string): number | undefined => {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
};

export function JobFormPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const isEdit = Boolean(jobId);

  const jobQuery = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => getJob(jobId!),
    enabled: isEdit,
  });

  if (isEdit && jobQuery.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        Loading job…
      </div>
    );
  }

  if (isEdit && jobQuery.isError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <p className="text-sm text-destructive">
            {errorMessage(jobQuery.error, "Could not load this job.")}
          </p>
          <Button variant="outline" size="sm" onClick={() => jobQuery.refetch()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Mounted only once the job resolves, and seeds state straight from it rather
  // than from a post-mount effect. Both halves are load-bearing:
  //
  //  - Seeding from props, not an effect: Radix's Select syncs a hidden native
  //    <select> whenever `value` changes and dispatches a real change event. Its
  //    <option>s aren't registered on first render, so an effect that flips the
  //    value right after mount lands in that window, reads back "", and feeds ""
  //    into state — the Selects render blank and every PATCH 400s on @IsEnum.
  //  - `key`: the deleted effect also re-seeded on job change. Without a remount,
  //    an SPA nav between two edit routes on a warm cache never re-seeds and saves
  //    the previous job's data to the new job's id.
  return (
    <JobForm key={jobId ?? "new"} job={jobQuery.data ?? null} jobId={jobId} />
  );
}

function JobForm({ job, jobId }: { job: Job | null; jobId?: string }) {
  const isEdit = Boolean(jobId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const custom = job?.eligibility.custom ?? null;
  // Seeded rows take keys 1..n, so the counter starts at n.
  const metricKey = useRef(custom?.metrics.length ?? 0);
  const nextMetricKey = () => {
    metricKey.current += 1;
    return metricKey.current;
  };

  // ── Basics
  const [title, setTitle] = useState(job?.title ?? "");
  const [titleTouched, setTitleTouched] = useState(false);
  const [description, setDescription] = useState(job?.description ?? "");
  const [descTab, setDescTab] = useState<"write" | "preview">("write");

  // ── Classification
  const [employmentType, setEmploymentType] = useState<string>(
    job?.employmentType ?? NONE,
  );
  const [workMode, setWorkMode] = useState<string>(job?.workMode ?? NONE);
  const [seniorityLevel, setSeniorityLevel] = useState<string>(
    job?.seniorityLevel ?? NONE,
  );

  // ── Scoring. ONE number: communication is always `100 - technical`, so the
  // backend's "must sum to 100" invariant can't be violated from this form.
  const [technicalWeight, setTechnicalWeight] = useState(
    job?.scoringWeights.technical ?? 60,
  );
  const [rejectionThreshold, setRejectionThreshold] = useState(
    job ? String(job.rejectionThreshold) : "70",
  );
  const [maxAttempts, setMaxAttempts] = useState(
    job?.maxAttempts == null ? "" : String(job.maxAttempts),
  );

  // ── Eligibility & vetting
  const [city, setCity] = useState(job?.eligibility.city ?? "");
  const [minYearsExperience, setMinYearsExperience] = useState(
    job?.eligibility.minYearsExperience == null
      ? ""
      : String(job.eligibility.minYearsExperience),
  );
  const [requiredSkills, setRequiredSkills] = useState<string[]>(
    custom?.requiredSkills ?? [],
  );
  const [metrics, setMetrics] = useState<MetricRow[]>(() =>
    (custom?.metrics ?? []).map((m, i) => ({
      key: i + 1,
      name: m.name,
      rule: m.rule,
      weight: String(m.weight),
    })),
  );
  const [acceptThreshold, setAcceptThreshold] = useState(
    custom?.acceptThreshold == null ? "" : String(custom.acceptThreshold),
  );
  const [rejectThreshold, setRejectThreshold] = useState(
    custom?.rejectThreshold == null ? "" : String(custom.rejectThreshold),
  );

  const { data: organization } = useOrganization();

  // ── validation
  const trimmedTitle = title.trim();
  const titleError =
    titleTouched && trimmedTitle.length === 0 ? "A job title is required." : "";

  const parsedRejection = parseOptionalNumber(rejectionThreshold);
  const rejectionError =
    parsedRejection === undefined ||
    parsedRejection < 0 ||
    parsedRejection > 100
      ? "Enter a number between 0 and 100."
      : "";

  const parsedMaxAttempts = parseOptionalNumber(maxAttempts);
  const maxAttemptsError =
    maxAttempts.trim() &&
    (parsedMaxAttempts === undefined ||
      !Number.isInteger(parsedMaxAttempts) ||
      parsedMaxAttempts < 1)
      ? "Enter a whole number of 1 or more, or leave it empty."
      : "";

  const parsedMinYears = parseOptionalNumber(minYearsExperience);
  const minYearsError =
    minYearsExperience.trim() &&
    (parsedMinYears === undefined || parsedMinYears < 0)
      ? "Enter 0 or more, or leave it empty."
      : "";

  const parsedAccept = parseOptionalNumber(acceptThreshold);
  const parsedReject = parseOptionalNumber(rejectThreshold);
  const acceptRangeError =
    acceptThreshold.trim() &&
    (parsedAccept === undefined || parsedAccept < 0 || parsedAccept > 100)
      ? "Enter a number between 0 and 100."
      : "";
  const rejectRangeError =
    rejectThreshold.trim() &&
    (parsedReject === undefined || parsedReject < 0 || parsedReject > 100)
      ? "Enter a number between 0 and 100."
      : "";
  // The backend 422s on an inverted pair, and only checks it when BOTH are
  // present — mirror that exactly rather than guessing at the missing one.
  const thresholdOrderError =
    parsedAccept !== undefined &&
    parsedReject !== undefined &&
    parsedAccept < parsedReject
      ? "The accept line must be at or above the reject line — otherwise there is no review band."
      : "";

  const metricsError = metrics.some(
    (m) =>
      !m.name.trim() ||
      !m.rule.trim() ||
      parseOptionalNumber(m.weight) === undefined ||
      (parseOptionalNumber(m.weight) ?? -1) < 0,
  )
    ? "Every metric needs a name, a rule and a weight of 0 or more."
    : "";

  const hasErrors = Boolean(
    trimmedTitle.length === 0 ||
      rejectionError ||
      maxAttemptsError ||
      minYearsError ||
      acceptRangeError ||
      rejectRangeError ||
      thresholdOrderError ||
      metricsError,
  );

  // ── payload
  const buildCustom = (): VettingConfigPayload | undefined => {
    const custom: VettingConfigPayload = {};
    if (metrics.length > 0) {
      custom.metrics = metrics.map((m) => ({
        name: m.name.trim(),
        rule: m.rule.trim(),
        weight: parseOptionalNumber(m.weight) ?? 0,
      }));
    }
    if (requiredSkills.length > 0) custom.requiredSkills = requiredSkills;
    if (parsedAccept !== undefined) custom.acceptThreshold = parsedAccept;
    if (parsedReject !== undefined) custom.rejectThreshold = parsedReject;
    // Nothing configured => no vetting config at all (stored as null), rather
    // than an empty shell the engine would still have to reason about.
    return Object.keys(custom).length > 0 ? custom : undefined;
  };

  const buildEligibility = (): JobEligibilityPayload => {
    const eligibility: JobEligibilityPayload = {};
    if (city.trim()) eligibility.city = city.trim();
    if (parsedMinYears !== undefined) {
      eligibility.minYearsExperience = parsedMinYears;
    }
    const custom = buildCustom();
    if (custom) eligibility.custom = custom;
    return eligibility;
  };

  const buildPayload = (): CreateJobPayload => ({
    title: trimmedTitle,
    description: description.trim(),
    // `null`, not undefined: on PATCH undefined means "leave unchanged", so
    // undefined could never clear a value back to Not specified.
    employmentType:
      employmentType === NONE ? null : (employmentType as EmploymentType),
    workMode: workMode === NONE ? null : (workMode as WorkMode),
    seniorityLevel:
      seniorityLevel === NONE ? null : (seniorityLevel as SeniorityLevel),
    // ALWAYS sent, and always complete: eligibility is REPLACE-semantics, so
    // an omitted block leaves the old one intact (clearing the last gate would
    // silently no-op) and an omitted sub-field resets to null.
    eligibility: buildEligibility(),
    scoringWeights: {
      technical: technicalWeight,
      communication: 100 - technicalWeight,
    },
    rejectionThreshold: parsedRejection ?? 70,
    // `null` clears the per-job cap so the org default applies again.
    maxAttempts: parsedMaxAttempts ?? null,
  });

  const mutation = useMutation({
    mutationFn: () =>
      isEdit ? updateJob(jobId!, buildPayload()) : createJob(buildPayload()),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.setQueryData(["job", saved._id], saved);
      if (isEdit) {
        toast.success("Job saved.");
      } else {
        // A job with no questions can't interview anyone, so land on the
        // detail page where they're attached rather than back on the list.
        toast.success("Job created. Attach its questions to finish.");
      }
      navigate(jobDetail(saved._id));
    },
    onError: (err) =>
      toast.error(
        errorMessage(
          err,
          isEdit ? "Could not save the job." : "Could not create the job.",
        ),
      ),
  });

  const busy = mutation.isPending;

  return (
    <form
      className="space-y-6 pb-4"
      onSubmit={(e) => {
        e.preventDefault();
        setTitleTouched(true);
        if (hasErrors || busy) return;
        mutation.mutate();
      }}
    >
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Briefcase className="h-6 w-6 text-primary" />
            {isEdit ? "Edit job" : "Create job"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isEdit
              ? "Update the posting, its scoring split and its vetting rules."
              : "New jobs are created as a draft — you can attach questions and publish next."}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => navigate(isEdit ? jobDetail(jobId!) : ROUTES.JOBS)}
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
      </div>

      {/* 1 ── Basics */}
      <Card>
        <CardHeader>
          <CardTitle>Basics</CardTitle>
          <CardDescription>
            What the role is called and what it involves.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col gap-2.5">
            <Label htmlFor="job-title">Title</Label>
            <Input
              id="job-title"
              value={title}
              maxLength={200}
              autoFocus
              aria-invalid={Boolean(titleError)}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => setTitleTouched(true)}
              placeholder="Senior Frontend Engineer"
            />
            {titleError ? (
              <p className="text-xs text-destructive">{titleError}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="job-description">Description</Label>
              <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
                <button
                  type="button"
                  onClick={() => setDescTab("write")}
                  className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                    descTab === "write"
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Write
                </button>
                <button
                  type="button"
                  onClick={() => setDescTab("preview")}
                  className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                    descTab === "preview"
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Preview
                </button>
              </div>
            </div>
            {descTab === "write" ? (
              <Textarea
                id="job-description"
                value={description}
                maxLength={5000}
                rows={10}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What the role involves… (Markdown supported: **bold**, lists, `code`, tables)"
                className="font-mono text-xs"
              />
            ) : (
              <div className="min-h-[11rem] rounded-md border border-input bg-background px-3 py-2">
                {description.trim() ? (
                  <Markdown content={description} />
                ) : (
                  <p className="text-sm italic text-muted-foreground">
                    Nothing to preview yet.
                  </p>
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Markdown is supported. {description.length}/5000
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 2 ── Classification */}
      <Card>
        <CardHeader>
          <CardTitle>Classification</CardTitle>
          <CardDescription>
            Optional labels for the posting. Leave any of them unspecified.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-2.5">
            <Label htmlFor="job-employment">Employment type</Label>
            <Select value={employmentType} onValueChange={setEmploymentType}>
              <SelectTrigger id="job-employment">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not specified</SelectItem>
                {EMPLOYMENT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {EMPLOYMENT_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2.5">
            <Label htmlFor="job-mode">Work mode</Label>
            <Select value={workMode} onValueChange={setWorkMode}>
              <SelectTrigger id="job-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not specified</SelectItem>
                {WORK_MODES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {WORK_MODE_LABELS[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2.5">
            <Label htmlFor="job-seniority">Seniority</Label>
            <Select value={seniorityLevel} onValueChange={setSeniorityLevel}>
              <SelectTrigger id="job-seniority">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not specified</SelectItem>
                {SENIORITY_LEVELS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {SENIORITY_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* 3 ── Scoring */}
      <Card>
        <CardHeader>
          <CardTitle>Scoring</CardTitle>
          <CardDescription>
            How the interview's two axes fold into one overall score, and where
            the shortlist line sits.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {/* One slider, not two inputs: the two weights must sum to exactly
              100, and a single value makes that unrepresentable rather than
              something to validate after the fact. */}
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="job-weights">Score split</Label>
              <div className="flex items-center gap-1">
                {WEIGHT_PRESETS.map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => setTechnicalWeight(pct)}
                    className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                      technicalWeight === pct
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {pct}/{100 - pct}
                  </button>
                ))}
              </div>
            </div>
            <input
              id="job-weights"
              type="range"
              min={0}
              max={100}
              step={5}
              value={technicalWeight}
              onChange={(e) => setTechnicalWeight(Number(e.target.value))}
              className="w-full accent-primary"
            />
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">Technical {technicalWeight}%</span>
              <span className="font-medium">
                Communication {100 - technicalWeight}%
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              The candidate's overall interview score is these two axes folded
              together at this ratio.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2.5">
              <Label htmlFor="job-rejection">Shortlist threshold</Label>
              <Input
                id="job-rejection"
                type="number"
                min={0}
                max={100}
                value={rejectionThreshold}
                aria-invalid={Boolean(rejectionError)}
                onChange={(e) => setRejectionThreshold(e.target.value)}
              />
              {rejectionError ? (
                <p className="text-xs text-destructive">{rejectionError}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  After scoring, an overall at or above this (0–100) shortlists
                  the candidate; below it rejects them.
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2.5">
              <Label htmlFor="job-max-attempts">Interview attempts</Label>
              <Input
                id="job-max-attempts"
                type="number"
                min={1}
                value={maxAttempts}
                aria-invalid={Boolean(maxAttemptsError)}
                onChange={(e) => setMaxAttempts(e.target.value)}
                placeholder={
                  organization
                    ? String(organization.settings.maxInterviewAttempts)
                    : ""
                }
              />
              {maxAttemptsError ? (
                <p className="text-xs text-destructive">{maxAttemptsError}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Leave empty to inherit your organization's default
                  {organization
                    ? ` (${organization.settings.maxInterviewAttempts})`
                    : ""}
                  .
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 4 ── Eligibility & vetting */}
      <Card>
        <CardHeader>
          <CardTitle>Eligibility &amp; vetting</CardTitle>
          <CardDescription>
            The gates and scoring rules the CV pre-screen runs before anyone is
            invited to interview.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2.5">
              <Label htmlFor="job-city">City</Label>
              <Input
                id="job-city"
                value={city}
                maxLength={120}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Any city"
              />
              <p className="text-xs text-muted-foreground">
                A hard gate — leave empty for no city requirement.
              </p>
            </div>
            <div className="flex flex-col gap-2.5">
              <Label htmlFor="job-min-years">Minimum years of experience</Label>
              <Input
                id="job-min-years"
                type="number"
                min={0}
                value={minYearsExperience}
                aria-invalid={Boolean(minYearsError)}
                onChange={(e) => setMinYearsExperience(e.target.value)}
                placeholder="No minimum"
              />
              {minYearsError ? (
                <p className="text-xs text-destructive">{minYearsError}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  A hard gate, counted from the CV's work history.
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            <Label htmlFor="job-skills">Required skills</Label>
            <ChipInput
              id="job-skills"
              values={requiredSkills}
              onChange={setRequiredSkills}
              placeholder="Type a skill and press Enter"
            />
            <p className="text-xs text-muted-foreground">
              A hard gate: every skill listed must appear in the CV, or the
              candidate is rejected before any scoring happens.
            </p>
          </div>

          {/* Weighted metrics — the composite the accept/reject lines below
              are compared against. */}
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <Label>Vetting metrics</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setMetrics((prev) => [
                    ...prev,
                    { key: nextMetricKey(), name: "", rule: "", weight: "1" },
                  ])
                }
              >
                <Plus className="h-4 w-4" />
                Add metric
              </Button>
            </div>
            {metrics.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-4 text-center text-xs text-muted-foreground">
                No metrics yet. Without any, every CV that clears the hard gates
                above scores the same.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {metrics.map((metric, idx) => (
                  <div
                    key={metric.key}
                    className="grid gap-2 rounded-lg border border-border bg-card p-3 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_5rem_auto]"
                  >
                    <Input
                      value={metric.name}
                      maxLength={200}
                      aria-label={`Metric ${idx + 1} name`}
                      placeholder="React depth"
                      onChange={(e) =>
                        setMetrics((prev) =>
                          prev.map((m) =>
                            m.key === metric.key
                              ? { ...m, name: e.target.value }
                              : m,
                          ),
                        )
                      }
                    />
                    <Input
                      value={metric.rule}
                      maxLength={1000}
                      aria-label={`Metric ${idx + 1} rule`}
                      placeholder="3+ years building production React apps"
                      onChange={(e) =>
                        setMetrics((prev) =>
                          prev.map((m) =>
                            m.key === metric.key
                              ? { ...m, rule: e.target.value }
                              : m,
                          ),
                        )
                      }
                    />
                    <Input
                      type="number"
                      min={0}
                      value={metric.weight}
                      aria-label={`Metric ${idx + 1} weight`}
                      onChange={(e) =>
                        setMetrics((prev) =>
                          prev.map((m) =>
                            m.key === metric.key
                              ? { ...m, weight: e.target.value }
                              : m,
                          ),
                        )
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      aria-label={`Remove metric ${idx + 1}`}
                      onClick={() =>
                        setMetrics((prev) =>
                          prev.filter((m) => m.key !== metric.key),
                        )
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {metricsError ? (
              <p className="text-xs text-destructive">{metricsError}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Each metric is scored 0–100 against the CV; the composite is
                their weighted average. A weight of 1 is neutral.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2.5">
            <Label>Decision thresholds</Label>
            {/* Spelling out the three bands is the whole point of this
                section — HR cannot set these two numbers blind. */}
            <p className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              Once the composite is scored:{" "}
              <strong className="font-semibold text-foreground">
                at or above the accept line
              </strong>{" "}
              the candidate is auto-invited to interview;{" "}
              <strong className="font-semibold text-foreground">
                below the reject line
              </strong>{" "}
              they're auto-rejected; anything{" "}
              <strong className="font-semibold text-foreground">
                in between
              </strong>{" "}
              parks at Pre-screened for a human to decide. Set them equal to
              remove the review band entirely.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2.5">
                <Label
                  htmlFor="job-accept"
                  className="text-xs text-muted-foreground"
                >
                  Accept line
                </Label>
                <Input
                  id="job-accept"
                  type="number"
                  min={0}
                  max={100}
                  value={acceptThreshold}
                  aria-invalid={Boolean(acceptRangeError || thresholdOrderError)}
                  onChange={(e) => setAcceptThreshold(e.target.value)}
                  placeholder="Engine default"
                />
                {acceptRangeError ? (
                  <p className="text-xs text-destructive">{acceptRangeError}</p>
                ) : null}
              </div>
              <div className="flex flex-col gap-2.5">
                <Label
                  htmlFor="job-reject"
                  className="text-xs text-muted-foreground"
                >
                  Reject line
                </Label>
                <Input
                  id="job-reject"
                  type="number"
                  min={0}
                  max={100}
                  value={rejectThreshold}
                  aria-invalid={Boolean(rejectRangeError || thresholdOrderError)}
                  onChange={(e) => setRejectThreshold(e.target.value)}
                  placeholder="Engine default"
                />
                {rejectRangeError ? (
                  <p className="text-xs text-destructive">{rejectRangeError}</p>
                ) : null}
              </div>
            </div>
            {thresholdOrderError ? (
              <p className="text-xs text-destructive">{thresholdOrderError}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Leave either empty to use the vetting engine's own default.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="sticky bottom-0 z-10 flex items-center justify-end gap-2 border-t border-border bg-background/95 py-3 backdrop-blur">
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => navigate(isEdit ? jobDetail(jobId!) : ROUTES.JOBS)}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {isEdit ? "Saving…" : "Creating…"}
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              {isEdit ? "Save changes" : "Create job"}
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
