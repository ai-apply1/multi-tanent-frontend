import { Eye } from "lucide-react"
import {
  FIELD_TYPE_LABELS,
  FILE_TYPE_LABELS,
  type ApplicationFileType,
} from "@/features/jobs/types"
import {
  type CheckDraft,
  type FormFieldDraft,
} from "@/features/jobs/components/ApplicationFormEditor"

/**
 * Live one-line-per-question summary of the apply form as the CURRENT
 * drafts would publish it: the fixed fields, HR's custom fields in their
 * order, and the dropdowns synthesized from form-sourced eligibility checks
 * — the same list the backend's `applyFormFieldsFor` builds. CV-sourced and
 * criterion checks contribute nothing, which is itself worth showing: what
 * candidates never see never lists.
 *
 * Deliberately a compact ROW LIST (the old "Always asked" section's shape),
 * not a mocked form: the wizard needs to answer "what will be asked", and a
 * pixel mock both ate a column and promised a fidelity the tenant-branded
 * careers page doesn't share.
 */

/** The two rows every form carries regardless of config: the identity pair. */
const IDENTITY_ROWS: Array<{ label: string; note: string }> = [
  { label: "Full name", note: "Short text, required" },
  { label: "Email", note: "Email, required" },
]

/** "PDF, Word (doc, docx) or Images" wording from a file field's groups. */
function fileFormatsSentence(fileTypes: ApplicationFileType[]): string {
  const labels = (fileTypes.length > 0 ? fileTypes : ["pdf"]).map(
    (g) => FILE_TYPE_LABELS[g as ApplicationFileType] ?? g,
  )
  return labels.length === 1
    ? labels[0]
    : `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`
}

interface PreviewRow {
  key: string
  label: string
  note: string
  /** Second muted line: the field's helper text, as candidates see it. */
  help?: string
  /** Full detail for a note that had to be abbreviated (title attribute). */
  noteTitle?: string
  /**
   * A question that is not asked YET but appears the moment a later step
   * enables it (the city gate). Rendered dimmed so the header's "in order"
   * claim stays honest without hiding the dependency.
   */
  ghost?: boolean
}

export function ApplyFormPreview({
  fields,
  checks,
  asksRelocation,
  asksCity,
  cityGatePossible,
  phonePolicy,
}: {
  fields: FormFieldDraft[]
  checks: CheckDraft[]
  asksRelocation: boolean
  /** City is asked exactly when the job gates on location. */
  asksCity: boolean
  /**
   * Not remote, so a city gate COULD be configured on the Eligibility step.
   * Drives the dimmed placeholder row when no city is set yet.
   */
  cityGatePossible: boolean
  phonePolicy: "required" | "optional" | "off"
}) {
  // Row order mirrors the published apply form exactly: identity, phone,
  // city (+ relocation directly under it), HR's questions, the synthesized
  // check dropdowns, and the CV upload LAST — the preview's whole job is
  // "what will be asked, in order", so the order is load-bearing.
  const rows: PreviewRow[] = [
    ...IDENTITY_ROWS.map((row) => ({ key: row.label, ...row })),
    ...(phonePolicy !== "off"
      ? [
          {
            key: "phone",
            label: "Phone number",
            note: phonePolicy === "optional" ? "Phone, optional" : "Phone, required",
          },
        ]
      : []),
    ...(asksCity
      ? [
          {
            key: "city",
            label: "City",
            note: "Required, feeds the city check",
          },
        ]
      : cityGatePossible
        ? [
            {
              key: "city-ghost",
              label: "City",
              note: "Added if you set a required city on the Eligibility step",
              ghost: true,
            },
          ]
        : []),
    ...(asksRelocation
      ? [
          {
            key: "relocate",
            label: "Would you relocate?",
            note: "Asked because the job requires a city",
          },
        ]
      : []),
    ...fields.map((f) => ({
      key: f.id,
      label: f.label.trim() || "Untitled field",
      note:
        (f.type === "file" ? "File upload" : FIELD_TYPE_LABELS[f.type]) +
        (f.required ? ", required" : ""),
      help: f.help.trim() || undefined,
      noteTitle:
        f.type === "file"
          ? `${fileFormatsSentence(f.fileTypes)}, max 10MB`
          : undefined,
    })),
    // The same synthesis the backend performs: only form-sourced LIST
    // checks whose mode has actually been chosen become questions (a
    // required dropdown of the accepted values plus "None of the above").
    ...checks
      .filter((c) => c.modeChosen && c.kind === "list" && c.source === "form")
      .map((c) => ({
        key: c.id,
        label: c.label.trim() || "Untitled check",
        note: "Dropdown, required, from your eligibility check",
      })),
    {
      key: "cv",
      label: "CV upload",
      note: "PDF, required",
    },
  ]

  // CV-side checks contribute no question, on purpose. Saying so beats a
  // silent absence, which reads as "my check did not save".
  const cvCheckCount = checks.filter(
    (c) => c.modeChosen && (c.kind === "criterion" || c.source === "cv"),
  ).length

  return (
    <div className="rounded-xl border border-[var(--field-border)] bg-surface-muted p-3.5">
      <p className="mb-2 flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
        <Eye className="h-3.5 w-3.5 text-ink-subtle" strokeWidth={1.9} />
        Live preview
        <span className="ml-auto text-[10.5px] font-normal text-ink-subtle">
          Every question candidates are asked, in order
        </span>
      </p>
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {rows.map((row) => (
          <li
            key={row.key}
            className={
              row.ghost
                ? "rounded-lg border border-dashed border-[var(--field-border)] px-3 py-2 opacity-70"
                : "rounded-lg bg-surface px-3 py-2"
            }
          >
            <span className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-[13px] font-medium text-ink">
                {row.label}
              </span>
              <span
                className="shrink-0 text-[11.5px] text-ink-subtle"
                title={row.noteTitle}
              >
                {row.note}
              </span>
            </span>
            {row.help ? (
              <span className="block truncate text-[11px] text-ink-muted">
                {row.help}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {cvCheckCount > 0 ? (
        <p className="mt-2 text-[11.5px] text-ink-muted">
          Also running in the background:{" "}
          {cvCheckCount === 1
            ? "1 CV check candidates never see."
            : `${cvCheckCount} CV checks candidates never see.`}
        </p>
      ) : null}
    </div>
  )
}
