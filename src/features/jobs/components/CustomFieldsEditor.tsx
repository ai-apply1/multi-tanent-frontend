import { FileText, Loader2, Plus, Trash2, UserRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ChipInput } from "@/features/jobs/components/ChipInput"
import { classifyCustomField } from "@/features/jobs/jobsApi"
import {
  CV_READABLE_TYPES,
  OPERATORS_BY_TYPE,
  TYPE_LABELS,
  emptyDraft,
  isGateable,
  typeOptionsFor,
  type CustomFieldDraft,
} from "@/features/jobs/customFieldDraft"
import type {
  CustomFieldOperator,
  CustomFieldSource,
  CustomFieldType,
} from "@/features/jobs/types"
import { blurOnWheel } from "@/lib/utils"

/** Matches the backend's `@ArrayMaxSize(10)` on `eligibility.customFields`. */
const MAX_FIELDS = 10

const FIELD_CLASS =
  "h-10 w-full rounded-lg border border-[var(--field-border)] bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink-subtle focus:border-primary focus:shadow-[0_0_0_3px_var(--accent-ring)]"

const TRIGGER_CLASS =
  "h-10 rounded-lg border-[var(--field-border)] bg-surface px-3 text-[14px]"

/** The gate picker's three outcomes. "none" is the Radix-safe null. */
const GATE_CHOICES = [
  { value: "none", label: "Do not check this" },
  { value: "reject", label: "Reject if" },
  { value: "review", label: "Flag for review if" },
] as const

const FALLBACK_REASON: Record<CustomFieldSource, string> = {
  applicant: "Candidates will be asked this on the application form.",
  resume: "We will read this from the CV.",
}

/**
 * The type half of a source change, for whichever way the source moved.
 *
 * A new field starts as free text, so the COMMON path here is not an HR
 * override at all: type a label, blur, and the classifier moves the field to
 * the CV, where free text is not a legal answer. Leaving that as a validation
 * error made every CV field start life broken and asked the recruiter to fix a
 * combination the system had just chosen for them. So it converts instead.
 *
 * Two things are deliberately preserved rather than reset:
 *   - `options` and the numeric operands stay in the draft, untouched, so
 *     flipping back to the candidate restores a choice list with its answers
 *     still in it. They are only serialised for the type that uses them.
 *   - `onFail` survives, because "reject" vs "review" is the recruiter's
 *     INTENT and still applies. Only `operator` is re-seeded, since a `less
 *     than` means nothing to a yes/no.
 *
 * Returns an empty patch when the type is already legal, so a flip between two
 * compatible fields changes nothing but the source.
 */
const retypeForSource = (
  draft: CustomFieldDraft,
  source: CustomFieldSource,
): Partial<CustomFieldDraft> => {
  if (source !== "resume" || CV_READABLE_TYPES.includes(draft.type)) return {}
  return {
    type: "boolean",
    operator: draft.onFail ? OPERATORS_BY_TYPE.boolean[0].value : null,
    ruleOptions: [],
  }
}

interface Props {
  drafts: CustomFieldDraft[]
  onChange: (drafts: CustomFieldDraft[]) => void
}

/**
 * The custom-eligibility-field editor on the job wizard's last step.
 *
 * The design rule here is that HR is never asked WHERE an answer comes from.
 * They type a label; the backend classifies it on blur; the row states the
 * decision in one sentence with a single link to flip it. Flipping pins the
 * field so no later classification can walk the choice back.
 *
 * Everything else is one row that reads as a sentence: label, type, the source
 * line, and one optional condition. Free-text fields hide the condition row
 * entirely rather than disabling it, because a text gate could only ever be
 * string matching, which is what the required-skills gate was rewritten to
 * stop doing.
 */
