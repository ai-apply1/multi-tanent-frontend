import type { ReactNode } from "react"
import { Plus, Trash2 } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  mintDraftId,
  type DraftError,
  type FormFieldDraft,
} from "@/features/jobs/components/ApplicationFormEditor"
import {
  FIELD_TYPE_LABELS,
  OPERATOR_LABELS,
  RULE_OPERATORS_BY_FIELD_TYPE,
  type CustomRuleOnFail,
  type CustomRuleOperator,
  type JobCustomRule,
} from "@/features/jobs/types"
import { blurOnWheel, cn } from "@/lib/utils"

const FIELD_CLASS =
  "h-10 w-full rounded-lg border border-[var(--field-border)] bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink-subtle focus:border-primary focus:shadow-[0_0_0_3px_var(--accent-ring)]"

const SELECT_TRIGGER_CLASS =
  "h-10 rounded-lg border-[var(--field-border)] bg-surface px-3 text-[13.5px]"

/**
 * The value boxes on a condition row, sized for what actually gets typed
 * into them: salaries. A seven-figure one has to stay fully readable WHILE
 * being typed, which is what the old 92px box failed at — Chrome only draws
 * the stepper on hover/focus, and it takes its ~17px out of the content box,
 * so the digits clipped exactly when the caret was in the field. `no-spinner`
 * (globals.css) drops that stepper; clicking a salary up one unit at a time
 * was never the point, and the wheel hazard it also carries is already
 * handled by `blurOnWheel`.
 */
const NUMBER_CLASS = "no-spinner w-[132px]"

/**
 * The soft range's four boxes SHARE one fixed-width block instead of each
 * carrying its own width, so the preview bar underneath spans exactly the
 * same pixels as the inputs it describes. Its caption makes each box
 * identifiable, which is what extra width buys elsewhere.
 */
/**
 * Solid status fills for the soft range's bar, lightened on dark exactly as
 * `badge.tsx` does it: the raw tokens are tuned for a white canvas, and
 * `--success` at #15803d against this app's near-black surface reads as a
 * dark smudge rather than a green zone.
 *
 * Never more than these three, and review mode uses only the first two: one
 * colour per DESTINATION (passes, review queue, rejected), so the bar cannot
 * show a distinction the outcome does not have. An earlier version also
 * faded the outer zones to mark them open-ended, which put two barely
 * different ambers side by side meaning the same thing.
 */
const BAND_PASS_FILL =
  "bg-success dark:bg-[color-mix(in_oklch,var(--success),white_30%)]"
const BAND_REVIEW_FILL =
  "bg-warning dark:bg-[color-mix(in_oklch,var(--warning),white_25%)]"
const BAND_REJECT_FILL =
  "bg-[var(--danger)] dark:bg-[color-mix(in_oklch,var(--danger),white_25%)]"

/**
 * The editing shape for one requirement. Condition values stay RAW strings
 * so half-typed numbers are a legal editing state; `serializeCustomRules`
 * coerces per the field's type on save.
 */
export interface RuleDraft {
  id: string
  label: string
  onFail: CustomRuleOnFail
  conditions: ConditionDraft[]
}

export interface ConditionDraft {
  fieldId: string
  op: CustomRuleOperator | ""
  /** The single value, or a range's lower bound (`between`/`between_soft`). */
  value: string
  /** A range's upper bound. */
  value2: string
  /**
   * `between_soft` only: the tolerance either side of the range, so the
   * four numbers read `softValue <= value <= value2 <= softValue2`. Empty
   * for every other operator.
   */
  softValue: string
  softValue2: string
  /** List picks (`is_one_of`, `includes_*`). */
  values: string[]
}

const emptyCondition = (): ConditionDraft => ({
  fieldId: "",
  op: "",
  value: "",
  value2: "",
  softValue: "",
  softValue2: "",
  values: [],
})

/** The value fields, blanked. Used wherever a change invalidates them. */
const blankValues = (): Omit<ConditionDraft, "fieldId" | "op"> => ({
  value: "",
  value2: "",
  softValue: "",
  softValue2: "",
  values: [],
})

export const emptyRule = (): RuleDraft => ({
  id: mintDraftId("rule"),
  label: "",
  onFail: "review",
  conditions: [emptyCondition()],
})

/** Caps mirrored from the backend DTOs. */
const MAX_RULES = 20
const MAX_CONDITIONS = 5

/** The form fields a rule may gate on (number/select/multiselect/checkbox). */
export const ruleAddressableFields = (
  fields: FormFieldDraft[],
): FormFieldDraft[] =>
  fields.filter((f) => RULE_OPERATORS_BY_FIELD_TYPE[f.type] !== undefined)

