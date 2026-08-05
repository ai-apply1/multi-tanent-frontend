import { useState } from "react"
import {
  AlignLeft,
  ArrowDown,
  ArrowUp,
  Calendar,
  CheckSquare,
  ChevronDown,
  FileText,
  FileUp,
  Hash,
  Link2,
  List,
  ListChecks,
  Plus,
  ShieldCheck,
  Sparkles,
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
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { ChipInput } from "@/features/jobs/components/ChipInput"
import {
  CHECK_NONE_OPTION,
  FIELD_TYPE_LABELS,
  FILE_TYPE_LABELS,
  RULE_OPERATORS_BY_FIELD_TYPE,
  type ApplicationFieldType,
  type ApplicationFileType,
  type CustomCheckKind,
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

/** "Common setups" one-click preset chips in the add box. */
const PRESET_CHIP_CLASS =
  "rounded-full border border-line-2 bg-surface px-2.5 py-1 text-[12px] font-semibold text-ink-2 transition-colors hover:border-primary hover:bg-accent hover:text-primary"

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
  /** `file` fields only: accepted format groups. Empty = PDF. */
  fileTypes: ApplicationFileType[]
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
    fileTypes: f.fileTypes ?? [],
  }))

const isChoiceType = (type: ApplicationFieldType): boolean =>
  type === "select" || type === "multiselect"

/**
 * One wizard validation finding, anchored to the card it is about so the
 * error list can scroll to, open, and outline the offender instead of
 * leaving HR to hunt for it. `stepValid` only reads `.length`.
 */
export interface DraftError {
  cardId: string
  message: string
}

/**
 * Everything wrong with the drafts, as messages HR can act on. Mirrors the
 * server's 422s so the wizard blocks the step instead of bouncing the save;
 * the server still re-checks.
 */
