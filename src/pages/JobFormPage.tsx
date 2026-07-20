import { useMemo, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Check,
  Loader2,
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
  type WorkMode,
} from "@/features/jobs/types";
import { useOrganization } from "@/features/organization/useOrganization";
import { ROUTES, jobDetail } from "@/routes";
import { errorMessage } from "@/lib/errors";

/** Sentinel for the "Not specified" option (Radix Select forbids empty values). */
const NONE = "none";

/** The scoring split presets, as `technical` percentages. */
const WEIGHT_PRESETS: Array<[number, string]> = [
  [60, "60/40"],
  [50, "50/50"],
  [70, "70/30"],
];

const EMPLOYMENT_TYPES = Object.keys(
  EMPLOYMENT_TYPE_LABELS,
) as EmploymentType[];
const WORK_MODES = Object.keys(WORK_MODE_LABELS) as WorkMode[];
const SENIORITY_LEVELS = Object.keys(SENIORITY_LABELS) as SeniorityLevel[];

const STEPS: Array<[string, string]> = [
  ["Basics", "Role title & description"],
  ["Classification", "Type, mode & seniority"],
  ["Scoring", "Split & shortlist line"],
  ["Eligibility & vetting", "Pre-screen gates"],
];

/** Parse a numeric field that is allowed to be blank. */
const parseOptionalNumber = (raw: string): number | undefined => {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
};

/** The design's shared field input style. */
const FIELD_CLASS =
  "h-11 w-full rounded-lg border border-[var(--field-border)] bg-surface px-3.5 text-[14px] text-ink outline-none placeholder:text-ink-subtle focus:border-primary focus:shadow-[0_0_0_3px_var(--accent-ring)]";

