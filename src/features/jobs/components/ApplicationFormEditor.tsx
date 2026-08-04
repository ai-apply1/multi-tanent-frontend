import { useState } from "react"
import {
  AlignLeft,
  ArrowDown,
  ArrowUp,
  Calendar,
  CheckSquare,
  ChevronDown,
  FileText,
  Hash,
  Link2,
  List,
  ListChecks,
  Lock,
  Plus,
  ShieldCheck,
  Trash2,
  Type,
  UserRound,
} from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ChipInput } from "@/features/jobs/components/ChipInput"
import {
  CHECK_NONE_OPTION,
  FIELD_TYPE_LABELS,
  type ApplicationFieldType,
  type CustomCheckSource,
  type CustomRuleOnFail,
  type JobCustomCheck,
  type JobFormField,
  type JobFormFieldPayload,
} from "@/features/jobs/types"
import { cn } from "@/lib/utils"

const FIELD_CLASS =
  "h-10 w-full rounded-lg border border-[var(--field-border)] bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink-subtle focus:border-primary focus:shadow-[0_0_0_3px_var(--accent-ring)]"

const HELP_CLASS = "mt-1.5 text-[12px] text-ink-muted"

/**
 * The wizard's editing shape for one custom field. Nothing here screens
 * anyone: a field collects an answer, and what the answer MEANS is the
 * Eligibility step's Custom requirements. (Number min/max existed briefly
 * and were removed for exactly that reason — a consequential bound is a
 * rule, and a published bound leaks the threshold to candidates.)
 */
export interface FormFieldDraft {
  id: string
  type: ApplicationFieldType
  label: string
  help: string
  required: boolean
  options: string[]
}

/**
 * Mint a permanent opaque id for a new field or rule. Random, NEVER derived
 * from the label: the id keys stored answers and rule conditions forever,
 * and a label-derived id would break both the first time HR fixes a typo.
 * Matches the backend's `[A-Za-z0-9_-]{6,40}` pattern.
 */
export const mintDraftId = (prefix: string): string => {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  let random = ""
  for (const b of bytes) random += alphabet[b % alphabet.length]
  return `${prefix}_${random}`
}

export const draftsFromJob = (
  fields: JobFormField[] | undefined,
): FormFieldDraft[] =>
  (fields ?? []).map((f) => ({
    id: f.id,
    type: f.type,
    label: f.label,
    help: f.help ?? "",
    required: f.required,
    options: f.options ?? [],
  }))

const isChoiceType = (type: ApplicationFieldType): boolean =>
  type === "select" || type === "multiselect"

/**
 * Everything wrong with the drafts, as messages HR can act on. Mirrors the
 * server's 422s so the wizard blocks the step instead of bouncing the save;
 * the server still re-checks.
 */
export const validateFormFields = (drafts: FormFieldDraft[]): string[] => {
  const errors: string[] = []
  drafts.forEach((field, index) => {
    const name = field.label.trim() || `Field ${index + 1}`
    if (!field.label.trim()) {
      errors.push(`Field ${index + 1} needs a label. That is the question candidates see.`)
    }
    if (isChoiceType(field.type) && field.options.length < 2) {
      errors.push(`"${name}" needs at least two options to choose from.`)
    }
  })
  return errors
}

/** Drafts -> the exact API payload shape. Call only on validated drafts. */
export const serializeFormFields = (
  drafts: FormFieldDraft[],
): JobFormFieldPayload[] =>
  drafts.map((field) => ({
    id: field.id,
    type: field.type,
    label: field.label.trim(),
    ...(field.help.trim() ? { help: field.help.trim() } : {}),
    required: field.required,
    ...(isChoiceType(field.type) ? { options: field.options } : {}),
  }))

// ── Eligibility checks (accepted-list, CV-read or form-asked) ─────────

/**
 * The editing shape for one eligibility check. Fixed check semantics (ANY
 * ONE accepted value clears it), exactly two knobs (source, onFail) —
 * deliberately nothing else to configure, which is what keeps this from
 * being v1's per-field builder.
 */
export interface CheckDraft {
  id: string
  label: string
  acceptedValues: string[]
  source: CustomCheckSource
  onFail: CustomRuleOnFail
}

export const checksFromJob = (
  checks: JobCustomCheck[] | undefined,
): CheckDraft[] =>
  (checks ?? []).map((c) => ({
    id: c.id,
    label: c.label,
    acceptedValues: c.acceptedValues ?? [],
    source: c.source,
    onFail: c.onFail,
  }))

