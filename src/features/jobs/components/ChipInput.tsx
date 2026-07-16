import { useState, type KeyboardEvent } from "react"
import { X } from "lucide-react"
import { Input } from "@/components/ui/input"

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
    <div className="flex flex-col gap-2">
      {values.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {values.map((value) => (
            <span
              key={value}
              className="inline-flex h-6 max-w-56 items-center gap-1.5 rounded-md border border-primary/25 bg-primary/5 pl-2 pr-0.5 text-xs"
            >
              <span className="truncate text-foreground/90" title={value}>
                {value}
              </span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(values.filter((v) => v !== value))}
                aria-label={`Remove ${value}`}
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-primary/20 hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <Input
        id={id}
        value={draft}
        disabled={disabled}
        maxLength={maxLength}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        // Committing on blur too, so a typed-but-not-Entered value isn't
        // silently dropped when the user tabs straight to Save.
        onBlur={commit}
        placeholder={placeholder}
      />
    </div>
  )
}
