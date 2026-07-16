import * as React from "react"
import { X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
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
      {/* Mirrors `Input`'s box (focus-within rather than focus-visible, since
          the focused element is the naked input nested inside). */}
      <div
        className={cn(
          "flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 text-sm shadow-sm transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40",
          disabled && "cursor-not-allowed opacity-50",
          ariaInvalid && "border-destructive"
        )}
      >
        {value.map((tag, idx) => (
          <Badge key={tag} variant="secondary" className="max-w-full pr-1">
            <span className="min-w-0 truncate">{tag}</span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => removeAt(idx)}
              aria-label={`Remove tag ${tag}`}
              className="rounded-full p-0.5 text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
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
          className="h-6 min-w-24 flex-1 bg-transparent px-1 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setDraft(e.target.value)
            setOpen(true)
            setActive(-1)
          }}
          onBlur={() => {
            // Commit what's typed on the way out, or a tag typed but never
            // Entered is silently dropped when the user clicks Save.
            // Synchronous, NOT deferred: `blur` is a discrete event, so this
            // state update flushes before the `click` that caused it reaches
            // Save — a `setTimeout` here would land after submit and lose the
            // tag anyway. Nothing needs the delay: picking a suggestion below
            // preventDefaults its mousedown, so it never blurs us in the
            // first place.
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
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {matches.map((tag, i) => (
            <button
              key={tag}
              type="button"
              onClick={() => add(tag)}
              className={cn(
                "flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors",
                active === i
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent hover:text-accent-foreground"
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