/** Mirrors the backend's 422s so the wizard blocks the step, not the save. */
export const validateCustomChecks = (drafts: CheckDraft[]): string[] => {
  const errors: string[] = []
  drafts.forEach((check, index) => {
    const name = check.label.trim() || `Check ${index + 1}`
    if (!check.label.trim()) {
      errors.push(
        `Check ${index + 1} needs a name for what it checks, e.g. "University" or "AWS certification".`,
      )
    }
    if (check.acceptedValues.length === 0) {
      errors.push(`"${name}" needs at least one accepted value.`)
    }
    if (
      check.acceptedValues.some(
        (v) => v.trim().toLowerCase() === CHECK_NONE_OPTION.toLowerCase(),
      )
    ) {
      errors.push(
        `"${name}" cannot accept the value "${CHECK_NONE_OPTION}". That option is added to the form automatically as the answer that does NOT meet the check.`,
      )
    }
  })
  return errors
}

/** Drafts -> the exact API payload shape. Call only on validated drafts. */
export const serializeCustomChecks = (drafts: CheckDraft[]): JobCustomCheck[] =>
  drafts.map((check) => ({
    id: check.id,
    label: check.label.trim(),
    acceptedValues: check.acceptedValues,
    source: check.source,
    onFail: check.onFail,
  }))

/** Cap mirrored from the backend DTO's `@ArrayMaxSize(10)`. */
const MAX_CHECKS = 10

const TYPE_ICONS: Record<ApplicationFieldType, React.ReactNode> = {
  text: <Type className="h-3.5 w-3.5" strokeWidth={1.9} />,
  textarea: <AlignLeft className="h-3.5 w-3.5" strokeWidth={1.9} />,
  number: <Hash className="h-3.5 w-3.5" strokeWidth={1.9} />,
  select: <List className="h-3.5 w-3.5" strokeWidth={1.9} />,
  multiselect: <ListChecks className="h-3.5 w-3.5" strokeWidth={1.9} />,
  checkbox: <CheckSquare className="h-3.5 w-3.5" strokeWidth={1.9} />,
  date: <Calendar className="h-3.5 w-3.5" strokeWidth={1.9} />,
  url: <Link2 className="h-3.5 w-3.5" strokeWidth={1.9} />,
}

const TYPE_HINTS: Record<ApplicationFieldType, string> = {
  text: "One line, e.g. current employer",
  textarea: "Long answer, e.g. a short motivation",
  number: "e.g. years with a specific tool",
  select: "One pick from your list",
  multiselect: "Several picks from your list",
  checkbox: "A yes/no confirmation",
  date: "e.g. earliest start date",
  url: "e.g. portfolio or LinkedIn",
}

const FIELD_TYPES = Object.keys(FIELD_TYPE_LABELS) as ApplicationFieldType[]

/** Cap mirrored from the backend DTO's `@ArrayMaxSize(20)`. */
const MAX_FIELDS = 20

/**
 * The fixed rows every application form starts with. Not editable and not
 * stored on the job — they are hardcoded on both sides of the wire with
 * their own columns and gates. Listed so HR sees the WHOLE form and doesn't
 * add a duplicate "Email" field.
 */
const SYSTEM_ROWS: Array<{ label: string; note: string }> = [
  { label: "Full name", note: "Short text, required" },
  { label: "Email", note: "Email, required" },
  { label: "Phone number", note: "Phone, required" },
  { label: "City", note: "Required, feeds the city check" },
  { label: "CV upload", note: "PDF, required" },
]

/**
 * The builder for `job.formFields`: the locked system rows for context, the
 * eligibility-check cards (which persist to `eligibility.customChecks`, not
 * to `formFields`), then HR's own fields as reorderable cards. One field is
 * expanded at a time (accordion); collapsed rows read as a summary line.
 *
 * Deliberately NO screening controls on the custom fields. A field is only
 * an input; the "Custom requirements" section on the Eligibility step is
 * where answers gain consequences. Keeping the two apart is the design (see
 * the backend schema comment on `JobEligibility.customRules`). The check
 * cards are the exception that proves it: each is a FIXED check whose card
 * states exactly what it does, which is why they never joined the
 * custom-field model. (The old hardcoded University and Expected-salary
 * cards were retired in favour of these: a cv-sourced check covers the
 * university list, and a number field plus a custom rule covers the salary
 * ceiling.)
 */