export const validateFormFields = (drafts: FormFieldDraft[]): DraftError[] => {
  const errors: DraftError[] = []
  drafts.forEach((field, index) => {
    const name = field.label.trim() || `Field ${index + 1}`
    if (!field.label.trim()) {
      errors.push({
        cardId: field.id,
        message: `Field ${index + 1} needs a label. That is the question candidates see.`,
      })
    }
    if (isChoiceType(field.type) && field.options.length < 2) {
      errors.push({
        cardId: field.id,
        message: `"${name}" needs at least two options to choose from.`,
      })
    }
    if (field.type === "file" && field.fileTypes.length === 0) {
      errors.push({
        cardId: field.id,
        message: `"${name}" needs at least one accepted file format.`,
      })
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
    ...(field.type === "file" ? { fileTypes: field.fileTypes } : {}),
  }))

// ── Eligibility checks (accepted-list, CV-read or form-asked) ─────────

/**
 * The editing shape for one eligibility check. Two fixed shapes (an
 * accepted list, or one criterion sentence the AI judges the CV against)
 * and two knobs (source, onFail) — deliberately nothing else to configure,
 * which is what keeps this from being v1's per-field builder or a free
 * prompt box.
 *
 * The UI folds kind+source into ONE three-way mode choice (list+cv,
 * list+form, criterion+cv), because criterion is cv-only and showing two
 * axes would offer an impossible combination.
 */
export interface CheckDraft {
  id: string
  label: string
  kind: CustomCheckKind
  acceptedValues: string[]
  criterion: string
  source: CustomCheckSource
  onFail: CustomRuleOnFail
  /**
   * Draft-only: has HR explicitly picked one of the three modes? A fresh
   * check starts with NO mode, because the old silent default ("asked on
   * the form") published the screening list as a dropdown when HR never
   * touched the radio. Never serialized; loaded checks chose long ago.
   */
  modeChosen: boolean
}

export const checksFromJob = (
  checks: JobCustomCheck[] | undefined,
): CheckDraft[] =>
  (checks ?? []).map((c) => ({
    id: c.id,
    label: c.label,
    kind: c.kind ?? "list",
    acceptedValues: c.acceptedValues ?? [],
    criterion: c.criterion ?? "",
    source: c.source,
    onFail: c.onFail,
    modeChosen: true,
  }))

/** Mirrors the backend's 422s so the wizard blocks the step, not the save. */
export const validateCustomChecks = (drafts: CheckDraft[]): DraftError[] => {
  const errors: DraftError[] = []
  drafts.forEach((check, index) => {
    const name = check.label.trim() || `Check ${index + 1}`
    if (!check.label.trim()) {
      errors.push({
        cardId: check.id,
        message: `Check ${index + 1} needs a name for what it checks, e.g. "University" or "Team leadership".`,
      })
    }
    if (!check.modeChosen) {
      errors.push({
        cardId: check.id,
        message: `Choose where "${name}" gets its answer: read from the CV, or asked on the application form.`,
      })
      return
    }
    if (check.kind === "criterion") {
      if (!check.criterion.trim()) {
        errors.push({
          cardId: check.id,
          message: `"${name}" needs its criterion sentence, e.g. "Has led a team of 3 or more people".`,
        })
      } else if (check.criterion.includes("___")) {
        // A starter chip's fill-in-the-blank token: the sentence is not a
        // real requirement until the blank is filled, and the AI would be
        // asked to judge a CV against a literal "___".
        errors.push({
          cardId: check.id,
          message: `"${name}" still has a blank (___) in its sentence. Fill it in.`,
        })
      }
      return
    }
    if (check.acceptedValues.length === 0) {
      errors.push({
        cardId: check.id,
        message: `"${name}" needs at least one accepted value.`,
      })
    }
    if (
      check.acceptedValues.some(
        (v) => v.trim().toLowerCase() === CHECK_NONE_OPTION.toLowerCase(),
      )
    ) {
      errors.push({
        cardId: check.id,
        message: `"${name}" cannot accept the value "${CHECK_NONE_OPTION}". That option is added to the form automatically as the answer that does NOT meet the check.`,
      })
    }
  })
  return errors
}

/** Drafts -> the exact API payload shape. Call only on validated drafts. */
export const serializeCustomChecks = (drafts: CheckDraft[]): JobCustomCheck[] =>
  drafts.map((check) =>
    check.kind === "criterion"
      ? {
          id: check.id,
          label: check.label.trim(),
          kind: "criterion",
          acceptedValues: [],
          criterion: check.criterion.trim(),
          // Backend invariant: a criterion is always read from the CV.
          source: "cv",
          onFail: check.onFail,
        }
      : {
          id: check.id,
          label: check.label.trim(),
          kind: "list",
          acceptedValues: check.acceptedValues,
          source: check.source,
          onFail: check.onFail,
        },
  )

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
  file: <FileUp className="h-3.5 w-3.5" strokeWidth={1.9} />,
}

const TYPE_HINTS: Record<ApplicationFieldType, string> = {
  text: "One line, e.g. current employer",
  textarea: "Long answer, e.g. motivation",
  number: "e.g. years with a specific tool",
  select: "One pick from your list",
  multiselect: "Several picks from your list",
  checkbox: "A yes/no confirmation",
  date: "e.g. earliest start date",
  url: "e.g. portfolio or LinkedIn",
  file: "Extra document, your formats",
}

const FIELD_TYPES = Object.keys(FIELD_TYPE_LABELS) as ApplicationFieldType[]

/** Cap mirrored from the backend DTO's `@ArrayMaxSize(20)`. */
const MAX_FIELDS = 20

