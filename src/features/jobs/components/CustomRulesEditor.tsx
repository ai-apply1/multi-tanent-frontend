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
 * The editing shape for one requirement. Condition values stay RAW strings
 * (`value`, `value2` for between's upper bound, `values` for list picks) so
 * half-typed numbers are a legal editing state; `serializeCustomRules`
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
  value: string
  value2: string
  values: string[]
}

const emptyCondition = (): ConditionDraft => ({
  fieldId: "",
  op: "",
  value: "",
  value2: "",
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
      if (Array.isArray(value) && c.op === "between") {
        return {
          fieldId: c.fieldId,
          op: c.op,
          value: String(value[0] ?? ""),
          value2: String(value[1] ?? ""),
          values: [],
        }
      }
      if (Array.isArray(value)) {
        return {
          fieldId: c.fieldId,
          op: c.op,
          value: "",
          value2: "",
          values: value.map(String),
        }
      }
      return {
        fieldId: c.fieldId,
        op: c.op,
        value: value == null ? "" : String(value),
        value2: "",
        values: [],
      }
    }),
  }))

/**
 * What kind of value control a (field type, operator) pair takes. The single
 * client-side source for both the renderer and the validator below.
 */
type ValueShape = "number" | "pair" | "option" | "optionList" | "boolean"