export const rulesFromJob = (rules: JobCustomRule[] | undefined): RuleDraft[] =>
  (rules ?? []).map((rule) => ({
    id: rule.id,
    label: rule.label,
    onFail: rule.onFail,
    conditions: rule.conditions.map((c) => {
      const value = c.value
      const base = { ...blankValues(), fieldId: c.fieldId, op: c.op }
      if (Array.isArray(value) && c.op === "between") {
        return {
          ...base,
          value: String(value[0] ?? ""),
          value2: String(value[1] ?? ""),
        }
      }
      // Stored outwards-in as [softMin, min, max, softMax]; the editor holds
      // the inner pair in `value`/`value2` like a plain between, so the
      // control below can share the range half with it.
      if (Array.isArray(value) && c.op === "between_soft") {
        return {
          ...base,
          softValue: String(value[0] ?? ""),
          value: String(value[1] ?? ""),
          value2: String(value[2] ?? ""),
          softValue2: String(value[3] ?? ""),
        }
      }
      if (Array.isArray(value)) {
        return { ...base, values: value.map(String) }
      }
      return { ...base, value: value == null ? "" : String(value) }
    }),
  }))

/**
 * What kind of value control a (field type, operator) pair takes. The single
 * client-side source for both the renderer and the validator below.
 */
type ValueShape =
  | "number"
  | "pair"
  | "band"
  | "option"
  | "optionList"
  | "boolean"

const valueShapeFor = (
  fieldType: FormFieldDraft["type"],
  op: CustomRuleOperator,
): ValueShape => {
  if (op === "between") return "pair"
  if (op === "between_soft") return "band"
  if (op === "is_one_of" || op === "includes_any" || op === "includes_all") {
    return "optionList"
  }
  // eq, gte, lte:
  if (fieldType === "number") return "number"
  if (fieldType === "checkbox") return "boolean"
  return "option"
}

/**
 * Everything wrong with the drafts, as messages HR can act on. Mirrors the
 * server's 422s (`assertCustomRulesValid`) so the wizard blocks the step
 * instead of bouncing the save; the server still re-checks.
 */
export const validateCustomRules = (
  rules: RuleDraft[],
  fields: FormFieldDraft[],
): DraftError[] => {
  const errors: DraftError[] = []
  const fieldById = new Map(fields.map((f) => [f.id, f]))

  rules.forEach((rule, ruleIndex) => {
    const push = (message: string) =>
      errors.push({ cardId: rule.id, message })
    const name = rule.label.trim() || `Requirement ${ruleIndex + 1}`
    if (!rule.label.trim()) {
      push(
        `Requirement ${ruleIndex + 1} needs a name, e.g. "Must have own laptop".`,
      )
    }
    // One condition per field per rule, mirroring the server's 422: an AND
    // of two conditions on one field is redundant at best ("between" covers
    // a range) and impossible at worst (equals two different options).
    const seenFieldIds = new Set<string>()
    rule.conditions.forEach((condition) => {
      if (!condition.fieldId) {
        push(`"${name}" has a condition with no form field picked.`)
        return
      }
      const field = fieldById.get(condition.fieldId)
      if (!field) {
        push(
          `"${name}" checks a form field that is no longer on the application form. Remove that condition.`,
        )
        return
      }
      if (seenFieldIds.has(condition.fieldId)) {
        push(
          `"${name}" checks ${field.label.trim() || "the same field"} twice. Combine those into one condition; for a number range, use "is between".`,
        )
        return
      }
      seenFieldIds.add(condition.fieldId)
      if (!condition.op) {
        push(`"${name}" has a condition with no check picked.`)
        return
      }
      const shape = valueShapeFor(field.type, condition.op)
      const fieldName = field.label.trim() || "that field"
      if (shape === "number" && !Number.isFinite(Number(condition.value.trim() || NaN))) {
        push(`"${name}" needs a number for ${fieldName}.`)
      }
      if (shape === "pair") {
        const lo = Number(condition.value.trim() || NaN)
        const hi = Number(condition.value2.trim() || NaN)
        if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
          push(`"${name}" needs both ends of the range for ${fieldName}.`)
        } else if (lo > hi) {
          push(`"${name}" has a range that starts above where it ends for ${fieldName}.`)
        }
      }
      if (shape === "band") {
        const band = [
          condition.softValue,
          condition.value,
          condition.value2,
          condition.softValue2,
        ].map((v) => Number(v.trim() || NaN))
        if (band.some((n) => !Number.isFinite(n))) {
          push(
            `"${name}" needs all four numbers for ${fieldName}: the soft range and the range inside it.`,
          )
        } else if (band[1] > band[2]) {
          push(`"${name}" has a range that starts above where it ends for ${fieldName}.`)
        } else if (band[0] > band[1] || band[3] < band[2]) {
          // The soft band must CONTAIN the range. Inverted, "borderline"
          // would cover values already inside the range, and the operator
          // would quietly mean nothing.
          push(
            `"${name}" has a soft range that does not surround its range for ${fieldName}. The soft range must start at or below the range and end at or above it.`,
          )
        }
      }
      if (shape === "option" && field.type !== "checkbox" && !condition.value) {
        push(`"${name}" needs an option picked for ${fieldName}.`)
      }
      if (shape === "boolean" && condition.value !== "true" && condition.value !== "false") {
        push(`"${name}" needs checked or unchecked picked for ${fieldName}.`)
      }
      if (shape === "optionList" && condition.values.length === 0) {
        push(`"${name}" needs at least one option picked for ${fieldName}.`)
      }
    })
  })
  return errors
}