const LABEL_CLASS = "text-[13px] font-semibold text-ink mb-1.5 block";
const HELP_CLASS = "mt-1.5 text-[12px] text-ink-muted";
const ERROR_CLASS = "mt-1.5 text-[12px] text-[var(--danger)]";

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
      <div className="mx-auto max-w-[1080px] px-6 py-6 lg:px-8 lg:py-8">
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-line bg-surface py-24 text-[13.5px] text-ink-muted">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          Loading job…
        </div>
      </div>
    );
  }

  if (isEdit && jobQuery.isError) {
    return (
      <div className="mx-auto max-w-[1080px] px-6 py-6 lg:px-8 lg:py-8">
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-line bg-surface py-16 text-center">
          <p className="text-[13.5px] text-[var(--danger)]">
            {errorMessage(jobQuery.error, "Could not load this job.")}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => jobQuery.refetch()}
          >
            Retry
          </Button>
        </div>
      </div>
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


  // ── wizard cursor
  const [step, setStep] = useState(0);
  // Only steps the user has committed to leaving become "reachable" via the
  // stepper. Currently we let them jump anywhere at or below the furthest
  // step they've advanced to.
  const [maxStep, setMaxStep] = useState(0);

  // ── Basics
  const [title, setTitle] = useState(job?.title ?? "");
  const [titleTouched, setTitleTouched] = useState(false);
  const [description, setDescription] = useState(job?.description ?? "");

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
    job?.eligibility.requiredSkills ?? [],
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

  // Per-step validity — Continue is disabled when the current step has
  // outstanding errors. Classification has no rules at all. The accept/
  // reject threshold and vetting-metric checks that used to live here were
  // dropped when main simplified the eligibility schema.
  const stepValid = useMemo(
    () => [
      trimmedTitle.length > 0,
      true,
      !rejectionError && !maxAttemptsError,
      !minYearsError,
    ],
    [trimmedTitle, rejectionError, maxAttemptsError, minYearsError],
  );

  const hasErrors = stepValid.some((ok) => !ok);

  // ── payload
  const buildEligibility = (): JobEligibilityPayload => {
    const eligibility: JobEligibilityPayload = {};
    if (city.trim()) eligibility.city = city.trim();
    if (parsedMinYears !== undefined) {
      eligibility.minYearsExperience = parsedMinYears;
    }
    if (requiredSkills.length > 0) {
      eligibility.requiredSkills = requiredSkills;
    }
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

  const goToStep = (next: number) => {
    if (next < 0 || next >= STEPS.length) return;
    setStep(next);
    setMaxStep((prev) => Math.max(prev, next));
  };

  const isFinalStep = step === STEPS.length - 1;

  const onContinue = () => {
    if (step === 0) setTitleTouched(true);
    if (!stepValid[step]) return;
    if (!isFinalStep) {
      goToStep(step + 1);
      return;
    }
    // Final step → submit.
    setTitleTouched(true);
    if (hasErrors || busy) return;
    mutation.mutate();
  };

  // Any submit attempt from a non-final step falls back to "advance"; only the
  // final step's explicit type="submit" button can reach the mutation.
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!isFinalStep) {
      if (stepValid[step]) goToStep(step + 1);
      return;
    }
    onContinue();
  };

  const onBack = () => {
    if (step === 0) {
      navigate(isEdit ? jobDetail(jobId!) : ROUTES.JOBS);
      return;
    }
    setStep(step - 1);
  };

  const subCopy = isEdit
    ? `Step ${step + 1} of ${STEPS.length} — update the posting, its scoring split and its vetting rules.`
    : `Step ${step + 1} of ${STEPS.length} — saved as a draft; add questions and publish next.`;

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-6 lg:px-8 lg:py-8">
      <form onSubmit={onSubmit}>
        {/* Header row */}
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="text-primary inline-flex">
                <Briefcase className="h-[18px] w-[18px]" strokeWidth={1.7} />
              </span>
              <h1 className="text-[23px] font-semibold tracking-tight text-ink">
                {isEdit ? "Edit job" : "Create job"}
              </h1>
            </div>
            <p className="mt-1.5 text-[13.5px] text-ink-muted">{subCopy}</p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => navigate(isEdit ? jobDetail(jobId!) : ROUTES.JOBS)}
          >
            Cancel
          </Button>
        </div>

        {/* Stepper */}
        <div className="mb-6 flex items-center gap-0">
          {STEPS.map(([t, sub], i) => {
            const done = i < step;
            const cur = i === step;
            const reachable = i <= maxStep;
            const CircleTag = reachable ? "button" : "div";
            return (
              <div
                key={t}
                className={`flex items-center ${i < STEPS.length - 1 ? "flex-1" : "flex-none"}`}
              >
                <CircleTag
                  {...(reachable
                    ? {
                        type: "button" as const,
                        onClick: () => setStep(i),
                      }
                    : {})}
                  className={`flex items-center gap-2.5 border-0 bg-transparent p-0 text-left ${
                    reachable ? "cursor-pointer" : "cursor-default"
                  }`}
                >
                  <span
                    className={`flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full text-[13px] font-bold ${
                      done
                        ? "bg-[var(--success-soft)] text-[var(--success)]"
                        : cur
                          ? "bg-primary text-white ring-4 ring-accent"
                          : "bg-surface-3 text-ink-subtle"
                    }`}
                  >
                    {done ? (
                      <Check className="h-4 w-4" strokeWidth={2.2} />
                    ) : (
                      i + 1
                    )}
                  </span>
                  <span className="leading-[1.15]">
                    <span
                      className={`block text-[13px] font-semibold ${
                        done || cur ? "text-ink" : "text-ink-muted"
                      }`}
                    >
                      {t}
                    </span>
                    <span className="block text-[11px] text-ink-subtle">
                      {sub}
                    </span>
                  </span>
                </CircleTag>
                {i < STEPS.length - 1 ? (
                  <span
                    className={`mx-3.5 h-[2px] flex-1 rounded-full ${
                      done ? "bg-[var(--success)]" : "bg-line-2"
                    }`}
                  />
                ) : null}
              </div>
            );
          })}
        </div>

        {/* Step card */}
        <div className="rounded-2xl border border-line bg-surface p-6">
          {step === 0 ? (
            <BasicsStep
              title={title}
              titleError={titleError}
              setTitle={setTitle}
              onTitleBlur={() => setTitleTouched(true)}
              description={description}
              setDescription={setDescription}
            />
          ) : null}

          {step === 1 ? (
            <ClassificationStep
              employmentType={employmentType}
              setEmploymentType={setEmploymentType}
              workMode={workMode}
              setWorkMode={setWorkMode}
              seniorityLevel={seniorityLevel}
              setSeniorityLevel={setSeniorityLevel}
            />
          ) : null}

          {step === 2 ? (
            <ScoringStep
              technicalWeight={technicalWeight}
              setTechnicalWeight={setTechnicalWeight}
              rejectionThreshold={rejectionThreshold}
              setRejectionThreshold={setRejectionThreshold}
              rejectionError={rejectionError}
              maxAttempts={maxAttempts}
              setMaxAttempts={setMaxAttempts}
              maxAttemptsError={maxAttemptsError}
              defaultAttempts={organization?.settings.maxInterviewAttempts}
            />
          ) : null}

          {step === 3 ? (
            <EligibilityStep
              city={city}
              setCity={setCity}
              minYearsExperience={minYearsExperience}
              setMinYearsExperience={setMinYearsExperience}
              minYearsError={minYearsError}
              requiredSkills={requiredSkills}
              setRequiredSkills={setRequiredSkills}
            />
          ) : null}
        </div>

        {/* Footer */}
        <div className="mt-4 flex justify-between gap-2.5">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={onBack}
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button
              type="button"
              size="sm"
              disabled={!stepValid[step] || busy}
              onClick={onContinue}
            >
              Continue
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="sm"
              disabled={hasErrors || busy}
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {isEdit ? "Saving…" : "Creating…"}
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" strokeWidth={2.2} />
                  {isEdit ? "Save changes" : "Create job"}
                </>
              )}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