/**
 * The builder for `job.formFields`: the eligibility-check cards (which
 * persist to `eligibility.customChecks`, not to `formFields`), then HR's
 * own fields as reorderable cards. One field is expanded at a time
 * (accordion); collapsed rows read as a summary line. The FIXED half of the
 * form (name, email, phone, city, CV, the relocation conditional) is not
 * listed here — the live preview beside this editor shows the whole form,
 * fixed rows included, so a second static list would say it twice.
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
  ruleLabelsByFieldId,
  onGoToEligibility,
  openFieldId,
  onOpenFieldChange,
  errorCardIds,
}: {
  fields: FormFieldDraft[]
  onChange: (next: FormFieldDraft[]) => void
  /** HR's accepted-list checks. Saved into `eligibility.customChecks`. */
  checks: CheckDraft[]
  onChecksChange: (next: CheckDraft[]) => void
  /**
   * Which Eligibility-step requirements reference each field, so a
   * rule-addressable field's card can say whether its answer screens
   * anyone yet (and deleting it can warn). Derived from the rules state
   * the wizard owns.
   */
  ruleLabelsByFieldId?: Map<string, string[]>
  /** Jump the wizard to the Eligibility step (cross-step guidance links). */
  onGoToEligibility?: () => void
  /**
   * The accordion cursor, owned by the step so a clicked validation error
   * can open the offending card from outside this component.
   */
  openFieldId: string | null
  onOpenFieldChange: (id: string | null) => void
  /** Cards the step's validators flagged: outlined in the danger colour. */
  errorCardIds?: Set<string>
}) {
  const openId = openFieldId
  const setOpenId = onOpenFieldChange
  // A delete that would orphan an Eligibility-step requirement asks first;
  // unreferenced fields keep the one-click delete.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  const patchField = (id: string, patch: Partial<FormFieldDraft>) =>
    onChange(fields.map((f) => (f.id === id ? { ...f, ...patch } : f)))

  const addCheck = (preset?: Partial<CheckDraft>) =>
    onChecksChange([
      ...checks,
      {
        id: mintDraftId("chk"),
        label: "",
        kind: "list",
        acceptedValues: [],
        criterion: "",
        // No silent mode: the card asks for an explicit read-from-CV vs
        // asked-on-form choice before it does anything. onFail stays the
        // conservative default (review, never auto-reject) either way.
        source: "form",
        onFail: "review",
        modeChosen: false,
        ...preset,
      },
    ])

  const addField = (type: ApplicationFieldType) => {
    const id = mintDraftId("fld")
    onChange([
      ...fields,
      {
        id,
        type,
        label: "",
        help: "",
        required: false,
        options: [],
        // PDF pre-checked so a fresh file field is valid out of the box.
        fileTypes: type === "file" ? ["pdf"] : [],
      },
    ])
    setOpenId(id)
  }

  const removeField = (id: string) => {
    onChange(fields.filter((f) => f.id !== id))
    if (openId === id) setOpenId(null)
  }

  const requestRemoveField = (id: string) => {
    if ((ruleLabelsByFieldId?.get(id) ?? []).length > 0) {
      setPendingDeleteId(id)
      return
    }
    removeField(id)
  }

  const pendingDeleteRuleLabels = pendingDeleteId
    ? (ruleLabelsByFieldId?.get(pendingDeleteId) ?? [])
    : []

  const moveField = (index: number, delta: -1 | 1) => {
    const target = index + delta
    if (target < 0 || target >= fields.length) return
    const next = [...fields]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    onChange(next)
  }

  return (
    <div className="grid gap-3">
      {/* HR's eligibility checks, each card stating where its answer comes
          from (CV-read or form-asked). They save into
          `eligibility.customChecks`; only the editing surface lives here,
          because HR thinks of a check as part of building the application.
          The header renders even with zero checks: a first-time user needs
          to see the concept exists before they can go looking for it. */}
      <div>
        <p className="mb-2 text-[12.5px] font-semibold text-ink">
          Eligibility checks
        </p>
        {checks.length > 0 ? (
          <div className="grid gap-3">
            {checks.map((check, index) => (
              <CheckCard
                key={check.id}
                check={check}
                index={index}
                hasError={errorCardIds?.has(check.id) ?? false}
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
        ) : (
          <p className="text-[12px] text-ink-muted">
            No checks yet. A check can read the CV silently, or add one
            dropdown question to the form. Add one below.
          </p>
        )}
      </div>

      {/* HR's own fields. */}
      {fields.map((field, index) => {
        const open = openId === field.id
        const name = field.label.trim() || "Untitled field"
        return (
          <div
            key={field.id}
            id={`card-${field.id}`}
            className={cn(
              "rounded-xl border border-[var(--field-border)] bg-surface",
              errorCardIds?.has(field.id) && "border-[var(--danger)]",
            )}
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
                  onClick={() => requestRemoveField(field.id)}
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

                {field.type === "file" ? (
                  <div>
                    <p className="mb-1.5 text-[12.5px] font-semibold text-ink">
                      Accepted formats
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {(
                        Object.keys(FILE_TYPE_LABELS) as ApplicationFileType[]
                      ).map((group) => {
                        const picked = field.fileTypes.includes(group)
                        return (
                          <label
                            key={group}
                            className={cn(
                              "flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-semibold transition-colors",
                              picked
                                ? "border-primary bg-accent text-primary"
                                : "border-line-2 bg-surface text-ink-2 hover:bg-hover",
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={picked}
                              onChange={() =>
                                patchField(field.id, {
                                  fileTypes: picked
                                    ? field.fileTypes.filter(
                                        (g) => g !== group,
                                      )
                                    : [...field.fileTypes, group],
                                })
                              }
                              className="sr-only"
                            />
                            {FILE_TYPE_LABELS[group]}
                          </label>
                        )
                      })}
                    </div>
                    <p className={HELP_CLASS}>
                      Candidates can attach one file in any format you tick
                      (max 10MB). It is stored for your team to download; the
                      AI does not read it.
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

                {/* Screening status for the types a requirement can gate on:
                    without this line the answer's consequence (or lack of
                    one) is invisible until the Eligibility step. */}
                {(RULE_OPERATORS_BY_FIELD_TYPE[field.type] ?? []).length >
                0 ? (
                  <p className="border-t border-[var(--field-border)] pt-2.5 text-[12px] text-ink-muted">
                    {(ruleLabelsByFieldId?.get(field.id) ?? []).length > 0 ? (
                      <>
                        Screened by{" "}
                        {(ruleLabelsByFieldId?.get(field.id) ?? [])
                          .map((label) => `"${label.trim() || "Untitled"}"`)
                          .join(", ")}{" "}
                        on the Eligibility step.
                      </>
                    ) : (
                      <>
                        Answers are collected only. To screen on this answer,
                        add a requirement on the{" "}
                        {onGoToEligibility ? (
                          <button
                            type="button"
                            onClick={onGoToEligibility}
                            className="font-semibold text-primary hover:underline"
                          >
                            Eligibility step
                          </button>
                        ) : (
                          "Eligibility step"
                        )}
                        .
                      </>
                    )}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        )
      })}

      {/* Add field / check. The box always renders: checks have their own
          cap and their own storage (eligibility.customChecks), so hitting
          the FIELD cap must not take away the only door to adding a check. */}
      <div className="rounded-xl border border-dashed border-[var(--field-border)] p-3.5">
          <p className="mb-2.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
            <Plus className="h-3.5 w-3.5" strokeWidth={2.2} />
            Add a field or an eligibility check
          </p>
          {fields.length < MAX_FIELDS ? (
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
                    <span className="block text-[10.5px] leading-tight text-ink-subtle">
                      {TYPE_HINTS[type]}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-ink-muted">
              This form is at the maximum of {MAX_FIELDS} custom fields.
              Eligibility checks can still be added below.
            </p>
          )}

          {/* Not a field type: adds a card to the checks group above. Its own
              full-width row, NOT a tenth look-alike tile: this button is the
              only door to the read-from-CV vs ask-on-form choice, and buried
              in the grid it was routinely missed (a Number question plus a
              requirement got built instead, and published to candidates). */}
          {checks.length < MAX_CHECKS ? (
            <button
              type="button"
              onClick={() => addCheck()}
              className="mt-2 flex w-full items-center gap-2.5 rounded-lg border border-primary/40 bg-accent px-3 py-2.5 text-left transition-colors hover:border-primary"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface text-primary">
                <ShieldCheck className="h-4 w-4" strokeWidth={1.9} />
              </span>
              <span className="min-w-0">
                <span className="block text-[12.5px] font-semibold text-primary">
                  Eligibility check
                </span>
                <span className="block text-[11px] leading-snug text-ink-muted">
                  Screen on something specific: the AI reads it from the CV,
                  or candidates pick from a list you define. CV checks are
                  never shown to candidates.
                </span>
              </span>
            </button>
          ) : null}

          {/* One-click presets for the setups HR asks for most. Each mints
              the correctly wired config so nobody has to re-derive the
              field-vs-check taxonomy on their first job. */}
          {checks.length < MAX_CHECKS ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <span className="text-[11.5px] font-semibold text-ink-subtle">
                Common setups:
              </span>
              <button
                type="button"
                onClick={() =>
                  addCheck({
                    label: "Minimum experience",
                    kind: "criterion",
                    source: "cv",
                    criterion:
                      "Has at least 3 years of relevant work experience.",
                    modeChosen: true,
                  })
                }
                className={PRESET_CHIP_CLASS}
              >
                Minimum experience
              </button>
              <button
                type="button"
                onClick={() =>
                  addCheck({
                    label: "Certification",
                    kind: "list",
                    source: "cv",
                    modeChosen: true,
                  })
                }
                className={PRESET_CHIP_CLASS}
              >
                Certification required
              </button>
            </div>
          ) : null}
      </div>

      <ConfirmDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => !open && setPendingDeleteId(null)}
        title="Delete a screened question?"
        description={
          pendingDeleteRuleLabels.length === 1
            ? `This question is used by the requirement "${pendingDeleteRuleLabels[0].trim() || "Untitled"}" on the Eligibility step. Deleting it breaks that requirement until you remove or repoint it.`
            : `This question is used by ${pendingDeleteRuleLabels.length} requirements on the Eligibility step. Deleting it breaks them until you remove or repoint them.`
        }
        confirmLabel="Delete anyway"
        destructive
        onConfirm={() => {
          if (pendingDeleteId) removeField(pendingDeleteId)
          setPendingDeleteId(null)
        }}
      />
    </div>
  )
}

/**
 * One HR-defined eligibility check card. The three-way MODE choice is the
 * card's core control (it folds kind+source into one picker, since a
 * criterion is cv-only and two separate axes would offer an impossible
 * combination); everything else (what each mode means, the "None of the
 * above" mechanics) is stated in plain copy right where it applies.
 */
type CheckMode = "cv-list" | "form-list" | "criterion"

const checkModeOf = (check: CheckDraft): CheckMode =>
  check.kind === "criterion"
    ? "criterion"
    : check.source === "form"
      ? "form-list"
      : "cv-list"

const CHECK_MODE_PATCH: Record<CheckMode, Partial<CheckDraft>> = {
  "cv-list": { kind: "list", source: "cv", modeChosen: true },
  "form-list": { kind: "list", source: "form", modeChosen: true },
  criterion: { kind: "criterion", source: "cv", modeChosen: true },
}

/** Fill-in-the-blank starters for the criterion sentence. */
const CRITERION_STARTERS = [
  "Has at least 3 years of relevant work experience.",
  "Holds a certification in ___.",
  "Has led a team of 3 or more people.",
] as const

function CheckCard({
  check,
  index,
  hasError,
  onPatch,
  onRemove,
}: {
  check: CheckDraft
  index: number
  /** Flagged by the step's validators: outlined in the danger colour. */
  hasError: boolean
  onPatch: (patch: Partial<CheckDraft>) => void
  onRemove: () => void
}) {
  const mode = checkModeOf(check)
  const modeOptions: Array<{
    value: CheckMode
    icon: React.ReactNode
    title: string
    note: string
  }> = [
    {
      value: "cv-list",
      icon: <FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />,
      title: "Read from the CV",
      note: "The AI checks the CV against your list. Candidates are not asked, and never see the list.",
    },
    {
      value: "form-list",
      icon: <UserRound className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />,
      title: "Asked on the application form",
      note: `Candidates pick from your list. "${CHECK_NONE_OPTION}" is added automatically and is the only answer that misses.`,
    },
    {
      value: "criterion",
      icon: <Sparkles className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />,
      title: "AI judges the CV",
      note: "Write the requirement as one plain sentence. The AI answers yes, no or unsure with a quote from the CV; unsure goes to your review queue.",
    },
  ]

  return (
    <div
      id={`card-${check.id}`}
      className={cn(
        "rounded-xl border border-[var(--field-border)] bg-surface-muted p-3.5",
        hasError && "border-[var(--danger)]",
      )}
    >
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
        <div className="grid gap-1.5 sm:grid-cols-3">
          {modeOptions.map((option) => {
            const active = check.modeChosen && mode === option.value
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
                  name={`check-mode-${check.id}`}
                  checked={active}
                  onChange={() => onPatch(CHECK_MODE_PATCH[option.value])}
                  className="mt-1 h-3.5 w-3.5 shrink-0 accent-[var(--primary)]"
                />
                <span className="min-w-0">
                  <span
                    className={cn(
                      // items-start + a nudge on the icon, not items-center:
                      // a title that wraps on a narrow card would otherwise
                      // float the icon between its two lines.
                      "flex items-start gap-1.5 text-[12.5px] font-semibold leading-snug",
                      active ? "text-primary" : "text-ink",
                    )}
                  >
                    <span className="mt-px shrink-0">{option.icon}</span>
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

        {!check.modeChosen ? (
          <p className="text-[12px] text-ink-muted">
            Pick how this check gets its answer to set it up.
          </p>
        ) : (
          <>
            {mode === "form-list" ? (
              <p className="text-[12px] text-ink-muted">
                Candidates see the name above as the question over the
                dropdown, so word it the way you would ask it.
              </p>
            ) : null}

            {mode === "criterion" ? (
              <div>
                <input
                  id={`chk-criterion-${check.id}`}
                  value={check.criterion}
                  maxLength={300}
                  onChange={(e) => onPatch({ criterion: e.target.value })}
                  placeholder='e.g. "Has led a team of 3 or more people"'
                  aria-label={`Check ${index + 1} criterion`}
                  className={FIELD_CLASS}
                />
                <p className="mt-1.5 text-[12px] text-ink-muted">
                  One plain sentence. The AI looks for concrete evidence of it
                  on the CV and quotes what it found, so you can audit every
                  verdict in the candidate drawer.
                </p>
                {!check.criterion.trim() ? (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11.5px] font-semibold text-ink-subtle">
                      Starters:
                    </span>
                    {CRITERION_STARTERS.map((starter) => (
                      <button
                        key={starter}
                        type="button"
                        onClick={() => {
                          onPatch({ criterion: starter })
                          // Hand the caret to the sentence (selecting the
                          // blank if the starter has one) so "click, then
                          // edit the blank" is one motion, not two.
                          requestAnimationFrame(() => {
                            const input = document.getElementById(
                              `chk-criterion-${check.id}`,
                            ) as HTMLInputElement | null
                            if (!input) return
                            input.focus()
                            const blank = starter.indexOf("___")
                            if (blank >= 0) {
                              input.setSelectionRange(blank, blank + 3)
                            }
                          })
                        }}
                        className={PRESET_CHIP_CLASS}
                      >
                        {starter}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
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
            )}

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
                  className="h-9 w-[230px] rounded-lg border-[var(--field-border)] bg-surface px-3 text-[13.5px]"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="review">
                    Send to my review queue
                  </SelectItem>
                  <SelectItem value="reject">Reject automatically</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </>
        )}
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
