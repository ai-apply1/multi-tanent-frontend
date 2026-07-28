import type {
  CustomFieldFailAction,
  CustomFieldOperator,
  CustomFieldSource,
  CustomFieldType,
  JobCustomField,
  JobCustomFieldPayload,
} from "@/features/jobs/types"

/**
 * One custom field while it is being edited.
 *
 * Flatter than the persisted shape on purpose: the rule's operands live as
 * separate strings so a half-typed number ("15", mid-way to "150000") is a
 * legal editor state rather than something the parser has to tolerate. It is
 * folded back into the nested `rule` object at submit time by `toPayload`.
 */
export interface CustomFieldDraft {
  /** Stable React key. A brand-new field has no server `key` yet. */
  uid: string
  /** The immutable server key, or null for a field added in this session. */
  key: string | null
  label: string
  type: CustomFieldType
  /** Choice list for `type: "select"`. */
  options: string[]
  source: CustomFieldSource
  /** True once HR flipped the suggestion; the classifier then leaves it alone. */
  sourcePinned: boolean
  /** The sentence shown under the field. */
  sourceReason: string
  /** A classify call is in flight for this field. */
  sourceLoading: boolean
  /** The label the current `source` was decided for, so a rename re-asks. */
  classifiedLabel: string
  required: boolean
  helpText: string
  /** null = collect only: recorded and shown to HR, decides nothing. */
  onFail: CustomFieldFailAction | null
  operator: CustomFieldOperator | null
  /** Operands, kept as raw strings while typing. */
  ruleNumber: string
  ruleNumberMax: string
  ruleOptions: string[]
}

/** The operators each type can express, in the order the picker shows them. */
export const OPERATORS_BY_TYPE: Record<
  CustomFieldType,
  ReadonlyArray<{ value: CustomFieldOperator; label: string }>
> = {
  number: [
    { value: "gt", label: "is more than" },
    { value: "lt", label: "is less than" },
    { value: "not_between", label: "is outside the range" },
  ],
  boolean: [
    { value: "is_false", label: "is No" },
    { value: "is_true", label: "is Yes" },
  ],
  select: [{ value: "not_in", label: "is not one of" }],
  // Free text cannot be gated: the only comparison available is string
  // matching, and string matching is exactly what the required-skills gate was
  // rewritten to stop doing. The editor hides the gate row entirely for these.
  text: [],
}

export const TYPE_LABELS: Record<CustomFieldType, string> = {
  text: "Free text",
  number: "Number",
  boolean: "Yes / No",
  select: "Choice list",
}

export const isGateable = (type: CustomFieldType): boolean =>
  OPERATORS_BY_TYPE[type].length > 0

/**
 * The only answer type a CV read may produce: yes/no.
 *
 * Reading from a CV is VETTING, not data entry. Everything a recruiter might
 * want to simply LOOK UP is already in the same drawer, one card above: the
 * parsed profile carries primary role, seniority, deterministic years,
 * technologies, full work history and a job-fit summary, and the CV itself is
 * one click away. So a CV-read field earns its place only by DECIDING
 * something, and a decision is a yes or a no.
 *
 * The three exclusions, each for its own reason:
 *
 * FREE TEXT gives back a sentence no condition can read and no two candidates
 * phrase alike.
 *
 * A CHOICE LIST exists to constrain what a HUMAN types, so with nobody typing
 * it constrains nothing, and exactly one answer comes back: a CV showing AWS,
 * Jenkins and Ansible forces an arbitrary pick, and picking the option you
 * excluded rejects a candidate whose CV also showed one you accept.
 *
 * NUMBER looks like it belongs and does not. A CV rarely states "4 years of
 * React", so the reader infers it from dates and context, then code compares
 * that guess against a threshold. Asking the threshold DIRECTLY ("has at least
 * 3 years of hands-on React?") is both simpler and more accurate: the model
 * reasons about the bar instead of committing to a false precision. It also
 * removes a real bias, since a CV reading "2-4 years" yields the lower bound
 * and would fail a "less than 3" gate a candidate with 4 years should clear.
 */
export const CV_READABLE_TYPES: readonly CustomFieldType[] = ["boolean"]

/**
 * The answer types offered for ONE field, given where its answer comes from.
 *
 * The field's CURRENT type is always included even when the source would not
 * offer it, so flipping an existing field to the CV leaves a populated dropdown
 * (and a `validateDrafts` error saying what to do) rather than a blank control
 * and a silently discarded option list.
 */
export const typeOptionsFor = (draft: CustomFieldDraft): CustomFieldType[] => {
  const base: CustomFieldType[] =
    draft.source === "resume"
      ? [...CV_READABLE_TYPES]
      : ["text", "number", "boolean", "select"]
  return base.includes(draft.type) ? base : [...base, draft.type]
}

let uidCounter = 0
const nextUid = (): string => `cf-${(uidCounter += 1)}`