/* ─────────────────────────  Step 0 · Basics  ───────────────────────── */

function StepHead({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-[18px]">
      <h2 className="m-0 text-[16px] font-semibold text-ink">{title}</h2>
      <p className="mt-1 text-[13px] text-ink-muted">{subtitle}</p>
    </div>
  );
}

function BasicsStep({
  title,
  titleError,
  setTitle,
  onTitleBlur,
  description,
  setDescription,
}: {
  title: string;
  titleError: string;
  setTitle: (v: string) => void;
  onTitleBlur: () => void;
  description: string;
  setDescription: (v: string) => void;
}) {
  return (
    <div>
      <StepHead
        title="Basics"
        subtitle="What the role is called and what it involves."
      />
      <div className="grid gap-4">
        <div>
          <label htmlFor="job-title" className={LABEL_CLASS}>
            Title
          </label>
          <input
            id="job-title"
            value={title}
            maxLength={200}
            autoFocus
            aria-invalid={Boolean(titleError)}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={onTitleBlur}
            placeholder="e.g. Senior Frontend Engineer"
            className={FIELD_CLASS}
          />
          {titleError ? <p className={ERROR_CLASS}>{titleError}</p> : null}
        </div>
        <div>
          <label htmlFor="job-description" className={LABEL_CLASS}>
            Description
          </label>
          <textarea
            id="job-description"
            value={description}
            maxLength={5000}
            rows={6}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What the role involves…"
            className="w-full resize-y rounded-lg border border-[var(--field-border)] bg-surface p-3.5 text-[14px] text-ink outline-none placeholder:text-ink-subtle focus:border-primary focus:shadow-[0_0_0_3px_var(--accent-ring)]"
          />
          <p className={HELP_CLASS}>
            Markdown supported. Max 5000 characters. {description.length}/5000
          </p>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────  Step 1 · Classification  ──────────────────── */

function ClassificationStep({
  employmentType,
  setEmploymentType,
  workMode,
  setWorkMode,
  seniorityLevel,
  setSeniorityLevel,
}: {
  employmentType: string;
  setEmploymentType: (v: string) => void;
  workMode: string;
  setWorkMode: (v: string) => void;
  seniorityLevel: string;
  setSeniorityLevel: (v: string) => void;
}) {
  const triggerCls =
    "h-11 rounded-lg border-[var(--field-border)] bg-surface px-3.5 text-[14px]";
  return (
    <div>
      <StepHead
        title="Classification"
        subtitle="Optional labels for the posting. Leave any of them unspecified."
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="job-employment" className={LABEL_CLASS}>
            Employment type
          </label>
          <Select value={employmentType} onValueChange={setEmploymentType}>
            <SelectTrigger id="job-employment" className={triggerCls}>
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
        <div>
          <label htmlFor="job-mode" className={LABEL_CLASS}>
            Work mode
          </label>
          <Select value={workMode} onValueChange={setWorkMode}>
            <SelectTrigger id="job-mode" className={triggerCls}>
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
        <div>
          <label htmlFor="job-seniority" className={LABEL_CLASS}>
            Seniority
          </label>
          <Select value={seniorityLevel} onValueChange={setSeniorityLevel}>
            <SelectTrigger id="job-seniority" className={triggerCls}>
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
      </div>
    </div>
  );
}

/* ───────────────────────  Step 2 · Scoring  ───────────────────────── */

function ScoringStep({
  technicalWeight,
  setTechnicalWeight,
  rejectionThreshold,
  setRejectionThreshold,
  rejectionError,
  maxAttempts,
  setMaxAttempts,
  maxAttemptsError,
  defaultAttempts,
}: {
  technicalWeight: number;
  setTechnicalWeight: (n: number) => void;
  rejectionThreshold: string;
  setRejectionThreshold: (v: string) => void;
  rejectionError: string;
  maxAttempts: string;
  setMaxAttempts: (v: string) => void;
  maxAttemptsError: string;
  defaultAttempts: number | undefined;
}) {
  return (
    <div>
      <StepHead
        title="Scoring"
        subtitle="How the interview's two axes fold into one overall score, and where the shortlist line sits."
      />
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold text-ink">
            Score split
          </span>
          <div className="flex items-center gap-1.5">
            {WEIGHT_PRESETS.map(([pct, label]) => {
              const active = technicalWeight === pct;
              return (
                <button
                  key={pct}
                  type="button"
                  onClick={() => setTechnicalWeight(pct)}
                  className={`rounded-md border px-2.5 py-1 text-[12px] font-semibold transition-colors ${
                    active
                      ? "border-primary bg-accent text-primary"
                      : "border-line-2 bg-surface text-ink-2 hover:bg-hover"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        <input
          id="job-weights"
          type="range"
          min={30}
          max={70}
          step={5}
          value={technicalWeight}
          onChange={(e) => setTechnicalWeight(Number(e.target.value))}
          className="w-full"
          style={{ accentColor: "var(--primary)" }}
        />
        <div className="flex items-center justify-between text-[12.5px] font-semibold text-ink-2">
          <span>Technical {technicalWeight}%</span>
          <span>Communication {100 - technicalWeight}%</span>
        </div>

        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="job-rejection" className={LABEL_CLASS}>
              Shortlist threshold
            </label>
            <input
              id="job-rejection"
              type="number"
              min={0}
              max={100}
              value={rejectionThreshold}
              aria-invalid={Boolean(rejectionError)}
              onChange={(e) => setRejectionThreshold(e.target.value)}
              className={FIELD_CLASS}
            />
            {rejectionError ? (
              <p className={ERROR_CLASS}>{rejectionError}</p>
            ) : (
              <p className={HELP_CLASS}>
                At or above this (0–100) shortlists the candidate; below it
                rejects them.
              </p>
            )}
          </div>
          <div>
            <label htmlFor="job-max-attempts" className={LABEL_CLASS}>
              Interview attempts
            </label>
            <input
              id="job-max-attempts"
              type="number"
              min={1}
              value={maxAttempts}
              aria-invalid={Boolean(maxAttemptsError)}
              onChange={(e) => setMaxAttempts(e.target.value)}
              placeholder={defaultAttempts ? String(defaultAttempts) : ""}
              className={FIELD_CLASS}
            />
            {maxAttemptsError ? (
              <p className={ERROR_CLASS}>{maxAttemptsError}</p>
            ) : (
              <p className={HELP_CLASS}>
                Leave empty to inherit your org default
                {defaultAttempts ? ` (${defaultAttempts})` : ""}.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────  Step 3 · Eligibility & vetting  ───────────────── */

function EligibilityStep({
  city,
  setCity,
  minYearsExperience,
  setMinYearsExperience,
  minYearsError,
  requiredSkills,
  setRequiredSkills,
}: {
  city: string;
  setCity: (v: string) => void;
  minYearsExperience: string;
  setMinYearsExperience: (v: string) => void;
  minYearsError: string;
  requiredSkills: string[];
  setRequiredSkills: (v: string[]) => void;
}) {
  return (
    <div>
      <StepHead
        title="Eligibility & vetting"
        subtitle="The gates the CV pre-screen runs before anyone is invited to interview."
      />
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="job-city" className={LABEL_CLASS}>
              City
            </label>
            <input
              id="job-city"
              value={city}
              maxLength={120}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Any city"
              className={FIELD_CLASS}
            />
            <p className={HELP_CLASS}>
              A hard gate — leave empty for no city requirement.
            </p>
          </div>
          <div>
            <label htmlFor="job-min-years" className={LABEL_CLASS}>
              Minimum years of experience
            </label>
            <input
              id="job-min-years"
              type="number"
              min={0}
              value={minYearsExperience}
              aria-invalid={Boolean(minYearsError)}
              onChange={(e) => setMinYearsExperience(e.target.value)}
              placeholder="No minimum"
              className={FIELD_CLASS}
            />
            {minYearsError ? (
              <p className={ERROR_CLASS}>{minYearsError}</p>
            ) : (
              <p className={HELP_CLASS}>
                A hard gate, counted from the CV&apos;s work history.
              </p>
            )}
          </div>
        </div>

        <div>
          <label htmlFor="job-skills" className={LABEL_CLASS}>
            Required skills
          </label>
          <ChipInput
            id="job-skills"
            values={requiredSkills}
            onChange={setRequiredSkills}
            placeholder="Type a skill and press Enter"
          />
          <p className={HELP_CLASS}>
            A hard gate: every skill listed must appear in the CV, or the
            candidate is rejected before any scoring happens.
          </p>
        </div>
      </div>
    </div>
  );
}