/** Drafts -> the exact API payload shape. Call only on validated drafts. */
export const serializeCustomRules = (
  rules: RuleDraft[],
  fields: FormFieldDraft[],
): JobCustomRule[] => {
  const fieldById = new Map(fields.map((f) => [f.id, f]))
  return rules.map((rule) => ({
    id: rule.id,
    label: rule.label.trim(),
    onFail: rule.onFail,
    conditions: rule.conditions.map((condition) => {
      const field = fieldById.get(condition.fieldId)
      const op = condition.op as CustomRuleOperator
      const shape = valueShapeFor(field?.type ?? "number", op)
      const value =
        shape === "number"
          ? Number(condition.value)
          : shape === "pair"
            ? [Number(condition.value), Number(condition.value2)]
            : shape === "band"
              ? [
                  Number(condition.softValue),
                  Number(condition.value),
                  Number(condition.value2),
                  Number(condition.softValue2),
                ]
              : shape === "boolean"
                ? condition.value === "true"
                : shape === "optionList"
                  ? condition.values
                  : condition.value
      return { fieldId: condition.fieldId, op, value }
    }),
  }))
}

/**
 * The "Custom requirements" section of the Eligibility step: HR's own gates
 * over the application-form answers, one card per requirement.
 *
 * Each requirement is a flat AND of up to five conditions; "or" is another
 * requirement. There is deliberately no nesting, no ordering, and no
 * source picker — the fields these read are the ones HR just built on the
 * Application form step, and CV facts stay with the fixed gates above.
 */
