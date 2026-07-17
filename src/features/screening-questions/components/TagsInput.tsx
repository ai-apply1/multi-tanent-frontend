import * as React from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { TAG_MAX_LENGTH } from "@/features/screening-questions/types"

interface TagsInputProps {
  id?: string
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  /**
   * Offered as you type. The bank has no distinct-tags endpoint, so callers
   * pass the tags visible in the CURRENT result page — which is the useful
   * set anyway: under `$all` narrowing, the tags that co-occur with what's
   * already selected are exactly the ones that can still match something.
   */
  suggestions?: string[]
  disabled?: boolean
  className?: string
  "aria-invalid"?: boolean
}

/**
 * Chip input for free-form tags: type + Enter to add, Backspace on an empty
 * draft removes the last chip, click a suggestion to add it.
 *
 * Not built on `Combobox` — that primitive is single-value and reports every
 * keystroke through the same `onValueChange` as a committed pick, so it can't
 * express "this text is a draft until you commit it".
 */
export function TagsInput({
  id,
  value,
  onChange,
  placeholder,
  suggestions = [],
  disabled,
  className,
  "aria-invalid": ariaInvalid
}: TagsInputProps) {
  const [draft, setDraft] = React.useState("")
  const [open, setOpen] = React.useState(false)
  const [active, setActive] = React.useState(-1)

  const q = draft.trim().toLowerCase()
  const has = (tag: string) =>
    value.some((v) => v.toLowerCase() === tag.toLowerCase())

  const matches = suggestions
    .filter((s) => !has(s) && (q ? s.toLowerCase().includes(q) : true))
    .slice(0, 8)

  const add = (raw: string) => {
    const tag = raw.trim()
    setDraft("")
    setActive(-1)
    // Dedupe case-insensitively: two spellings of one tag is never what the
    // operator meant, and the chip list uses the tag as its React key.
    if (!tag || has(tag)) return
    onChange([...value, tag])
  }

  const removeAt = (idx: number) => onChange(value.filter((_, i) => i !== idx))

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      // Always swallow Enter: inside the form dialog it would otherwise
      // submit the whole form instead of committing the tag.
      e.preventDefault()
      add(active >= 0 && matches[active] ? matches[active] : draft)
      return
    }
    if (e.key === "Backspace" && draft.length === 0 && value.length > 0) {
      e.preventDefault()
      removeAt(value.length - 1)
      return
    }
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setOpen(true)
      setActive((a) => Math.min(a + 1, matches.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, -1))
    } else if (e.key === "Escape") {
      setOpen(false)
      setActive(-1)
    }
  }

  return (
    <div className={cn("relative", className)}>
      <div
        className={cn(
          "flex flex-wrap gap-1.5 items-center min-h-[44px] rounded-lg border border-[var(--field-border)] bg-surface px-2 py-1.5 focus-within:border-primary focus-within:shadow-[0_0_0_3px_var(--accent-ring)] transition-colors",
          disabled && "cursor-not-allowed opacity-50",
          ariaInvalid && "border-[var(--danger)]"
        )}
      >
        {value.map((tag, idx) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1.5 rounded-full bg-accent text-primary text-[12.5px] font-semibold pl-3 pr-1.5 py-1 max-w-full"
          >
            <span className="truncate" title={tag}>{tag}</span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => removeAt(idx)}
              aria-label={`Remove tag ${tag}`}
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
          maxLength={TAG_MAX_LENGTH}
          placeholder={value.length === 0 ? placeholder : undefined}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-invalid={ariaInvalid}
          className="flex-1 min-w-[120px] border-0 outline-0 bg-transparent text-[14px] text-ink placeholder:text-ink-subtle disabled:cursor-not-allowed"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setDraft(e.target.value)
            setOpen(true)
            setActive(-1)
          }}
          onBlur={() => {
            // Commit what's typed on the way out, or a tag typed but never
            // Entered is silently dropped when the user clicks Save.
            setOpen(false)
            add(draft)
          }}
          onKeyDown={handleKeyDown}
        />
      </div>

      {open && matches.length > 0 ? (
        <div
          // mousedown fires before blur — preventing it keeps focus (and the
          // draft) intact so the click below doesn't race the blur commit.
          onMouseDown={(e) => e.preventDefault()}
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-auto rounded-xl border border-line bg-surface p-1.5 shadow-[0_16px_44px_rgba(13,11,11,0.2)]"
        >
          {matches.map((tag, i) => (
            <button
              key={tag}
              type="button"
              onClick={() => add(tag)}
              className={cn(
                "flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-[13.5px] font-medium outline-none transition-colors",
                active === i
                  ? "bg-accent text-primary"
                  : "text-ink hover:bg-surface-3"
              )}
            >
              {tag}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