const valueShapeFor = (
  fieldType: FormFieldDraft["type"],
  op: CustomRuleOperator,
): ValueShape => {
  if (op === "between") return "pair"
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
): string[] => {
  const errors: string[] = []
  const fieldById = new Map(fields.map((f) => [f.id, f]))

  rules.forEach((rule, ruleIndex) => {
    const name = rule.label.trim() || `Requirement ${ruleIndex + 1}`
    if (!rule.label.trim()) {
      errors.push(
        `Requirement ${ruleIndex + 1} needs a name, e.g. "Must have own laptop".`,
      )
    }
    // One condition per field per rule, mirroring the server's 422: an AND
    // of two conditions on one field is redundant at best ("between" covers
    // a range) and impossible at worst (equals two different options).
    const seenFieldIds = new Set<string>()
    rule.conditions.forEach((condition) => {
      if (!condition.fieldId) {
        errors.push(`"${name}" has a condition with no form field picked.`)
        return
      }
      const field = fieldById.get(condition.fieldId)
      if (!field) {
        errors.push(
          `"${name}" checks a form field that is no longer on the application form. Remove that condition.`,
        )
        return
      }
      if (seenFieldIds.has(condition.fieldId)) {
        errors.push(
          `"${name}" checks ${field.label.trim() || "the same field"} twice. Combine those into one condition; for a number range, use "is between".`,
        )
        return
      }
      seenFieldIds.add(condition.fieldId)
      if (!condition.op) {
        errors.push(`"${name}" has a condition with no check picked.`)
        return
      }
      const shape = valueShapeFor(field.type, condition.op)
      const fieldName = field.label.trim() || "that field"
      if (shape === "number" && !Number.isFinite(Number(condition.value.trim() || NaN))) {
        errors.push(`"${name}" needs a number for ${fieldName}.`)
      }
      if (shape === "pair") {
        const lo = Number(condition.value.trim() || NaN)
        const hi = Number(condition.value2.trim() || NaN)
        if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
          errors.push(`"${name}" needs both ends of the range for ${fieldName}.`)
        } else if (lo > hi) {
          errors.push(`"${name}" has a range that starts above where it ends for ${fieldName}.`)
        }
      }
      if (shape === "option" && field.type !== "checkbox" && !condition.value) {
        errors.push(`"${name}" needs an option picked for ${fieldName}.`)
      }
      if (shape === "boolean" && condition.value !== "true" && condition.value !== "false") {
        errors.push(`"${name}" needs checked or unchecked picked for ${fieldName}.`)
      }
      if (shape === "optionList" && condition.values.length === 0) {
        errors.push(`"${name}" needs at least one option picked for ${fieldName}.`)
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
}: {
  rules: RuleDraft[]
  onChange: (next: RuleDraft[]) => void
  /** Current form-field drafts, for the field/operator/value pickers. */
  fields: FormFieldDraft[]
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

  if (addressable.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-[var(--field-border)] px-3.5 py-3 text-[13px] text-ink-muted">
        Requirements check answers from your application form. Add a number,
        dropdown, multiple choice or checkbox field on the Application form
        step first, then set requirements on it here.
      </p>
    )
  }

  return (
    <div className="grid gap-3">
      {rules.map((rule, ruleIndex) => (
        <div
          key={rule.id}
          className="rounded-xl border border-[var(--field-border)] bg-surface-muted p-3.5"
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
              return (
                <div
                  key={index}
                  className="flex flex-wrap items-center gap-2 rounded-lg bg-surface p-2"
                >
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
                        value: "",
                        value2: "",
                        values: [],
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
                          type is actually being chosen between. */}
                      <SelectValue placeholder="Pick a form field…">
                        {field ? field.label.trim() || "Untitled field" : null}
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
                        const shapeChanged =
                          condition.op === "" ||
                          valueShapeFor(field.type, nextOp) !==
                            valueShapeFor(
                              field.type,
                              condition.op as CustomRuleOperator,
                            )
                        patchCondition(
                          rule.id,
                          index,
                          shapeChanged
                            ? { op: nextOp, value: "", value2: "", values: [] }
                            : { op: nextOp },
                        )
                      }}
                    >
                      <SelectTrigger
                        aria-label="Check"
                        className={`${SELECT_TRIGGER_CLASS} w-[150px]`}
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

                  {/* Value */}
                  {field && condition.op ? (
                    <ConditionValueControl
                      field={field}
                      condition={condition}
                      onPatch={(patch) => patchCondition(rule.id, index, patch)}
                    />
                  ) : null}

                  {rule.conditions.length > 1 ? (
                    <button
                      type="button"
                      aria-label="Remove this condition"
                      title="Remove this condition"
                      onClick={() =>
                        patchRule(rule.id, {
                          conditions: rule.conditions.filter(
                            (_, i) => i !== index,
                          ),
                        })
                      }
                      className="ml-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-subtle transition-colors hover:bg-hover hover:text-[var(--danger)]"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                  ) : null}
                </div>
              )
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2.5">
            {/* Also capped by the number of addressable fields: each condition
                claims one field, so once every field is checked a new
                condition could only open an empty picker. */}
            {rule.conditions.length < MAX_CONDITIONS &&
            rule.conditions.length < addressable.length ? (
              <button
                type="button"
                onClick={() =>
                  patchRule(rule.id, {
                    conditions: [...rule.conditions, emptyCondition()],
                  })
                }
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12.5px] font-semibold text-primary transition-colors hover:bg-accent"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2.2} />
                And also…
              </button>
            ) : (
              <span />
            )}
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
                  className={`${SELECT_TRIGGER_CLASS} h-9 w-[210px]`}
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

      {rules.length < MAX_RULES ? (
        <button
          type="button"
          onClick={() => onChange([...rules, emptyRule()])}
          className="flex w-fit items-center gap-1.5 rounded-lg border border-dashed border-[var(--field-border)] px-3 py-2 text-[13px] font-semibold text-ink-2 transition-colors hover:border-primary hover:bg-accent hover:text-primary"
        >
          <Plus className="h-4 w-4" strokeWidth={2.2} />
          Add a requirement
        </button>
      ) : null}

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

/** The right-hand value input, shaped by the field type + operator. */
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
        className={cn(FIELD_CLASS, "w-[110px]")}
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
          className={cn(FIELD_CLASS, "w-[92px]")}
        />
        <span className="text-[12px] text-ink-subtle">and</span>
        <input
          type="number"
          value={condition.value2}
          onWheel={blurOnWheel}
          onChange={(e) => onPatch({ value: e.target.value })}
          aria-label="To"
          placeholder="To"
          className={cn(FIELD_CLASS, "w-[92px]")}
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
