import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Check,
  Info,
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChipInput } from "@/features/jobs/components/ChipInput";
import {
  ExtraGatesEditor,
  emptyExtraGates,
  validateExtraGates,
  type ExtraGatesValue,
} from "@/features/jobs/components/ExtraGatesEditor";
import { MarkdownEditor } from "@/features/jobs/components/MarkdownEditor";
import {
  ANY_CITY_VALUE,
  OTHER_CITY_VALUE,
  PAKISTAN_CITIES,
  PAKISTAN_CITY_SET,
} from "@/features/jobs/cities";
import { createJob, getJob, updateJob } from "@/features/jobs/jobsApi";
import {
  EMPLOYMENT_TYPE_LABELS,
  SENIORITY_LABELS,
  WORK_MODE_LABELS,
  seniorityExperienceLabel,
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
import { blurOnWheel, cn } from "@/lib/utils";

/**
 * The not-yet-chosen state for the classification Selects. Empty string, so
 * Radix shows the trigger's `placeholder` — there is deliberately no
 * "Not specified" SelectItem to pick, since all three are required (Radix
 * forbids `value=""` on an *item*, but the root reads it as "no selection").
 */
const UNSET = "";

/**
 * Scoring presets as `[correctness, depth, label, hint]`. Communication is
 * always the remainder, so every preset sums to 100 by construction.
 */
const WEIGHT_PRESETS: Array<[number, number, string, string]> = [
  [40, 20, "Balanced", "The default — right answers, some judgment, clear delivery."],
  [60, 10, "Recall-first", "Screening for correct knowledge above all."],
  [30, 40, "Judgment", "Senior roles: trade-offs and lived experience lead."],
  [20, 10, "Communication", "Client-facing roles: how they explain it matters most."],
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
    return <JobFormSkeleton />;
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
  // How far the user has advanced. In CREATE mode the stepper only lets them
  // jump to a step they've already reached (and only forward past a step whose
  // fields still validate) — mirroring the Continue gate. In EDIT mode every
  // step is directly reachable, since the job already has saved values.
  const [maxStep, setMaxStep] = useState(0);

  // ── Basics
  const [title, setTitle] = useState(job?.title ?? "");
  const [titleTouched, setTitleTouched] = useState(false);
  const [description, setDescription] = useState(job?.description ?? "");

  // ── Classification. All three required. A job saved before that rule seeds
  // `UNSET` and has to be classified before it can be saved again.
  const [employmentType, setEmploymentType] = useState<string>(
    job?.employmentType ?? UNSET,
  );
  const [workMode, setWorkMode] = useState<string>(job?.workMode ?? UNSET);
  const [seniorityLevel, setSeniorityLevel] = useState<string>(
    job?.seniorityLevel ?? UNSET,
  );
  const [classificationTouched, setClassificationTouched] = useState(false);

  // ── Scoring. TWO numbers, not three: communication is always the remainder
  // (`100 - correctness - depth`), and `WeightSplitBar` only ever trades
  // between two adjacent axes. So the backend's "must sum to 100" invariant is
  // unviolatable from this form — the same property the old single-slider
  // version had, preserved across the three-axis split.
  const [correctnessWeight, setCorrectnessWeight] = useState(
    job?.scoringWeights.correctness ?? 40,
  );
  const [depthWeight, setDepthWeight] = useState(job?.scoringWeights.depth ?? 20);
  const communicationWeight = 100 - correctnessWeight - depthWeight;

  const setWeights = (correctness: number, depth: number) => {
    setCorrectnessWeight(correctness);
    setDepthWeight(depth);
  };
  const [rejectionThreshold, setRejectionThreshold] = useState(
    job ? String(job.rejectionThreshold) : "70",
  );
  const [maxAttempts, setMaxAttempts] = useState(
    job?.maxAttempts == null ? "" : String(job.maxAttempts),
  );
  // Empty = inherit the org default, exactly like maxAttempts above.
  const [interviewDuration, setInterviewDuration] = useState(
    job?.interviewDurationMinutes == null
      ? ""
      : String(job.interviewDurationMinutes),
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
  const [extraGates, setExtraGates] = useState<ExtraGatesValue>(() => ({
    ...emptyExtraGates(),
    universityEnabled: job?.eligibility.university?.enabled ?? false,
    universityNames: job?.eligibility.university?.names ?? [],
    salaryEnabled: job?.eligibility.expectedSalary?.enabled ?? false,
    salaryMax:
      job?.eligibility.expectedSalary?.maxSalary == null
        ? ""
        : String(job.eligibility.expectedSalary.maxSalary),
  }));

  const { data: organization } = useOrganization();

  // ── validation
  const trimmedTitle = title.trim();
  const titleError =
    titleTouched && trimmedTitle.length === 0 ? "A job title is required." : "";

  // Shown only once the step has been left (or a save attempted), so a fresh
  // form doesn't open pre-scolded — same rule as the title.
  const employmentTypeError =
    classificationTouched && !employmentType ? "Pick an employment type." : "";
  const workModeError =
    classificationTouched && !workMode ? "Pick a work mode." : "";
  const seniorityError =
    classificationTouched && !seniorityLevel ? "Pick a seniority level." : "";

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

  // [2, 120] mirrors the schema bound on both the job and the org setting, so
  // a value that would be clamped server-side is refused here instead.
  const parsedDuration = parseOptionalNumber(interviewDuration);
  const durationError =
    interviewDuration.trim() &&
    (parsedDuration === undefined ||
      !Number.isInteger(parsedDuration) ||
      parsedDuration < 2 ||
      parsedDuration > 120)
      ? "Enter a whole number of minutes between 2 and 120, or leave it empty."
      : "";

  const parsedMinYears = parseOptionalNumber(minYearsExperience);
  const minYearsError =
    minYearsExperience.trim() &&
    (parsedMinYears === undefined || parsedMinYears < 0)
      ? "Enter 0 or more, or leave it empty."
      : "";

  // Per-step validity — Continue is disabled when the current step has
  // outstanding errors. Validity only, NOT touched-ness: the errors above gate
  // when a message is *shown*, this gates whether the step may be left. The
  // accept/reject threshold and vetting-metric checks that used to live here
  // were dropped when main simplified the eligibility schema.
  // Mirrors the server's 422 checks so the wizard blocks the step instead of
  // bouncing the whole save. The server still re-checks.
  const extraGateErrors = useMemo(
    () => validateExtraGates(extraGates),
    [extraGates],
  );

  const stepValid = useMemo(
    () => [
      trimmedTitle.length > 0,
      Boolean(employmentType && workMode && seniorityLevel),
      !rejectionError && !maxAttemptsError && !durationError,
      !minYearsError && extraGateErrors.length === 0,
    ],
    [
      trimmedTitle,
      employmentType,
      workMode,
      seniorityLevel,
      rejectionError,
      maxAttemptsError,
      durationError,
      minYearsError,
      extraGateErrors,
    ],
  );

  /** The earliest step still holding an error, or -1 when all of them pass. */
  const firstInvalidStep = stepValid.findIndex((ok) => !ok);

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
    // Always sent, both halves: eligibility is REPLACE-semantics, so omitting
    // a switched-off gate would leave the previous one enabled on the server.
    eligibility.university = {
      enabled: extraGates.universityEnabled,
      names: extraGates.universityNames,
    };
    eligibility.expectedSalary = {
      enabled: extraGates.salaryEnabled,
      ...(extraGates.salaryMax.trim()
        ? { maxSalary: Number(extraGates.salaryMax.trim()) }
        : {}),
    };
    return eligibility;
  };

  const buildPayload = (): CreateJobPayload => ({
    title: trimmedTitle,
    description: description.trim(),
    // Narrowed, not folded: `stepValid[1]` gates every path that reaches the
    // mutation, so none of these can still be `UNSET` here. There is no null
    // branch any more — the backend rejects a null classification outright.
    employmentType: employmentType as EmploymentType,
    workMode: workMode as WorkMode,
    seniorityLevel: seniorityLevel as SeniorityLevel,
    // ALWAYS sent, and always complete: eligibility is REPLACE-semantics, so
    // an omitted block leaves the old one intact (clearing the last gate would
    // silently no-op) and an omitted sub-field resets to null.
    eligibility: buildEligibility(),
    scoringWeights: {
      correctness: correctnessWeight,
      depth: depthWeight,
      communication: communicationWeight,
    },
    rejectionThreshold: parsedRejection ?? 70,
    // `null` clears the per-job cap so the org default applies again.
    maxAttempts: parsedMaxAttempts ?? null,
    interviewDurationMinutes: parsedDuration ?? null,
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

  // Which steps the stepper allows jumping to right now.
  //  • Edit mode: any step — everything already has a saved value.
  //  • Create mode: the current step or any earlier (already-visited) one, plus
  //    a later step only if it's been reached AND every step in between still
  //    validates, so you can't slip past one you've left unfinished.
  const canVisitStep = (target: number) => {
    if (isEdit) return true;
    if (target <= step) return true;
    if (target > maxStep) return false;
    for (let i = step; i < target; i += 1) {
      if (!stepValid[i]) return false;
    }
    return true;
  };

  // Stepper-header click handler. The button is disabled when a step isn't
  // visitable, so this stays a no-op guard rather than the source of truth.
  const goToStepFromHeader = (target: number) => {
    if (canVisitStep(target)) goToStep(target);
  };

  const isFinalStep = step === STEPS.length - 1;

  const onContinue = () => {
    if (step === 0) setTitleTouched(true);
    if (step === 1) setClassificationTouched(true);
    if (!stepValid[step]) return;
    if (!isFinalStep) {
      goToStep(step + 1);
      return;
    }
    // Final step → submit. Reveal every deferred message first: EDIT mode lets
    // the stepper jump straight here, so whatever is blocking the save may sit
    // on a step that was never opened.
    setTitleTouched(true);
    setClassificationTouched(true);
    if (busy) return;
    if (firstInvalidStep !== -1) {
      // Navigate TO the problem instead of leaving Save inert with no reason
      // given — a job created before classification was required lands here.
      goToStep(firstInvalidStep);
      toast.error("Fill in the highlighted fields before saving.");
      return;
    }
    mutation.mutate();
  };

  // Enter / implicit form submission must NEVER create the job: the mutation
  // fires only from the final step's button click (onClick={onContinue}). A
  // stray Enter on an earlier step still advances the wizard so the flow
  // isn't broken; on the final step it does nothing, so the job is created
  // solely by an explicit click of "Create job".
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!isFinalStep && stepValid[step]) goToStep(step + 1);
  };

  const onBack = () => {
    if (step === 0) {
      navigate(isEdit ? jobDetail(jobId!) : ROUTES.JOBS);
      return;
    }
    setStep(step - 1);
  };

  const subCopy = isEdit
    ? `Step ${step + 1} of ${STEPS.length}, update the posting, its scoring split and its vetting rules.`
    : `Step ${step + 1} of ${STEPS.length}, saved as a draft; add questions and publish next.`;

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
            // Edit mode unlocks every step; create mode only the reached ones.
            const reachable = isEdit || i <= maxStep;
            // Unlocked, but can we actually land there from here right now?
            const visitable = reachable && canVisitStep(i);
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
                        onClick: () => goToStepFromHeader(i),
                        disabled: !visitable,
                      }
                    : {})}
                  className={`flex items-center gap-2.5 border-0 bg-transparent p-0 text-left ${
                    reachable
                      ? visitable
                        ? "cursor-pointer"
                        : "cursor-not-allowed"
                      : "cursor-default"
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
              employmentTypeError={employmentTypeError}
              workMode={workMode}
              setWorkMode={setWorkMode}
              workModeError={workModeError}
              seniorityLevel={seniorityLevel}
              setSeniorityLevel={setSeniorityLevel}
              seniorityError={seniorityError}
            />
          ) : null}

          {step === 2 ? (
            <ScoringStep
              correctnessWeight={correctnessWeight}
              depthWeight={depthWeight}
              communicationWeight={communicationWeight}
              setWeights={setWeights}
              applyPreset={setWeights}
              rejectionThreshold={rejectionThreshold}
              setRejectionThreshold={setRejectionThreshold}
              rejectionError={rejectionError}
              maxAttempts={maxAttempts}
              setMaxAttempts={setMaxAttempts}
              maxAttemptsError={maxAttemptsError}
              defaultAttempts={organization?.settings.maxInterviewAttempts}
              interviewDuration={interviewDuration}
              setInterviewDuration={setInterviewDuration}
              durationError={durationError}
              defaultDuration={organization?.settings.interviewDurationMinutes}
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
              extraGates={extraGates}
              setExtraGates={setExtraGates}
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
              type="button"
              size="sm"
              // Only `busy` — an outstanding error is handled by `onContinue`,
              // which bounces to the offending step and says so. A disabled
              // Save on a step whose own fields all look fine reads as broken.
              disabled={busy}
              onClick={onContinue}
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

/**
 * Loading placeholder shown while an existing job is fetched for editing.
 * Mirrors the real form shell — header row, the four-step stepper, the step
 * card with a couple of label+field rows, and the footer buttons — so the
 * page keeps its shape and doesn't jump when the job data arrives.
 */
function JobFormSkeleton() {
  return (
    <div className="mx-auto max-w-[1080px] px-6 py-6 lg:px-8 lg:py-8">
      {/* Header row */}
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <Skeleton className="h-6 w-40" />
          <Skeleton className="mt-2 h-3.5 w-72 max-w-full" />
        </div>
        <Skeleton className="h-8 w-20 rounded-lg" />
      </div>

      {/* Stepper */}
      <div className="mb-6 flex items-center gap-0">
        {STEPS.map(([t], i) => (
          <div
            key={t}
            className={`flex items-center ${i < STEPS.length - 1 ? "flex-1" : "flex-none"}`}
          >
            <div className="flex items-center gap-2.5">
              <Skeleton className="h-[30px] w-[30px] flex-none rounded-full" />
              <div>
                <Skeleton className="h-3 w-20" />
                <Skeleton className="mt-1.5 h-2.5 w-28" />
              </div>
            </div>
            {i < STEPS.length - 1 ? (
              <span className="mx-3.5 h-[2px] flex-1 rounded-full bg-line-2" />
            ) : null}
          </div>
        ))}
      </div>

      {/* Step card */}
      <div className="rounded-2xl border border-line bg-surface p-6">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="mt-2 h-3.5 w-80 max-w-full" />
        <div className="mt-6 space-y-5">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="mb-1.5 h-3.5 w-28" />
              <Skeleton className="h-11 w-full rounded-lg" />
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="mt-4 flex justify-between gap-2.5">
        <Skeleton className="h-8 w-20 rounded-lg" />
        <Skeleton className="h-8 w-28 rounded-lg" />
      </div>
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
          <MarkdownEditor
            id="job-description"
            label="Description"
            value={description}
            onChange={setDescription}
            maxLength={5000}
            rows={6}
            placeholder="What the role involves…"
          />
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────  Step 1 · Classification  ──────────────────── */

function ClassificationStep({
  employmentType,
  setEmploymentType,
  employmentTypeError,
  workMode,
  setWorkMode,
  workModeError,
  seniorityLevel,
  setSeniorityLevel,
  seniorityError,
}: {
  employmentType: string;
  setEmploymentType: (v: string) => void;
  employmentTypeError: string;
  workMode: string;
  setWorkMode: (v: string) => void;
  workModeError: string;
  seniorityLevel: string;
  setSeniorityLevel: (v: string) => void;
  seniorityError: string;
}) {
  const triggerCls =
    "h-11 rounded-lg border-[var(--field-border)] bg-surface px-3.5 text-[14px]";
  return (
    <div>
      <StepHead
        title="Classification"
        subtitle="All three are required. They label the posting and give the CV pre-screen the role's context."
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="job-employment" className={LABEL_CLASS}>
            Employment type
          </label>
          <Select value={employmentType} onValueChange={setEmploymentType}>
            <SelectTrigger
              id="job-employment"
              aria-invalid={Boolean(employmentTypeError)}
              className={triggerCls}
            >
              <SelectValue placeholder="Select…" />
            </SelectTrigger>
            <SelectContent>
              {EMPLOYMENT_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {EMPLOYMENT_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {employmentTypeError ? (
            <p className={ERROR_CLASS}>{employmentTypeError}</p>
          ) : null}
        </div>
        <div>
          <label htmlFor="job-mode" className={LABEL_CLASS}>
            Work mode
          </label>
          <Select value={workMode} onValueChange={setWorkMode}>
            <SelectTrigger
              id="job-mode"
              aria-invalid={Boolean(workModeError)}
              className={triggerCls}
            >
              <SelectValue placeholder="Select…" />
            </SelectTrigger>
            <SelectContent>
              {WORK_MODES.map((m) => (
                <SelectItem key={m} value={m}>
                  {WORK_MODE_LABELS[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {workModeError ? <p className={ERROR_CLASS}>{workModeError}</p> : null}
        </div>
        <div>
          <div className="mb-1.5 flex items-center gap-1.5">
            <label htmlFor="job-seniority" className={cn(LABEL_CLASS, "mb-0")}>
              Seniority
            </label>
            {/* Provider is local, matching QuestionBankPage — there is no global
                one, and this is the page's only tooltip. */}
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  {/* `type="button"` is load-bearing: this sits inside the
                      wizard's <form>, whose onSubmit advances the step, so a
                      default-type button would move the user on when clicked. */}
                  <button
                    type="button"
                    aria-label="How the experience band is used"
                    className="inline-flex h-4 w-4 items-center justify-center rounded-full text-ink-subtle transition-colors hover:text-ink focus-visible:text-ink focus-visible:outline-none"
                  >
                    <Info className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  The band next to each level is sent to the AI too. When it
                  rates a candidate, their experience is scored against this
                  range, so the level you pick changes the scoring, not just
                  the label on the posting.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <Select value={seniorityLevel} onValueChange={setSeniorityLevel}>
            <SelectTrigger
              id="job-seniority"
              aria-invalid={Boolean(seniorityError)}
              className={triggerCls}
            >
              <SelectValue placeholder="Select…" />
            </SelectTrigger>
            <SelectContent>
              {SENIORITY_LEVELS.map((s) => (
                // The band rides along inside `ItemText`, so the closed trigger
                // shows it too — the number is the part that decides how the
                // pre-screen rates a CV, so it shouldn't only be visible while
                // the list happens to be open.
                <SelectItem key={s} value={s}>
                  {SENIORITY_LABELS[s]}
                  <span className="ml-2 font-normal text-ink-muted">
                    {seniorityExperienceLabel(s)}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {seniorityError ? (
            <p className={ERROR_CLASS}>{seniorityError}</p>
          ) : (
            // Mutually exclusive with the error: one shows only when unset, the
            // other only when set.
            <p className={HELP_CLASS}>
              {seniorityLevel
                ? `Expecting ${seniorityExperienceLabel(
                    seniorityLevel as SeniorityLevel,
                  )} of relevant experience.`
                : "Sets the experience band the CV pre-screen rates against."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────  Step 2 · Scoring  ───────────────────────── */

/**
 * The three axes share ONE hue at three intensities rather than three
 * different colours. They are parts of a single score, not unrelated
 * categories, and a monochrome ramp says that. It is also the only
 * theme-safe option here: `--primary` is redefined for dark mode, whereas the
 * `--stage-*` palette is not, so saturated hues would misfire on dark.
 */
const AXIS_FILL = [
  "var(--primary)",
  "color-mix(in oklab, var(--primary) 62%, var(--surface))",
  "color-mix(in oklab, var(--primary) 28%, var(--surface))",
] as const;

/**
 * The score split as ONE bar with two draggable dividers.
 *
 * Three numbers that must total 100 are a COMPOSITION, and the previous
 * two-independent-sliders-plus-a-leftover layout hid that: you could not see
 * the split at a glance, communication looked like a different kind of thing
 * than its two peers, and dragging one slider silently shoved another down
 * with no visual warning.
 *
 * Here the constraint is STRUCTURAL — a divider only ever trades between its
 * two neighbours, so the total is 100 by construction and an invalid payload
 * is unrepresentable. Handle 1 sits at `correctness`, handle 2 at
 * `correctness + depth`; communication is whatever is left.
 */
function WeightSplitBar({
  correctness,
  depth,
  onChange,
}: {
  correctness: number;
  depth: number;
  onChange: (correctness: number, depth: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<1 | 2 | null>(null);

  const communication = 100 - correctness - depth;
  const positions = [correctness, correctness + depth];

  /** Move one divider, trading only against its immediate neighbour. */
  const moveHandle = (which: 1 | 2, raw: number) => {
    const v = Math.min(100, Math.max(0, Math.round(raw)));
    if (which === 1) {
      // Handle 2 holds still, so communication is untouched.
      const upper = correctness + depth;
      const next = Math.min(v, upper);
      onChange(next, upper - next);
    } else {
      // Handle 1 holds still, so correctness is untouched.
      const next = Math.max(v, correctness);
      onChange(correctness, next - correctness);
    }
  };

  const pctFromClientX = (clientX: number): number | null => {
    const el = trackRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) return null;
    return ((clientX - rect.left) / rect.width) * 100;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    const pct = pctFromClientX(e.clientX);
    if (pct !== null) moveHandle(dragging, pct);
  };

  const startDrag = (which: 1 | 2) => (e: React.PointerEvent) => {
    e.preventDefault();
    // Without this the track's own handler also fires and snaps the divider to
    // the click point — a visible jolt when you grab a handle slightly off-centre.
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(which);
  };

  const endDrag = () => setDragging(null);

  /** Click anywhere on the track to send the NEAREST divider there. */
  const onTrackPointerDown = (e: React.PointerEvent) => {
    const pct = pctFromClientX(e.clientX);
    if (pct === null) return;
    const nearest =
      Math.abs(pct - positions[0]) <= Math.abs(pct - positions[1]) ? 1 : 2;
    moveHandle(nearest, pct);
  };

  const onHandleKeyDown = (which: 1 | 2) => (e: React.KeyboardEvent) => {
    const current = positions[which - 1];
    const step = e.shiftKey ? 5 : 1;
    let next: number | null = null;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = current - step;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = current + step;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = 100;
    if (next === null) return;
    e.preventDefault();
    moveHandle(which, next);
  };

  const segments = [
    { label: "Correctness", value: correctness },
    { label: "Depth", value: depth },
    { label: "Communication", value: communication },
  ];

  return (
    <div
      className="select-none"
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div
        ref={trackRef}
        onPointerDown={onTrackPointerDown}
        className="relative h-11 w-full cursor-pointer overflow-hidden rounded-lg border border-line-2 bg-surface"
      >
        {segments.map((seg, i) => (
          <div
            key={seg.label}
            // Animate preset jumps, but NEVER while dragging — a transition
            // there makes the fill lag the cursor and feel soggy.
            className={`absolute inset-y-0 flex items-center justify-center ${
              dragging ? "" : "transition-[left,width] duration-150 ease-out"
            }`}
            style={{
              left: `${i === 0 ? 0 : positions[i - 1]}%`,
              width: `${seg.value}%`,
              background: AXIS_FILL[i],
            }}
          >
            {/* The inline number is the fast read while dragging, but it
                cannot fit in a narrow segment — below ~9% it would clip or
                overflow onto its neighbour, so the legend carries it. */}
            {seg.value >= 9 && (
              <span
                className="text-[12px] font-semibold tabular-nums"
                // Segment 3 is only 28% primary over the surface, so it stays
                // light in both themes and needs ink, not primary-foreground.
                style={{
                  color: i === 2 ? "var(--ink)" : "var(--primary-foreground)",
                }}
              >
                {seg.value}%
              </span>
            )}
          </div>
        ))}

        {([1, 2] as const).map((which) => (
          <div
            key={which}
            role="slider"
            tabIndex={0}
            aria-label={
              which === 1
                ? "Correctness / Depth divider"
                : "Depth / Communication divider"
            }
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={positions[which - 1]}
            aria-valuetext={
              which === 1
                ? `Correctness ${correctness}%, Depth ${depth}%`
                : `Depth ${depth}%, Communication ${communication}%`
            }
            onPointerDown={startDrag(which)}
            onKeyDown={onHandleKeyDown(which)}
            // w-5 is a deliberate ~20px hit target on a 3px visual: the grip
            // has to be grabbable without pixel-hunting, especially on a
            // trackpad. The `group` drives the hover affordance below.
            className={`group absolute inset-y-0 z-10 flex w-5 -translate-x-1/2 cursor-col-resize items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${
              dragging && dragging !== which ? "pointer-events-none" : ""
            }`}
            style={{ left: `${positions[which - 1]}%` }}
          >
            <span
              // Ringed rather than bare: the second divider sits against the
              // palest segment, where an unringed grip nearly disappears.
              className={`w-[3px] rounded-full bg-[var(--surface)] ring-1 ring-[var(--border)] transition-all group-hover:h-7 group-hover:w-[4px] ${
                dragging === which ? "h-7 w-[4px]" : "h-6"
              }`}
            />
          </div>
        ))}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {[
          {
            label: "Correctness",
            value: correctness,
            hint: "Did they answer the question asked and land the expected point?",
          },
          {
            label: "Depth",
            value: depth,
            hint: "Have they lived it — trade-offs, real-world specifics, judgment?",
          },
          {
            label: "Communication",
            value: communication,
            hint: "Structure, clarity, concision and spoken fluency.",
          },
        ].map((axis, i) => (
          <div key={axis.label} className="flex gap-2">
            <span
              aria-hidden
              className="mt-[5px] h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: AXIS_FILL[i] }}
            />
            <div className="flex flex-col">
              <span className="text-[12.5px] font-semibold text-ink tabular-nums">
                {axis.label} {axis.value}%
              </span>
              <span className="text-[11.5px] leading-snug text-ink-2">
                {axis.hint}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScoringStep({
  correctnessWeight,
  depthWeight,
  communicationWeight,
  setWeights,
  applyPreset,
  rejectionThreshold,
  setRejectionThreshold,
  rejectionError,
  maxAttempts,
  setMaxAttempts,
  maxAttemptsError,
  defaultAttempts,
  interviewDuration,
  setInterviewDuration,
  durationError,
  defaultDuration,
}: {
  correctnessWeight: number;
  depthWeight: number;
  communicationWeight: number;
  setWeights: (correctness: number, depth: number) => void;
  applyPreset: (correctness: number, depth: number) => void;
  rejectionThreshold: string;
  setRejectionThreshold: (v: string) => void;
  rejectionError: string;
  maxAttempts: string;
  setMaxAttempts: (v: string) => void;
  maxAttemptsError: string;
  defaultAttempts: number | undefined;
  interviewDuration: string;
  setInterviewDuration: (v: string) => void;
  durationError: string;
  defaultDuration: number | undefined;
}) {
  return (
    <div>
      <StepHead
        title="Scoring"
        subtitle="How the interview's three axes fold into one overall score, and where the shortlist line sits."
      />
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold text-ink">
            Score split
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {WEIGHT_PRESETS.map(([correctness, depth, label, hint]) => {
              const active =
                correctnessWeight === correctness && depthWeight === depth;
              return (
                <button
                  key={label}
                  type="button"
                  title={hint}
                  onClick={() => applyPreset(correctness, depth)}
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

        <WeightSplitBar
          correctness={correctnessWeight}
          depth={depthWeight}
          onChange={setWeights}
        />

        {communicationWeight === 0 && (
          <p className="rounded-md border border-line-2 bg-hover px-3 py-2 text-[11.5px] leading-relaxed text-ink-2">
            <strong className="font-semibold text-ink">
              Communication is weighted 0%.
            </strong>{" "}
            Spoken clarity won&apos;t affect the score — but answers are still
            graded from a speech-to-text transcript, so a candidate who is hard
            to understand will produce a poorer transcript and a less reliable
            correctness score. It is still shown to reviewers, just not counted.
          </p>
        )}
        {correctnessWeight === 0 && (
          <p className="rounded-md border border-line-2 bg-hover px-3 py-2 text-[11.5px] leading-relaxed text-ink-2">
            <strong className="font-semibold text-ink">
              Correctness is weighted 0%.
            </strong>{" "}
            A confidently wrong answer can still score well on depth and
            delivery. Only use this for rounds where being right isn&apos;t what
            you&apos;re screening for.
          </p>
        )}

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
              onWheel={blurOnWheel}
              onChange={(e) => setRejectionThreshold(e.target.value)}
              className={FIELD_CLASS}
            />
            {rejectionError ? (
              <p className={ERROR_CLASS}>{rejectionError}</p>
            ) : (
              <p className={HELP_CLASS}>
                At or above this (0 to 100) shortlists the candidate; below it
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
              onWheel={blurOnWheel}
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
          <div>
            <label htmlFor="job-duration" className={LABEL_CLASS}>
              Interview length (minutes)
            </label>
            <input
              id="job-duration"
              type="number"
              min={2}
              max={120}
              value={interviewDuration}
              aria-invalid={Boolean(durationError)}
              onWheel={blurOnWheel}
              onChange={(e) => setInterviewDuration(e.target.value)}
              placeholder={defaultDuration ? String(defaultDuration) : ""}
              className={FIELD_CLASS}
            />
            {durationError ? (
              <p className={ERROR_CLASS}>{durationError}</p>
            ) : (
              <p className={HELP_CLASS}>
                How long candidates get, counted down on their screen. Set it to
                suit this job&apos;s question list. Leave empty to inherit your
                org default
                {defaultDuration ? ` (${defaultDuration})` : ""}. Changing it
                only affects invites sent from now on.
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
  extraGates,
  setExtraGates,
}: {
  city: string;
  setCity: (v: string) => void;
  minYearsExperience: string;
  setMinYearsExperience: (v: string) => void;
  minYearsError: string;
  requiredSkills: string[];
  setRequiredSkills: (v: string[]) => void;
  extraGates: ExtraGatesValue;
  setExtraGates: (v: ExtraGatesValue) => void;
}) {
  // City is picked from a fixed list (shared with /apply so a job's required
  // city and an applicant's stored city are drawn from one vocabulary), with
  // an "Other" escape hatch that reveals a free-text box, and an "Any city"
  // choice for jobs with no city gate. The form value stays a plain `city`
  // string either way. `isOther` is seeded from the incoming value so an edit
  // that carries a custom city (one not on the list) re-opens the text input;
  // this step remounts on every visit, so the seed re-runs each time.
  const [isOther, setIsOther] = useState<boolean>(() => {
    const v = city.trim();
    return v.length > 0 && !PAKISTAN_CITY_SET.has(v);
  });
  const otherCityRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (isOther) otherCityRef.current?.focus();
  }, [isOther]);

  // Radix Select forbids empty values, so "Any city" carries its own
  // sentinel; a listed city selects itself; a custom one shows as "Other".
  const citySelectValue = isOther
    ? OTHER_CITY_VALUE
    : PAKISTAN_CITY_SET.has(city)
      ? city
      : ANY_CITY_VALUE;

  const handleCityChange = (selected: string) => {
    if (selected === OTHER_CITY_VALUE) {
      // Switch to free text and clear the value so the user types a city.
      setIsOther(true);
      setCity("");
      return;
    }
    setIsOther(false);
    setCity(selected === ANY_CITY_VALUE ? "" : selected);
  };

  const cityTriggerCls =
    "h-11 rounded-lg border-[var(--field-border)] bg-surface px-3.5 text-[14px]";

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
            <Select value={citySelectValue} onValueChange={handleCityChange}>
              <SelectTrigger id="job-city" className={cityTriggerCls}>
                <SelectValue placeholder="Any city" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value={ANY_CITY_VALUE}>
                  Any city (no requirement)
                </SelectItem>
                {PAKISTAN_CITIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
                <SelectItem value={OTHER_CITY_VALUE}>
                  Other (not listed)
                </SelectItem>
              </SelectContent>
            </Select>
            {isOther ? (
              <input
                ref={otherCityRef}
                type="text"
                value={city}
                maxLength={120}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Enter the required city"
                aria-label="Enter the required city"
                className={`${FIELD_CLASS} mt-2`}
              />
            ) : null}
            <p className={HELP_CLASS}>
              A hard gate, pick “Any city” for no city requirement.
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
              onWheel={blurOnWheel}
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
            A hard gate: the AI checks the CV for every skill listed. Any
            spelling counts (Node = NodeJS = Node.js). A skill it finds no
            evidence of rejects the candidate; an unsure call goes to review
            instead.
          </p>
        </div>

        <div className="border-t border-[var(--field-border)] pt-4">
          <label className={LABEL_CLASS}>Extra checks</label>
          <p className="mb-3 text-[12px] text-ink-muted">
            Two optional checks, off unless you switch them on. Each says where
            its answer comes from, so there is nothing to configure beyond the
            values themselves.
          </p>
          <ExtraGatesEditor value={extraGates} onChange={setExtraGates} />
        </div>
      </div>
    </div>
  );
}