/** A blank row for the "Add field" button. */
export const emptyDraft = (): CustomFieldDraft => ({
  uid: nextUid(),
  key: null,
  label: "",
  type: "text",
  options: [],
  // Provisional until the label is classified on blur. Applicant is the safe
  // provisional value for the same reason it is the safe fallback server-side:
  // an extra question is harmless, a silently-unasked one is not.
  source: "applicant",
  sourcePinned: false,
  sourceReason: "",
  sourceLoading: false,
  classifiedLabel: "",
  required: false,
  helpText: "",
  onFail: null,
  operator: null,
  ruleNumber: "",
  ruleNumberMax: "",
  ruleOptions: [],
})

/** Persisted field → editor draft, for the edit-a-job path. */
export const toDraft = (field: JobCustomField): CustomFieldDraft => ({
  uid: nextUid(),
  key: field.key,
  label: field.label,
  type: field.type,
  options: field.options ?? [],
  source: field.source,
  sourcePinned: field.sourcePinned,
  sourceReason: "",
  sourceLoading: false,
  // A saved field is already classified; re-opening the job must not re-ask.
  classifiedLabel: field.label,
  required: field.required,
  helpText: field.helpText ?? "",
  onFail: field.onFail,
  operator: field.rule?.operator ?? null,
  ruleNumber: field.rule?.number == null ? "" : String(field.rule.number),
  ruleNumberMax:
    field.rule?.numberMax == null ? "" : String(field.rule.numberMax),
  ruleOptions: field.rule?.options ?? [],
})

/**
 * Editor drafts → the request payload.
 *
 * `source` is deliberately NOT sent. The server owns it, and only re-derives
 * it for a field it has never seen; `sourceOverride` goes up ONLY when HR
 * actually flipped the suggestion, because sending it pins the field.
 */
export const toPayload = (
  drafts: CustomFieldDraft[]
): JobCustomFieldPayload[] =>
  drafts
    .filter((d) => d.label.trim().length > 0)
    .map((d) => {
      const gated = d.onFail !== null && d.operator !== null
      const payload: JobCustomFieldPayload = {
        label: d.label.trim(),
        type: d.type,
        required: d.required,
      }
      if (d.key) payload.key = d.key
      if (d.type === "select") payload.options = d.options
      if (d.sourcePinned) payload.sourceOverride = d.source
      if (d.helpText.trim()) payload.helpText = d.helpText.trim()
      if (gated) {
        payload.onFail = d.onFail!
        payload.rule = {
          operator: d.operator!,
          number:
            d.operator === "gt" ||
            d.operator === "lt" ||
            d.operator === "not_between"
              ? Number(d.ruleNumber)
              : null,
          numberMax:
            d.operator === "not_between" ? Number(d.ruleNumberMax) : null,
          options: d.operator === "not_in" ? d.ruleOptions : [],
        }
      }
      return payload
    })

/**
 * Everything wrong with the current drafts, as messages a recruiter can act
 * on. Mirrors the server's 422 checks so the wizard blocks the step instead of
 * bouncing the whole save; the server still re-checks, since this copy can
 * only ever be a convenience.
 */
export const validateDrafts = (drafts: CustomFieldDraft[]): string[] => {
  const errors: string[] = []
  const seen = new Set<string>()

  for (const d of drafts) {
    const label = d.label.trim()
    if (!label) {
      errors.push("Every custom field needs a label.")
      continue
    }
    const lowered = label.toLowerCase()
    if (seen.has(lowered)) {
      errors.push(`Two fields are both called "${label}". Rename one.`)
    }
    seen.add(lowered)

    if (d.source === "resume" && !CV_READABLE_TYPES.includes(d.type)) {
      errors.push(
        `"${label}" cannot be read from a CV as ${TYPE_LABELS[d.type].toLowerCase()}. Reading from a CV is a vetting check, so the question has to have a Yes or No answer. Change the answer type, or ask the candidate instead.`
      )
    } else if (d.type === "select" && d.options.length < 2) {
      errors.push(`"${label}" is a choice list, so it needs at least two options.`)
    }

    if (d.onFail === null) continue

    if (d.operator === null) {
      errors.push(`Choose what to check on "${label}", or set it to collect only.`)
      continue
    }
    if (d.operator === "gt" || d.operator === "lt") {
      if (parseNumber(d.ruleNumber) === null) {
        errors.push(`The condition on "${label}" needs a number to compare against.`)
      }
    }
    if (d.operator === "not_between") {
      const low = parseNumber(d.ruleNumber)
      const high = parseNumber(d.ruleNumberMax)
      if (low === null || high === null) {
        errors.push(`The range on "${label}" needs both a lowest and a highest value.`)
      } else if (low > high) {
        errors.push(
          `The range on "${label}" is inverted: ${low} is above ${high}.`
        )
      }
    }
    if (d.operator === "not_in" && d.ruleOptions.length === 0) {
      errors.push(`The condition on "${label}" needs at least one accepted answer.`)
    }
  }

  return errors
}

const parseNumber = (raw: string): number | null => {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}