export function ApplicationFormEditor({
  fields,
  onChange,
  checks,
  onChecksChange,
  asksRelocation,
}: {
  fields: FormFieldDraft[]
  onChange: (next: FormFieldDraft[]) => void
  /** HR's accepted-list checks. Saved into `eligibility.customChecks`. */
  checks: CheckDraft[]
  onChecksChange: (next: CheckDraft[]) => void
  /** From the (later) eligibility step; shown here so the form reads whole. */
  asksRelocation: boolean
}) {
  const [openId, setOpenId] = useState<string | null>(null)

  const patchField = (id: string, patch: Partial<FormFieldDraft>) =>
    onChange(fields.map((f) => (f.id === id ? { ...f, ...patch } : f)))

  const addField = (type: ApplicationFieldType) => {
    const id = mintDraftId("fld")
    onChange([
      ...fields,
      { id, type, label: "", help: "", required: false, options: [] },
    ])
    setOpenId(id)
  }

  const removeField = (id: string) => {
    onChange(fields.filter((f) => f.id !== id))
    if (openId === id) setOpenId(null)
  }

  const moveField = (index: number, delta: -1 | 1) => {
    const target = index + delta
    if (target < 0 || target >= fields.length) return
    const next = [...fields]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    onChange(next)
  }

  const conditionalRows = asksRelocation
    ? [{ label: "Would you relocate?", note: "Asked because the job requires a city" }]
    : []

  return (
    <div className="grid gap-3">
      {/* The fixed half of the form. */}
      <div className="rounded-xl border border-[var(--field-border)] bg-surface-muted p-3.5">
        <p className="mb-2 flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
          <Lock className="h-3.5 w-3.5 text-ink-subtle" strokeWidth={1.9} />
          Always asked
        </p>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {[...SYSTEM_ROWS, ...conditionalRows].map((row) => (
            <li
              key={row.label}
              className="flex items-baseline justify-between gap-2 rounded-lg bg-surface px-3 py-2"
            >
              <span className="text-[13px] font-medium text-ink">
                {row.label}
              </span>
              <span className="truncate text-[11.5px] text-ink-subtle">
                {row.note}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* HR's eligibility checks, each card stating where its answer comes
          from (CV-read or form-asked). They save into
          `eligibility.customChecks`; only the editing surface lives here,
          because HR thinks of a check as part of building the application. */}
      {checks.length > 0 ? (
        <div>
          <p className="mb-2 text-[12.5px] font-semibold text-ink">
            Eligibility checks
          </p>
          <div className="grid gap-3">
            {checks.map((check, index) => (
              <CheckCard
                key={check.id}
                check={check}
                index={index}
                onPatch={(patch) =>
                  onChecksChange(
                    checks.map((c) =>
                      c.id === check.id ? { ...c, ...patch } : c,
                    ),
                  )
                }
                onRemove={() =>
                  onChecksChange(checks.filter((c) => c.id !== check.id))
                }
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* HR's own fields. */}
      {fields.map((field, index) => {
        const open = openId === field.id
        const name = field.label.trim() || "Untitled field"
        return (
          <div
            key={field.id}
            className="rounded-xl border border-[var(--field-border)] bg-surface"
          >
            <div className="flex items-center gap-2 px-3.5 py-2.5">
              <button
                type="button"
                onClick={() => setOpenId(open ? null : field.id)}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 border-0 bg-transparent p-0 text-left"
                aria-expanded={open}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
                  {TYPE_ICONS[field.type]}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] font-semibold text-ink">
                    {name}
                    {field.required ? (
                      <span className="ml-1 text-[var(--danger)]">*</span>
                    ) : null}
                  </span>
                  <span className="block text-[11.5px] text-ink-subtle">
                    {FIELD_TYPE_LABELS[field.type]}
                    {isChoiceType(field.type) && field.options.length > 0
                      ? `, ${field.options.length} options`
                      : ""}
                  </span>
                </span>
              </button>
              <div className="flex shrink-0 items-center gap-0.5">
                <IconButton
                  label={`Move "${name}" up`}
                  disabled={index === 0}
                  onClick={() => moveField(index, -1)}
                >
                  <ArrowUp className="h-3.5 w-3.5" strokeWidth={2} />
                </IconButton>
                <IconButton
                  label={`Move "${name}" down`}
                  disabled={index === fields.length - 1}
                  onClick={() => moveField(index, 1)}
                >
                  <ArrowDown className="h-3.5 w-3.5" strokeWidth={2} />
                </IconButton>
                <IconButton
                  label={`Remove "${name}"`}
                  onClick={() => removeField(field.id)}
                  danger
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                </IconButton>
                <IconButton
                  label={open ? "Collapse" : "Edit field"}
                  onClick={() => setOpenId(open ? null : field.id)}
                >
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 transition-transform",
                      open && "rotate-180",
                    )}
                    strokeWidth={2}
                  />
                </IconButton>
              </div>
            </div>

            {open ? (
              <div className="grid gap-3.5 border-t border-[var(--field-border)] px-3.5 py-3.5">
                <div className="grid gap-3.5 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor={`ff-label-${field.id}`}
                      className="mb-1.5 block text-[12.5px] font-semibold text-ink"
                    >
                      Question
                    </label>
                    <input
                      id={`ff-label-${field.id}`}
                      value={field.label}
                      maxLength={200}
                      onChange={(e) =>
                        patchField(field.id, { label: e.target.value })
                      }
                      placeholder="e.g. Do you have your own laptop?"
                      className={FIELD_CLASS}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor={`ff-help-${field.id}`}
                      className="mb-1.5 block text-[12.5px] font-semibold text-ink"
                    >
                      Helper text{" "}
                      <span className="font-normal text-ink-subtle">
                        (optional)
                      </span>
                    </label>
                    <input
                      id={`ff-help-${field.id}`}
                      value={field.help}
                      maxLength={500}
                      onChange={(e) =>
                        patchField(field.id, { help: e.target.value })
                      }
                      placeholder="Shown under the input"
                      className={FIELD_CLASS}
                    />
                  </div>
                </div>

                {isChoiceType(field.type) ? (
                  <div>
                    <label
                      htmlFor={`ff-options-${field.id}`}
                      className="mb-1.5 block text-[12.5px] font-semibold text-ink"
                    >
                      Options
                    </label>
                    <ChipInput
                      id={`ff-options-${field.id}`}
                      values={field.options}
                      onChange={(options) => patchField(field.id, { options })}
                      maxLength={120}
                      placeholder="Type an option and press Enter"
                    />
                    <p className={HELP_CLASS}>
                      {field.type === "select"
                        ? "Candidates pick exactly one."
                        : "Candidates can pick several."}
                    </p>
                  </div>
                ) : null}

                {/* No min/max inputs for number fields, on purpose: a bound
                    that disqualifies is a screening rule and belongs on the
                    Eligibility step's Custom requirements, next to what
                    happens when it is missed. */}

                <label
                  htmlFor={`ff-required-${field.id}`}
                  className="flex w-fit cursor-pointer items-center gap-2 text-[13px] font-semibold text-ink"
                >
                  <input
                    id={`ff-required-${field.id}`}
                    type="checkbox"
                    checked={field.required}
                    onChange={(e) =>
                      patchField(field.id, { required: e.target.checked })
                    }
                    className="h-3.5 w-3.5 rounded border-[var(--field-border)] accent-[var(--primary)]"
                  />
                  {field.type === "checkbox"
                    ? "Must be checked to apply"
                    : "Required to apply"}
                </label>
              </div>
            ) : null}
          </div>
        )
      })}

      {/* Add field. */}
      {fields.length < MAX_FIELDS ? (
        <div className="rounded-xl border border-dashed border-[var(--field-border)] p-3.5">
          <p className="mb-2.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
            <Plus className="h-3.5 w-3.5" strokeWidth={2.2} />
            Add a field
          </p>
          <div className="grid gap-1.5 sm:grid-cols-4">
            {FIELD_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => addField(type)}
                className="flex items-center gap-2 rounded-lg border border-line-2 bg-surface px-2.5 py-2 text-left transition-colors hover:border-primary hover:bg-accent"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent text-primary">
                  {TYPE_ICONS[type]}
                </span>
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-semibold text-ink">
                    {FIELD_TYPE_LABELS[type]}
                  </span>
                  <span className="block truncate text-[10.5px] text-ink-subtle">
                    {TYPE_HINTS[type]}
                  </span>
                </span>
              </button>
            ))}
            {/* Not a field type: adds a card to the checks group above. It
                sits in this picker because HR reaches for "add something to
                the application" here, wherever the thing ends up living. */}
            {checks.length < MAX_CHECKS ? (
              <button
                type="button"
                onClick={() => {
                  onChecksChange([
                    ...checks,
                    {
                      id: mintDraftId("chk"),
                      label: "",
                      acceptedValues: [],
                      // The conservative defaults: no LLM cost and no
                      // auto-reject until HR chooses both knobs.
                      source: "form",
                      onFail: "review",
                    },
                  ])
                }}
                className="flex items-center gap-2 rounded-lg border border-line-2 bg-surface px-2.5 py-2 text-left transition-colors hover:border-primary hover:bg-accent"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent text-primary">
                  <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.9} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-semibold text-ink">
                    Eligibility check
                  </span>
                  <span className="block truncate text-[10.5px] text-ink-subtle">
                    Accepted list, from CV or form
                  </span>
                </span>
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="text-[12px] text-ink-muted">
          This form is at the maximum of {MAX_FIELDS} custom fields.
        </p>
      )}
    </div>
  )
}

/**
 * One HR-defined eligibility check card. The source choice IS the card's
 * core control: everything else (what the source means, the "None of the
 * above" mechanics) is stated in plain copy right where it applies.
 */
function CheckCard({
  check,
  index,
  onPatch,
  onRemove,
}: {
  check: CheckDraft
  index: number
  onPatch: (patch: Partial<CheckDraft>) => void
  onRemove: () => void
}) {
  const sourceOptions: Array<{
    value: CustomCheckSource
    icon: React.ReactNode
    title: string
    note: string
  }> = [
    {
      value: "cv",
      icon: <FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />,
      title: "Read from the CV",
      note: "The AI checks the CV against your list. Candidates are not asked, and never see the list.",
    },
    {
      value: "form",
      icon: <UserRound className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />,
      title: "Asked on the application form",
      note: `Candidates pick from your list. "${CHECK_NONE_OPTION}" is added automatically and is the only answer that misses.`,
    },
  ]

  return (
    <div className="rounded-xl border border-[var(--field-border)] bg-surface-muted p-3.5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
          <ShieldCheck className="h-4 w-4" strokeWidth={1.9} />
        </span>
        <div className="min-w-0 flex-1">
          <input
            value={check.label}
            maxLength={200}
            onChange={(e) => onPatch({ label: e.target.value })}
            placeholder='What to check for, e.g. "AWS certification"'
            aria-label={`Check ${index + 1} name`}
            className={`${FIELD_CLASS} font-semibold`}
          />
        </div>
        <IconButton
          label={`Remove check ${check.label.trim() || index + 1}`}
          onClick={onRemove}
          danger
        >
          <Trash2 className="h-4 w-4" strokeWidth={2} />
        </IconButton>
      </div>

      <div className="mt-3 grid gap-2 pl-11">
        <div className="grid gap-1.5 sm:grid-cols-2">
          {sourceOptions.map((option) => {
            const active = check.source === option.value
            return (
              <label
                key={option.value}
                className={cn(
                  "flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 transition-colors",
                  active
                    ? "border-primary bg-accent"
                    : "border-line-2 bg-surface hover:bg-hover",
                )}
              >
                <input
                  type="radio"
                  name={`check-source-${check.id}`}
                  checked={active}
                  onChange={() => onPatch({ source: option.value })}
                  className="mt-1 h-3.5 w-3.5 shrink-0 accent-[var(--primary)]"
                />
                <span className="min-w-0">
                  <span
                    className={cn(
                      "flex items-center gap-1.5 text-[12.5px] font-semibold",
                      active ? "text-primary" : "text-ink",
                    )}
                  >
                    {option.icon}
                    {option.title}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-ink-muted">
                    {option.note}
                  </span>
                </span>
              </label>
            )
          })}
        </div>

        <div>
          <ChipInput
            values={check.acceptedValues}
            onChange={(acceptedValues) => onPatch({ acceptedValues })}
            maxLength={120}
            placeholder="Type an accepted value and press Enter"
          />
          <p className="mt-1.5 text-[12px] text-ink-muted">
            Any ONE of these clears the check.
            {check.source === "cv"
              ? " Spelling does not have to match the CV: the AI reads abbreviations and full names as one thing."
              : " These become the dropdown options candidates choose from."}
          </p>
        </div>

        <label className="flex w-fit items-center gap-2 text-[12.5px] font-semibold text-ink">
          If not met:
          <Select
            value={check.onFail}
            onValueChange={(onFail) =>
              onPatch({ onFail: onFail as CustomRuleOnFail })
            }
          >
            <SelectTrigger
              aria-label="What happens when this check is not met"
              className="h-9 w-[210px] rounded-lg border-[var(--field-border)] bg-surface px-3 text-[13.5px]"
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
  )
}

function IconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-subtle transition-colors hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-40",
        danger && "hover:text-[var(--danger)]",
      )}
    >
      {children}
    </button>
  )
}
