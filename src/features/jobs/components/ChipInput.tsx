import { useState, type KeyboardEvent } from "react"
import { X } from "lucide-react"

interface ChipInputProps {
  id?: string
  values: string[]
  onChange: (values: string[]) => void
  placeholder?: string
  /** Per-chip cap; mirrors the backend's `@MaxLength(…, { each: true })`. */
  maxLength?: number
  disabled?: boolean
}

/**
 * Type-and-Enter chip editor for a `string[]` field (the job's required
 * skills). Backspace on an empty box removes the last chip; entries are
 * deduped case-insensitively but stored with the casing the user typed.
 */
export function ChipInput({
  id,
  values,
  onChange,
  placeholder,
  maxLength = 100,
  disabled,
}: ChipInputProps) {
  const [draft, setDraft] = useState("")

  const commit = () => {
    const value = draft.trim()
    if (!value) return
    const exists = values.some((v) => v.toLowerCase() === value.toLowerCase())
    if (!exists) onChange([...values, value.slice(0, maxLength)])
    setDraft("")
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      // The chip box lives inside a <form>; Enter must add a chip, not submit.
      e.preventDefault()
      commit()
      return
    }
    if (e.key === "Backspace" && draft.length === 0 && values.length > 0) {
      onChange(values.slice(0, -1))
    }
  }

  return (
    <div className="flex flex-wrap gap-1.5 items-center min-h-[44px] rounded-lg border border-[var(--field-border)] bg-surface px-2 py-1.5 focus-within:border-primary focus-within:shadow-[0_0_0_3px_var(--accent-ring)] transition-colors">
      {values.map((value) => (
        <span
          key={value}
          className="inline-flex items-center gap-1.5 rounded-full bg-accent text-primary text-[12.5px] font-semibold pl-3 pr-1.5 py-1 max-w-full"
        >
          <span className="truncate" title={value}>
            {value}
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(values.filter((v) => v !== value))}
            aria-label={`Remove ${value}`}
            className="inline-flex h-4 w-4 items-center justify-center rounded-full text-primary hover:bg-primary/10 disabled:cursor-not-allowed"
          >
            <X className="h-3 w-3" strokeWidth={2} />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        disabled={disabled}
        maxLength={maxLength}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        // Committing on blur too, so a typed-but-not-Entered value isn't
        // silently dropped when the user tabs straight to Save.
        onBlur={commit}
        placeholder={values.length === 0 ? placeholder : undefined}
        className="flex-1 min-w-[120px] border-0 outline-0 bg-transparent text-[14px] text-ink placeholder:text-ink-subtle disabled:cursor-not-allowed"
      />
    </div>
  )
}
