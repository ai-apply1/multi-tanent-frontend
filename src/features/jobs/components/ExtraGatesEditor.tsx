import { FileText, GraduationCap, UserRound, Wallet } from "lucide-react"
import { ChipInput } from "@/features/jobs/components/ChipInput"
import { blurOnWheel } from "@/lib/utils"

const FIELD_CLASS =
  "h-10 w-full rounded-lg border border-[var(--field-border)] bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink-subtle focus:border-primary focus:shadow-[0_0_0_3px_var(--accent-ring)]"

const ERROR_CLASS = "mt-1.5 text-[12px] text-[var(--danger)]"

export interface ExtraGatesValue {
  universityEnabled: boolean
  universityNames: string[]
  salaryEnabled: boolean
  /** Raw input, so a half-typed number is a legal editing state. */
  salaryMax: string
}

export const emptyExtraGates = (): ExtraGatesValue => ({
  universityEnabled: false,
  universityNames: [],
  salaryEnabled: false,
  salaryMax: "",
})

/**
 * Everything wrong with the current values, as messages HR can act on.
 * Mirrors the server's 422s so the wizard blocks the step rather than bouncing
 * the whole save; the server still re-checks, since this copy is a convenience.
 */
export const validateExtraGates = (v: ExtraGatesValue): string[] => {
  const errors: string[] = []
  if (v.universityEnabled && v.universityNames.length === 0) {
    errors.push(
      "The university check is on but no universities are listed. Add at least one, or switch it off."
    )
  }
  if (v.salaryEnabled) {
    const n = Number(v.salaryMax.trim())
    if (!v.salaryMax.trim() || !Number.isFinite(n) || n < 0) {
      errors.push(
        "The expected-salary check is on but no maximum is set. Enter the most this role will pay, or switch it off."
      )
    }
  }
  return errors
}

/**
 * One switchable gate: a header row carrying the toggle, and a body that only
 * exists while the gate is on.
 *
 * Collapsing the body rather than disabling it is deliberate. A disabled input
 * still reads as "something to fill in", and these two are off for most jobs,
 * so leaving both bodies permanently on screen would make every job look
 * half-configured.
 */
function GateCard({
  icon,
  title,
  source,
  summary,
  enabled,
  onToggle,
  children,
}: {
  icon: React.ReactNode
  title: string
  /** Where the answer comes from. Fixed per gate, so it is stated, not chosen. */
  source: { icon: React.ReactNode; text: string }
  summary: string
  enabled: boolean
  onToggle: (next: boolean) => void
  children: React.ReactNode
}) {
  const id = `gate-${title.replace(/\s+/g, "-").toLowerCase()}`
  return (
    <div className="rounded-xl border border-[var(--field-border)] bg-surface-muted p-3.5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <label
            htmlFor={id}
            className="flex cursor-pointer items-center gap-2 text-[13px] font-semibold text-ink"
          >
            <input
              id={id}
              type="checkbox"
              checked={enabled}
              onChange={(e) => onToggle(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-[var(--field-border)] accent-[var(--primary)]"
            />
            {title}
          </label>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[12px] text-ink-muted">
            <span className="inline-flex items-center gap-1.5 text-ink-subtle">
              {source.icon}
              {source.text}
            </span>
            {summary}
          </p>
        </div>
      </div>
      {enabled ? <div className="mt-3 pl-11">{children}</div> : null}
    </div>
  )
}

/**
 * The job's two optional gates.
 *
 * Two FIXED gates, not a field builder. The builder this replaced let HR invent
 * any question, which meant every question carried its own answer type, answer
 * source, comparison operator and failure action, and several combinations of
 * those could not work at all. These two are the checks anyone actually asked
 * for, so each can simply say what it does.
 */
export function ExtraGatesEditor({
  value,
  onChange,
}: {
  value: ExtraGatesValue
  onChange: (next: ExtraGatesValue) => void
}) {
  const patch = (next: Partial<ExtraGatesValue>) =>
    onChange({ ...value, ...next })
  const errors = validateExtraGates(value)

  return (
    <div className="grid gap-3">
      <GateCard
        icon={<GraduationCap className="h-4 w-4" strokeWidth={1.9} />}
        title="University"
        source={{
          icon: <FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />,
          text: "Read from the CV.",
        }}
        summary="Shortlist only candidates who studied at one of the universities you list."
        enabled={value.universityEnabled}
        onToggle={(universityEnabled) => patch({ universityEnabled })}
      >
        <ChipInput
          values={value.universityNames}
          onChange={(universityNames) => patch({ universityNames })}
          maxLength={120}
          placeholder="Type a university and press Enter"
        />
        <p className="mt-1.5 text-[12px] text-ink-muted">
          Any ONE of these clears the check, so list every university you would
          accept. Spelling does not have to match the CV: the AI reads
          &ldquo;FAST&rdquo;, &ldquo;FAST-NUCES&rdquo; and the full legal name as
          one place. A CV showing a different university, or none at all, is
          rejected; one the AI cannot place goes to your review instead.
        </p>
      </GateCard>

      <GateCard
        icon={<Wallet className="h-4 w-4" strokeWidth={1.9} />}
        title="Expected salary"
        source={{
          icon: <UserRound className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />,
          text: "Asked on the application form.",
        }}
        summary="Ask candidates the least they would accept, and rule out anyone above your ceiling."
        enabled={value.salaryEnabled}
        onToggle={(salaryEnabled) => patch({ salaryEnabled })}
      >
        <label
          htmlFor="gate-salary-max"
          className="mb-1.5 block text-[12.5px] font-semibold text-ink"
        >
          The most this role will pay
        </label>
        <input
          id="gate-salary-max"
          type="number"
          min={0}
          value={value.salaryMax}
          onWheel={blurOnWheel}
          onChange={(e) => patch({ salaryMax: e.target.value })}
          placeholder="150000"
          className={`${FIELD_CLASS} max-w-[220px]`}
        />
        <p className="mt-1.5 text-[12px] text-ink-muted">
          Candidates are asked the minimum they would accept, and anyone who
          needs more than this is rejected. They never see your number.
        </p>
      </GateCard>

      {errors.length > 0 ? (
        <ul className="grid gap-1">
          {errors.map((message) => (
            <li key={message} className={ERROR_CLASS}>
              {message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