export function CustomFieldsEditor({ drafts, onChange }: Props) {
  const patch = (uid: string, next: Partial<CustomFieldDraft>) => {
    onChange(drafts.map((d) => (d.uid === uid ? { ...d, ...next } : d)))
  }

  /**
   * Ask the backend where this field's answer should come from.
   *
   * On BLUR, not while typing: one call per field, after the recruiter has
   * finished the thought, and no suggestion that flickers between keystrokes.
   * Skipped entirely once HR has pinned the field, and skipped when the label
   * has not changed since it was last classified.
   */
  const classify = async (draft: CustomFieldDraft) => {
    const label = draft.label.trim()
    if (!label || draft.sourcePinned) return
    if (label === draft.classifiedLabel) return

    patch(draft.uid, { sourceLoading: true })
    try {
      const result = await classifyCustomField(label)
      patch(draft.uid, {
        ...retypeForSource(draft, result.source),
        source: result.source,
        sourceReason: result.reason,
        classifiedLabel: label,
        sourceLoading: false,
      })
    } catch {
      // A failed suggestion is never fatal, and never silently flips the
      // field: it keeps whatever source it had and says so plainly. The
      // server re-derives it on save anyway, defaulting to asking.
      patch(draft.uid, {
        sourceLoading: false,
        classifiedLabel: label,
        sourceReason: "",
      })
    }
  }

  const flipSource = (draft: CustomFieldDraft) => {
    const next: CustomFieldSource =
      draft.source === "applicant" ? "resume" : "applicant"
    patch(draft.uid, {
      ...retypeForSource(draft, next),
      source: next,
      sourcePinned: true,
      sourceReason: FALLBACK_REASON[next],
    })
  }

  /**
   * Changing the type invalidates any condition built on the old one, so the
   * rule is cleared rather than carried over into an operator that no longer
   * applies. Options are cleared too when the field stops being a choice list.
   */
  const changeType = (draft: CustomFieldDraft, type: CustomFieldType) => {
    patch(draft.uid, {
      type,
      options: type === "select" ? draft.options : [],
      onFail: null,
      operator: null,
      ruleNumber: "",
      ruleNumberMax: "",
      ruleOptions: [],
    })
  }

  const changeGate = (draft: CustomFieldDraft, choice: string) => {
    if (choice === "none") {
      patch(draft.uid, { onFail: null, operator: null })
      return
    }
    patch(draft.uid, {
      onFail: choice === "reject" ? "reject" : "review",
      // Default to the first operator the type offers, so the sentence is
      // complete the moment the gate is switched on.
      operator: draft.operator ?? OPERATORS_BY_TYPE[draft.type][0]?.value ?? null,
    })
  }

  return (
    <div className="grid gap-3">
      {drafts.map((draft) => {
        const operators = OPERATORS_BY_TYPE[draft.type]
        const gateValue = draft.onFail ?? "none"
        const typeOptions = typeOptionsFor(draft)
        // A type the CV reader cannot answer. Only reachable by flipping an
        // existing field's source, never by picking from the dropdown.
        const cvIncompatible =
          draft.source === "resume" && !CV_READABLE_TYPES.includes(draft.type)
        const needsNumber =
          draft.operator === "gt" ||
          draft.operator === "lt" ||
          draft.operator === "not_between"

        return (
          <div
            key={draft.uid}
            className="rounded-xl border border-[var(--field-border)] bg-surface-muted p-3.5"
          >
            {/* Row 1 — what the field is called, and what kind of answer it takes. */}
            <div className="flex items-start gap-2">
              <input
                type="text"
                value={draft.label}
                maxLength={80}
                onChange={(e) => patch(draft.uid, { label: e.target.value })}
                onBlur={() => void classify(draft)}
                placeholder="Field name, for example Expected Salary"
                aria-label="Field name"
                className={`${FIELD_CLASS} flex-1`}
              />
              {/*
               * Disabled once the source leaves only one legal type (reading
               * from a CV allows yes/no alone). A picker with a single entry is
               * noise, and the fixed value still has to be readable, so it stays
               * a rendered control rather than disappearing. The help panel
               * carries the why.
               */}
              <Select
                value={draft.type}
                disabled={typeOptions.length === 1}
                onValueChange={(v) => changeType(draft, v as CustomFieldType)}
              >
                <SelectTrigger
                  className={`${TRIGGER_CLASS} w-[140px] shrink-0`}
                  aria-label="Answer type"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {typeOptions.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove ${draft.label || "field"}`}
                onClick={() =>
                  onChange(drafts.filter((d) => d.uid !== draft.uid))
                }
                className="h-10 w-10 shrink-0 text-ink-muted hover:text-[var(--danger)]"
              >
                <Trash2 className="h-4 w-4" strokeWidth={1.9} />
              </Button>
            </div>

            {/* Row 2 — where the answer comes from. Stated, not asked. */}
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
              {draft.sourceLoading ? (
                <span className="inline-flex items-center gap-1.5 text-ink-muted">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                  Working out where to get this from...
                </span>
              ) : (
                <>
                  <span className="inline-flex items-center gap-1.5 text-ink-muted">
                    {draft.source === "resume" ? (
                      <FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
                    ) : (
                      <UserRound className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
                    )}
                    {draft.sourceReason || FALLBACK_REASON[draft.source]}
                  </span>
                  <button
                    type="button"
                    onClick={() => flipSource(draft)}
                    className="font-semibold text-primary underline-offset-2 hover:underline"
                  >
                    {draft.source === "resume"
                      ? "Ask the candidate instead"
                      : "Read it from the CV instead"}
                  </button>
                </>
              )}
            </div>

            {/*
             * Reachable only by flipping an EXISTING field to the CV: the type
             * dropdown never offers these two for a resume field. Says what to
             * do rather than describing a combination that no longer works.
             * `validateDrafts` blocks the step on the same condition.
             */}
            {cvIncompatible ? (
              <p className="mt-2.5 text-[12px] text-[var(--danger)]">
                Reading from a CV is a vetting check, so the question has to
                have a Yes or No answer. Change the answer type, or ask the
                candidate instead.
              </p>
            ) : null}

            {/* The choice list. Kept visible even while incompatible, so the
                options are plainly still there if the source is flipped back. */}
            {draft.type === "select" ? (
              <div className="mt-2.5">
                {draft.source === "applicant" ? (
                  <p className="mb-1.5 text-[12px] text-ink-muted">
                    The answers candidates can pick from. Write every one you
                    would accept as well as the ones you would not.
                  </p>
                ) : null}
                <ChipInput
                  values={draft.options}
                  onChange={(options) =>
                    patch(draft.uid, {
                      options,
                      // An accepted answer that is no longer offered would make
                      // the gate unsatisfiable, so prune as the list shrinks.
                      ruleOptions: draft.ruleOptions.filter((o) =>
                        options.includes(o)
                      ),
                    })
                  }
                  maxLength={80}
                  placeholder="Type a choice and press Enter"
                />
              </div>
            ) : null}

            {/*
             * Free text is the ONE type with no condition row, so without this
             * line its row just ends and the missing control reads as a bug.
             * Only the asked case is described: free text cannot be read from a
             * CV at all, and that case is covered by the note above.
             */}
            {draft.type === "text" && !cvIncompatible ? (
              <p className="mt-2.5 text-[12px] text-ink-muted">
                Candidates answer this in their own words. Free text is never
                checked automatically, so it decides nothing on its own, it is
                there for you to read.
              </p>
            ) : null}

            {/*
             * The type is settled for a CV field, but the WORDING is not, and
             * that is the half we cannot fix automatically. A field arriving
             * here from the classifier usually still carries a label written as
             * an open question ("Years of experience in Android?"), which reads
             * as nonsense once the only answers are yes and no.
             */}
            {draft.source === "resume" && draft.type === "boolean" ? (
              <p className="mt-2.5 text-[12px] text-ink-muted">
                Word this so a CV can answer it yes or no, with the requirement
                in the question itself. For example &ldquo;Has at least 3 years
                of Android development&rdquo;.
              </p>
            ) : null}

            {/* Row 3 — the condition. Absent entirely for free text. */}
            {isGateable(draft.type) ? (
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <Select
                  value={gateValue}
                  onValueChange={(v) => changeGate(draft, v)}
                >
                  <SelectTrigger
                    className={`${TRIGGER_CLASS} w-[170px]`}
                    aria-label={`What to do about ${draft.label || "this field"}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GATE_CHOICES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {draft.onFail !== null ? (
                  <>
                    <Select
                      value={draft.operator ?? operators[0].value}
                      onValueChange={(v) =>
                        patch(draft.uid, {
                          operator: v as CustomFieldOperator,
                        })
                      }
                    >
                      <SelectTrigger
                        className={`${TRIGGER_CLASS} w-[180px]`}
                        aria-label="Condition"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {operators.map((op) => (
                          <SelectItem key={op.value} value={op.value}>
                            {op.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {needsNumber ? (
                      <input
                        type="number"
                        value={draft.ruleNumber}
                        onWheel={blurOnWheel}
                        onChange={(e) =>
                          patch(draft.uid, { ruleNumber: e.target.value })
                        }
                        placeholder={
                          draft.operator === "not_between" ? "Lowest" : "Value"
                        }
                        aria-label={
                          draft.operator === "not_between"
                            ? "Lowest accepted value"
                            : "Value to compare against"
                        }
                        className={`${FIELD_CLASS} w-[120px]`}
                      />
                    ) : null}
                    {draft.operator === "not_between" ? (
                      <input
                        type="number"
                        value={draft.ruleNumberMax}
                        onWheel={blurOnWheel}
                        onChange={(e) =>
                          patch(draft.uid, { ruleNumberMax: e.target.value })
                        }
                        placeholder="Highest"
                        aria-label="Highest accepted value"
                        className={`${FIELD_CLASS} w-[120px]`}
                      />
                    ) : null}
                    {draft.operator === "not_in" ? (
                      <div className="min-w-[220px] flex-1">
                        <ChipInput
                          values={draft.ruleOptions}
                          onChange={(ruleOptions) =>
                            patch(draft.uid, { ruleOptions })
                          }
                          maxLength={80}
                          placeholder="Accepted answers"
                        />
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}

            {/*
             * Required is meaningful only for a field the candidate is asked.
             * A gated one is required by definition (the server forces it), so
             * the box is checked and locked rather than hidden, which would
             * leave the rule looking optional.
             */}
            {draft.source === "applicant" ? (
              <label className="mt-2.5 inline-flex items-center gap-2 text-[12.5px] text-ink-muted">
                <input
                  type="checkbox"
                  checked={draft.required || draft.onFail !== null}
                  disabled={draft.onFail !== null}
                  onChange={(e) =>
                    patch(draft.uid, { required: e.target.checked })
                  }
                  className="h-3.5 w-3.5 rounded border-[var(--field-border)] accent-[var(--primary)] disabled:cursor-not-allowed"
                />
                Candidates must answer this
                {draft.onFail !== null ? " (required by the condition above)" : ""}
              </label>
            ) : null}
          </div>
        )
      })}

      <div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={drafts.length >= MAX_FIELDS}
          onClick={() => onChange([...drafts, emptyDraft()])}
        >
          <Plus className="h-4 w-4" strokeWidth={1.9} />
          Add field
        </Button>
        {drafts.length >= MAX_FIELDS ? (
          <p className="mt-1.5 text-[12px] text-ink-muted">
            That is the maximum of {MAX_FIELDS} custom fields for one job.
          </p>
        ) : null}
      </div>
    </div>
  )
}