export function CustomRulesEditor({
  rules,
  onChange,
  fields,
  onGoToFormStep,
  errorCardIds,
}: {
  rules: RuleDraft[]
  onChange: (next: RuleDraft[]) => void
  /** Current form-field drafts, for the field/operator/value pickers. */
  fields: FormFieldDraft[]
  /**
   * Jump the wizard to the Application form step. Rendered next to the add
   * button as the "screen the CV instead" fork: a user who wants a CV gate
   * is otherwise steered into creating a candidate-visible question here.
   */
  onGoToFormStep?: () => void
  /** Cards the step's validator flagged: outlined in the danger colour. */
  errorCardIds?: Set<string>
}) {
  const addressable = ruleAddressableFields(fields)
  const fieldById = new Map(fields.map((f) => [f.id, f]))

  const patchRule = (id: string, patch: Partial<RuleDraft>) =>
    onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)))

  const patchCondition = (
    ruleId: string,
    index: number,
    patch: Partial<ConditionDraft>,
  ) =>
    onChange(
      rules.map((r) =>
        r.id === ruleId
          ? {
              ...r,
              conditions: r.conditions.map((c, i) =>
                i === index ? { ...c, ...patch } : c,
              ),
            }
          : r,
      ),
    )

  // Existing rules ALWAYS render, even when no addressable field is left:
  // deleting a field can orphan a rule, and the step's validation error
  // tells the user to remove it — which they can only do if its card is on
  // screen. (An earlier version returned the dashed note INSTEAD of the
  // list here, which hid the orphaned card and made the error undismissable.)
  // Only the add button is gated on having something to gate on.
  return (
    <div className="grid gap-3">
      {rules.map((rule, ruleIndex) => (
        <div
          key={rule.id}
          id={`card-${rule.id}`}
          className={cn(
            "rounded-xl border border-[var(--field-border)] bg-surface-muted p-3.5",
            errorCardIds?.has(rule.id) && "border-[var(--danger)]",
          )}
        >
          <div className="mb-3 flex items-center gap-2">
            <input
              value={rule.label}
              maxLength={200}
              onChange={(e) => patchRule(rule.id, { label: e.target.value })}
              placeholder={`e.g. Must have own laptop`}
              aria-label={`Requirement ${ruleIndex + 1} name`}
              className={`${FIELD_CLASS} font-semibold`}
            />
            <button
              type="button"
              aria-label={`Remove requirement ${ruleIndex + 1}`}
              title="Remove this requirement"
              onClick={() => onChange(rules.filter((r) => r.id !== rule.id))}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-ink-subtle transition-colors hover:bg-hover hover:text-[var(--danger)]"
            >
              <Trash2 className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>

          <p className="mb-2 text-[12px] font-semibold text-ink-muted">
            Passes when ALL of these are true:
          </p>
          <div className="grid gap-2">
            {rule.conditions.map((condition, index) => {
              const field = condition.fieldId
                ? fieldById.get(condition.fieldId)
                : undefined
              const ops = field
                ? (RULE_OPERATORS_BY_FIELD_TYPE[field.type] ?? [])
                : []
              // Fields the rule's OTHER conditions already check. Hidden from
              // this condition's picker (its own pick stays, so the Select
              // can render it): conditions are an AND, and a second condition
              // on one field is redundant or impossible. Mirrors the
              // validator + the server's 422.
              const usedElsewhere = new Set(
                rule.conditions
                  .filter((_, i) => i !== index)
                  .map((c) => c.fieldId)
                  .filter(Boolean),
              )
              const pickable = addressable.filter(
                (f) => f.id === condition.fieldId || !usedElsewhere.has(f.id),
              )
              const shape =
                field && condition.op
                  ? valueShapeFor(field.type, condition.op as CustomRuleOperator)
                  : null
              // The soft range is the one value control that is a BLOCK
              // (inputs + preview), not a box. Inline with the selects it
              // towers over them and `items-center` floats them at its
              // mid-height, so it gets its own full-width row below instead
              // and the selects row stays a row of equal-height controls.
              const bandBelow = shape === "band"
              return (
                <div key={index} className="rounded-lg bg-surface p-2">
                  <div className="flex flex-wrap items-center gap-2">
                  {/* Field */}
                  <Select
                    value={condition.fieldId}
                    onValueChange={(fieldId) => {
                      // A new field resets the check and its value: neither
                      // is guaranteed to fit the new field's type.
                      const next = fieldById.get(fieldId)
                      const nextOps = next
                        ? (RULE_OPERATORS_BY_FIELD_TYPE[next.type] ?? [])
                        : []
                      patchCondition(rule.id, index, {
                        fieldId,
                        op: nextOps.length === 1 ? nextOps[0] : "",
                        ...blankValues(),
                      })
                    }}
                  >
                    <SelectTrigger
                      aria-label="Form field"
                      className={`${SELECT_TRIGGER_CLASS} w-[200px]`}
                    >
                      {/* Explicit children: the closed trigger shows ONLY the
                          field's label. Without this, Radix re-renders the
                          selected item's children here, and the type tag
                          ("Number") truncated to "Num…" in the fixed-width
                          trigger. The tag stays in the open list, where the
                          type is actually being chosen between. A fieldId
                          whose field was DELETED renders as an explicit
                          "Deleted field" (Radix suppresses the placeholder
                          when a value is set, so without this the trigger is
                          just blank and nothing marks the broken condition). */}
                      <SelectValue placeholder="Pick a form field…">
                        {field ? (
                          field.label.trim() || "Untitled field"
                        ) : condition.fieldId ? (
                          <span className="font-semibold text-[var(--danger)]">
                            Deleted field
                          </span>
                        ) : null}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {pickable.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.label.trim() || "Untitled field"}
                          <span className="ml-2 text-[11px] font-normal text-ink-muted">
                            {FIELD_TYPE_LABELS[f.type]}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Operator */}
                  {field ? (
                    <Select
                      value={condition.op}
                      onValueChange={(op) => {
                        const nextOp = op as CustomRuleOperator
                        const nextShape = valueShapeFor(field.type, nextOp)
                        const prevShape = condition.op
                          ? valueShapeFor(
                              field.type,
                              condition.op as CustomRuleOperator,
                            )
                          : null
                        // A range and a range-with-tolerance hold the SAME
                        // inner pair, so switching between them keeps it.
                        // Blanking would make HR retype the two numbers they
                        // just entered merely to add room around them.
                        const keepsRange =
                          (prevShape === "pair" && nextShape === "band") ||
                          (prevShape === "band" && nextShape === "pair")
                        patchCondition(
                          rule.id,
                          index,
                          prevShape === nextShape
                            ? { op: nextOp }
                            : keepsRange
                              ? {
                                  op: nextOp,
                                  softValue: "",
                                  softValue2: "",
                                  values: [],
                                }
                              : { op: nextOp, ...blankValues() },
                        )
                      }}
                    >
                      {/* Sized to the longest label, "is ideally between":
                          at 150px it truncated to "is ideally betw…", which
                          hid the one word that distinguishes it from plain
                          "is between" right above it in the list. */}
                      <SelectTrigger
                        aria-label="Check"
                        className={`${SELECT_TRIGGER_CLASS} w-[172px]`}
                      >
                        <SelectValue placeholder="Check…" />
                      </SelectTrigger>
                      <SelectContent>
                        {ops.map((op) => (
                          <SelectItem key={op} value={op}>
                            {field.type === "checkbox"
                              ? "must be"
                              : OPERATOR_LABELS[op]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}

                  {/* Value (the band renders below the row instead) */}
                  {field && condition.op && !bandBelow ? (
                    <ConditionValueControl
                      field={field}
                      condition={condition}
                      onPatch={(patch) => patchCondition(rule.id, index, patch)}
                    />
                  ) : null}

                  {/* Also shown for a single ORPHANED condition (its field
                      was deleted): the validator tells the user to remove
                      it, so an affordance must exist. Deleting the last
                      condition resets it to an empty one rather than
                      leaving a condition-less rule. */}
                  {rule.conditions.length > 1 ||
                  (condition.fieldId && !field) ? (
                    <button
                      type="button"
                      aria-label="Remove this condition"
                      title="Remove this condition"
                      onClick={() =>
                        patchRule(rule.id, {
                          conditions:
                            rule.conditions.length > 1
                              ? rule.conditions.filter((_, i) => i !== index)
                              : [emptyCondition()],
                        })
                      }
                      className="ml-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-subtle transition-colors hover:bg-hover hover:text-[var(--danger)]"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                  ) : null}

                  </div>

                  {bandBelow ? (
                    <BandControl
                      condition={condition}
                      onFail={rule.onFail}
                      onPatch={(patch) => patchCondition(rule.id, index, patch)}
                    />
                  ) : null}

                  {/* A rule over an optional question floods the review
                      queue with skippers (a missing answer is always
                      "unknown", never a reject), so say it here where the
                      rule is being built. */}
                  {field && !field.required ? (
                    <p className="mt-2 text-[11.5px] text-ink-muted">
                      &quot;{field.label.trim() || "Untitled field"}&quot; is
                      optional on the application form. Candidates who skip
                      it always go to your review queue for this
                      requirement. Consider making the field required.
                    </p>
                  ) : null}
                </div>
              )
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2.5">
            {/* Also capped by the number of addressable fields: each condition
                claims one field, so once every field is checked a new
                condition could only open an empty picker. Disabled with the
                reason rather than hidden: a control that silently vanishes
                right after being used reads as a bug. */}
            <button
              type="button"
              disabled={
                rule.conditions.length >= MAX_CONDITIONS ||
                rule.conditions.length >= addressable.length
              }
              title={
                rule.conditions.length >= MAX_CONDITIONS
                  ? `A requirement can have up to ${MAX_CONDITIONS} conditions.`
                  : addressable.length === 0
                    ? "No form field a requirement can check exists any more. Add one on the Application form step, or delete this requirement."
                    : rule.conditions.length >= addressable.length
                      ? "Every field a requirement can check already has a condition here."
                      : undefined
              }
              onClick={() =>
                patchRule(rule.id, {
                  conditions: [...rule.conditions, emptyCondition()],
                })
              }
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12.5px] font-semibold text-primary transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.2} />
              And also…
            </button>
            <label className="flex items-center gap-2 text-[12.5px] font-semibold text-ink">
              If not met:
              <Select
                value={rule.onFail}
                onValueChange={(onFail) =>
                  patchRule(rule.id, { onFail: onFail as CustomRuleOnFail })
                }
              >
                <SelectTrigger
                  aria-label="What happens when this requirement is not met"
                  className={`${SELECT_TRIGGER_CLASS} h-9 w-[230px]`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="review">Send to my review queue</SelectItem>
                  <SelectItem value="reject">Reject automatically</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>
        </div>
      ))}

      {addressable.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--field-border)] px-3.5 py-3">
          <p className="text-[13px] text-ink-muted">
            Requirements check answers from your application form. Add a
            number, dropdown, multi-select or checkbox field on the
            Application form step first, then set requirements on it here. To
            screen on the CV itself without asking the candidate anything,
            add an Eligibility check there instead.
          </p>
          {onGoToFormStep ? (
            <button
              type="button"
              onClick={onGoToFormStep}
              className="mt-2 text-[12.5px] font-semibold text-primary hover:underline"
            >
              Go to the Application form step
            </button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={rules.length >= MAX_RULES}
            title={
              rules.length >= MAX_RULES
                ? `A job can have up to ${MAX_RULES} requirements.`
                : undefined
            }
            onClick={() => onChange([...rules, emptyRule()])}
            className="flex w-fit items-center gap-1.5 rounded-lg border border-dashed border-[var(--field-border)] px-3 py-2 text-[13px] font-semibold text-ink-2 transition-colors hover:border-primary hover:bg-accent hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[var(--field-border)] disabled:hover:bg-transparent disabled:hover:text-ink-2"
          >
            <Plus className="h-4 w-4" strokeWidth={2.2} />
            Add a requirement
          </button>
          {onGoToFormStep ? (
            <button
              type="button"
              onClick={onGoToFormStep}
              className="text-[12.5px] font-semibold text-primary hover:underline"
            >
              Screen the CV instead, no question asked
            </button>
          ) : null}
        </div>
      )}

      {rules.length > 0 ? (
        <p className="text-[12px] text-ink-muted">
          A candidate who was never asked (for example, a CV uploaded by your
          team) goes to your review queue instead of being rejected, whatever
          you pick above.
        </p>
      ) : null}
    </div>
  )
}

/**
 * The right-hand value input, shaped by the field type + operator. Every
 * shape here is row-sized; the soft range's block control is `BandControl`,
 * which the condition row renders on its own line instead.
 */
function ConditionValueControl({
  field,
  condition,
  onPatch,
}: {
  field: FormFieldDraft
  condition: ConditionDraft
  onPatch: (patch: Partial<ConditionDraft>) => void
}) {
  const shape = valueShapeFor(field.type, condition.op as CustomRuleOperator)

  // The narrow widths must go through `cn`: FIELD_CLASS carries `w-full`,
  // and plain string concatenation keeps BOTH width classes on the element,
  // where stylesheet order (not class order) decides — `w-full` won, the
  // input swallowed the row, and the delete button wrapped onto its own
  // line. tailwind-merge drops the conflicting `w-full` for us.
  if (shape === "number") {
    return (
      <input
        type="number"
        value={condition.value}
        onWheel={blurOnWheel}
        onChange={(e) => onPatch({ value: e.target.value })}
        aria-label="Value"
        placeholder="0"
        className={cn(FIELD_CLASS, NUMBER_CLASS)}
      />
    )
  }

  if (shape === "pair") {
    return (
      <span className="flex items-center gap-1.5">
        <input
          type="number"
          value={condition.value}
          onWheel={blurOnWheel}
          onChange={(e) => onPatch({ value: e.target.value })}
          aria-label="From"
          placeholder="From"
          className={cn(FIELD_CLASS, NUMBER_CLASS)}
        />
        <span className="text-[12px] text-ink-subtle">and</span>
        {/* Patches `value2`. Writing `value` here (as this did) makes the
            upper bound un-typeable: every keystroke lands in From instead,
            To stays bound to an empty `value2` so it never fills, and the
            step then blocks on "needs both ends of the range". */}
        <input
          type="number"
          value={condition.value2}
          onWheel={blurOnWheel}
          onChange={(e) => onPatch({ value2: e.target.value })}
          aria-label="To"
          placeholder="To"
          className={cn(FIELD_CLASS, NUMBER_CLASS)}
        />
      </span>
    )
  }

  if (shape === "boolean") {
    return (
      <Select
        value={condition.value}
        onValueChange={(value) => onPatch({ value })}
      >
        <SelectTrigger
          aria-label="Checked or unchecked"
          className={`${SELECT_TRIGGER_CLASS} w-[140px]`}
        >
          <SelectValue placeholder="Pick…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">Checked</SelectItem>
          <SelectItem value="false">Unchecked</SelectItem>
        </SelectContent>
      </Select>
    )
  }

  if (shape === "optionList") {
    // The field's own options as toggleable pills — a picker, not free text,
    // so a rule can never name an option the form does not offer.
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        {field.options.map((option) => {
          const picked = condition.values.includes(option)
          return (
            <button
              key={option}
              type="button"
              aria-pressed={picked}
              onClick={() =>
                onPatch({
                  values: picked
                    ? condition.values.filter((v) => v !== option)
                    : [...condition.values, option],
                })
              }
              className={`rounded-full border px-2.5 py-1 text-[12px] font-semibold transition-colors ${
                picked
                  ? "border-primary bg-accent text-primary"
                  : "border-line-2 bg-surface text-ink-2 hover:bg-hover"
              }`}
            >
              {option}
            </button>
          )
        })}
        {field.options.length === 0 ? (
          <span className="text-[12px] text-ink-muted">
            Add options to this field on the Application form step first.
          </span>
        ) : null}
      </span>
    )
  }

  // "option": eq / is_one_of single pick on a select field.
  return (
    <Select
      value={condition.value}
      onValueChange={(value) => onPatch({ value })}
    >
      <SelectTrigger aria-label="Option" className={`${SELECT_TRIGGER_CLASS} w-[170px]`}>
        <SelectValue placeholder="Pick an option…" />
      </SelectTrigger>
      <SelectContent>
        {field.options.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * One captioned bound of the soft range. The caption is a wrapping `<label>`
 * rather than an `aria-label`, so the name is on screen for everyone and not
 * only in the accessibility tree, which is the whole reason it exists here.
 *
 * Sentence case, not the small-caps used for headings elsewhere: these are
 * phrases rather than words, and uppercase plus letter-spacing pushes "Will
 * consider from" onto a second line in a quarter-width box.
 */
function BandInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="grid min-w-0 flex-1 gap-1">
      <span className="truncate text-[10.5px] font-semibold text-ink-subtle">
        {label}
      </span>
      <input
        type="number"
        value={value}
        onWheel={blurOnWheel}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
        className={cn(FIELD_CLASS, "no-spinner")}
      />
    </label>
  )
}

/** The four bounds as numbers, or null while they cannot be drawn. */
const readBand = (condition: ConditionDraft) => {
  const [softFrom, from, to, softTo] = [
    condition.softValue,
    condition.value,
    condition.value2,
    condition.softValue2,
  ].map((v) => Number(v.trim() || NaN))
  if (![softFrom, from, to, softTo].every(Number.isFinite)) return null
  // Out of order means the validator is already saying so in words. Drawing
  // an inverted band on top of that would be a second, wronger explanation.
  if (softFrom > from || from > to || to > softTo) return null
  return { softFrom, from, to, softTo }
}

const bandNumber = (n: number) => n.toLocaleString("en-US")

/**
 * The soft range's whole editing surface: the four captioned inputs, and
 * under them the rule drawn as a number line. Rendered by the condition row
 * as a full-width line of its own, below the field and operator selects.
 *
 * Four boxes in NUMBER-LINE order, each captioned. Placeholders alone (how
 * the plain two-box range labels itself) stop working at four: once they
 * are filled there is nothing left on screen saying which number is the
 * tolerance and which is the ideal, and getting that backwards silently
 * inverts the rule.
 */
function BandControl({
  condition,
  onFail,
  onPatch,
}: {
  condition: ConditionDraft
  /**
   * The RULE's failure action. It decides what the zones beyond the
   * tolerance mean, so the preview must follow it.
   */
  onFail: CustomRuleOnFail
  onPatch: (patch: Partial<ConditionDraft>) => void
}) {
  const band = readBand(condition)
  return (
    <div className="mt-2 grid max-w-[560px] gap-2">
      <div className="flex items-end gap-1.5">
        <BandInput
          label="Will consider from"
          value={condition.softValue}
          onChange={(softValue) => onPatch({ softValue })}
        />
        <BandInput
          label="Ideal from"
          value={condition.value}
          onChange={(value) => onPatch({ value })}
        />
        <BandInput
          label="Ideal to"
          value={condition.value2}
          onChange={(value2) => onPatch({ value2 })}
        />
        <BandInput
          label="Will consider to"
          value={condition.softValue2}
          onChange={(softValue2) => onPatch({ softValue2 })}
        />
      </div>
      {/* Prose while the numbers are unusable, the picture once they are.
          The bar says everything the sentence did and says it about THESE
          numbers, so keeping both would just be the same thing twice. */}
      {band ? (
        <BandPreview band={band} onFail={onFail} />
      ) : (
        <p className="text-[11.5px] leading-snug text-ink-muted">
          The ideal range is what passes. An answer between it and what you
          will consider goes to your review queue instead of being rejected.
          Set a considered value equal to its ideal for no margin on that
          side.
        </p>
      )}
    </div>
  )
}

/**
 * The rule as a number line: what passes, what gets looked at, and what
 * does not make it, in proportion.
 *
 * Reading four numbers and holding two nested ranges in your head is
 * exactly the step where a tolerance gets set inside-out, and the
 * arithmetic is invisible in four separate boxes. The bar makes a lopsided
 * margin or a hairline pass zone obvious at a glance instead.
 *
 * Zones are merged BY DESTINATION before drawing. When the rule rejects,
 * that is green with amber margins and red ends: three fates, three
 * colours. When it sends misses to review, the margins and the ends are
 * the same fate, so they draw as ONE amber run per side and one legend
 * line, not two ambers restating each other.
 */
function BandPreview({
  band,
  onFail,
}: {
  band: { softFrom: number; from: number; to: number; softTo: number }
  onFail: CustomRuleOnFail
}) {
  const { softFrom, from, to, softTo } = band
  const total = softTo - softFrom
  // Fixed caps for the two open-ended zones: the rule sits on an axis that
  // runs past it in both directions, and a bar that stopped at its own
  // outermost number would read as "nothing exists out here".
  const CAP = 9
  const inner = 100 - CAP * 2
  const share = (n: number) => (total > 0 ? (n / total) * inner : 0)
  const lowWidth = share(from - softFrom)
  // An exact-value rule (ideal from === ideal to) still HAS a pass zone: it
  // is a point, not nothing. Keeping a sliver stops the bar contradicting
  // the "Passes: 100,000" line directly under it. `total === 0` is all four
  // equal: the pass zone is the whole inner bar.
  const coreWidth = total > 0 ? Math.max(share(to - from), 2) : inner
  const highWidth = share(softTo - to)
  // Asked of the NUMBERS, not the rendered widths: a margin a thousandth of
  // the axis wide is still a margin, and the legend must name it even when
  // the bar cannot show it.
  const hasLow = from > softFrom
  const hasHigh = softTo > to
  const rejects = onFail === "reject"

  // Zero-width slices are dropped, not rendered: with the gap between
  // segments, an empty slice would still leave a double gap that reads as a
  // missing zone.
  const segments = (
    rejects
      ? [
          { fill: BAND_REJECT_FILL, width: CAP },
          { fill: BAND_REVIEW_FILL, width: lowWidth },
          { fill: BAND_PASS_FILL, width: coreWidth },
          { fill: BAND_REVIEW_FILL, width: highWidth },
          { fill: BAND_REJECT_FILL, width: CAP },
        ]
      : [
          { fill: BAND_REVIEW_FILL, width: CAP + lowWidth },
          { fill: BAND_PASS_FILL, width: coreWidth },
          { fill: BAND_REVIEW_FILL, width: CAP + highWidth },
        ]
  ).filter((s) => s.width > 0)

  return (
    <div className="grid gap-1.5">
      <div aria-hidden className="flex h-2 gap-1">
        {segments.map((s, i) => (
          <span
            key={i}
            className={cn("rounded-full", s.fill)}
            style={{ width: `${s.width}%` }}
          />
        ))}
      </div>
      <div className="grid gap-0.5 text-[11.5px] leading-snug text-ink-muted">
        <BandLegendRow swatch={BAND_PASS_FILL}>
          Passes: {bandNumber(from)}
          {to === from ? "" : ` to ${bandNumber(to)}`}
        </BandLegendRow>
        {rejects ? (
          <>
            {hasLow || hasHigh ? (
              <BandLegendRow swatch={BAND_REVIEW_FILL}>
                Your review queue:{" "}
                {hasLow ? `${bandNumber(softFrom)} to ${bandNumber(from)}` : ""}
                {hasLow && hasHigh ? " and " : ""}
                {hasHigh ? `${bandNumber(to)} to ${bandNumber(softTo)}` : ""}
              </BandLegendRow>
            ) : null}
            <BandLegendRow swatch={BAND_REJECT_FILL}>
              Rejected: under {bandNumber(softFrom)} or over{" "}
              {bandNumber(softTo)}
            </BandLegendRow>
          </>
        ) : (
          // "If not met" already parks misses for review, so every value
          // outside the ideal range shares one fate. One line says so; the
          // soft numbers change nothing in this mode and listing them would
          // draw a distinction that does not exist.
          <BandLegendRow swatch={BAND_REVIEW_FILL}>
            Your review queue: everything else
          </BandLegendRow>
        )}
      </div>
    </div>
  )
}

function BandLegendRow({
  swatch,
  children,
}: {
  swatch: string
  children: ReactNode
}) {
  return (
    <span className="flex items-start gap-1.5">
      <span
        aria-hidden
        className={cn("mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full", swatch)}
      />
      <span>{children}</span>
    </span>
  )
}
