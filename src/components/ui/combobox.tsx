import * as React from "react"
import { ChevronDown } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export interface ComboboxOption {
  value: string
  label?: string
}

export interface ComboboxProps {
  id?: string
  value: string
  onValueChange: (value: string) => void
  options: ComboboxOption[]
  placeholder?: string
  className?: string
  /** Extra classes for the inner input (e.g. `h-9` to match compact filters). */
  inputClassName?: string
  disabled?: boolean
  /** Allow committing a value not present in `options` (free-form). Default true. */
  allowCustom?: boolean
  "aria-invalid"?: boolean
}

/**
 * Free-form autocomplete: a styled text input that suggests existing `options`
 * as the admin types (or on focus), while still letting them commit a brand-new
 * value when `allowCustom` is set. Built on a plain input + an absolutely
 * positioned list (no Radix) so typing focus is never stolen. Suggestions are
 * meant to come from the server (e.g. the distinct question topic labels).
 *
 * Filtering only kicks in once the user TYPES in the current open session —
 * never against the already-committed value. Otherwise opening the picker
 * with "UTC" selected would show a one-row list and read as "there is nothing
 * else to choose"; on open the full list renders with the current selection
 * scrolled into view.
 */
export function Combobox({
  id,
  value,
  onValueChange,
  options,
  placeholder,
  className,
  inputClassName,
  disabled,
  allowCustom = true,
  "aria-invalid": ariaInvalid
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const [active, setActive] = React.useState(-1)
  /** Has the user edited the input since this open? Committed text never filters. */
  const [typedSinceOpen, setTypedSinceOpen] = React.useState(false)
  const blurTimer = React.useRef<number | null>(null)
  const listRef = React.useRef<HTMLDivElement>(null)

  const q = value.trim().toLowerCase()
  const filtered =
    typedSinceOpen && q
      ? options.filter(
          (o) =>
            o.value.toLowerCase().includes(q) ||
            (o.label ?? "").toLowerCase().includes(q)
        )
      : options
  const exact = options.some((o) => o.value.toLowerCase() === q)
  const showCustom = allowCustom && typedSinceOpen && q.length > 0 && !exact

  React.useEffect(
    () => () => {
      if (blurTimer.current) window.clearTimeout(blurTimer.current)
    },
    []
  )

  // On a fresh open the full list renders — bring the committed choice into
  // view so a long catalog (400 timezones) doesn't open at the top.
  React.useEffect(() => {
    if (!open || typedSinceOpen) return
    listRef.current
      ?.querySelector('[data-selected="true"]')
      ?.scrollIntoView({ block: "nearest" })
  }, [open, typedSinceOpen])

  const commit = (v: string) => {
    onValueChange(v)
    setOpen(false)
    setActive(-1)
  }

  // Rows the keyboard can walk: the "use custom" row (if any) then the matches.
  const rows: { value: string; custom?: boolean }[] = [
    ...(showCustom ? [{ value: value.trim(), custom: true }] : []),
    ...filtered.map((o) => ({ value: o.value }))
  ]

  return (
    <div className={cn("relative", className)}>
      <div className="relative">
        <Input
          id={id}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-invalid={ariaInvalid}
          className={cn("pr-9", inputClassName)}
          onFocus={() => {
            setOpen(true)
            setTypedSinceOpen(false)
          }}
          onChange={(e) => {
            onValueChange(e.target.value)
            setOpen(true)
            setActive(-1)
            setTypedSinceOpen(true)
          }}
          onBlur={() => {
            blurTimer.current = window.setTimeout(() => setOpen(false), 120)
          }}
          onKeyDown={(e) => {
            if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              setOpen(true)
              setTypedSinceOpen(false)
              return
            }
            if (!open) return
            if (e.key === "ArrowDown") {
              e.preventDefault()
              setActive((a) => Math.min(a + 1, rows.length - 1))
            } else if (e.key === "ArrowUp") {
              e.preventDefault()
              setActive((a) => Math.max(a - 1, 0))
            } else if (e.key === "Enter") {
              if (active >= 0 && rows[active]) {
                e.preventDefault()
                commit(rows[active].value)
              }
            } else if (e.key === "Escape") {
              setOpen(false)
              setActive(-1)
            }
          }}
        />
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      </div>

      {open && rows.length > 0 ? (
        <div
          ref={listRef}
          // Keep the input focused when clicking a row (mousedown fires first).
          onMouseDown={(e) => e.preventDefault()}
          className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {showCustom ? (
            <button
              type="button"
              onClick={() => commit(value.trim())}
              className={cn(
                "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors",
                active === 0
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <span className="text-muted-foreground">Use</span>
              <span className="font-medium">&ldquo;{value.trim()}&rdquo;</span>
            </button>
          ) : null}
          {filtered.map((o, i) => {
            const rowIndex = showCustom ? i + 1 : i
            const isSelected = o.value.toLowerCase() === q
            return (
              <button
                key={o.value}
                type="button"
                data-selected={isSelected ? "true" : undefined}
                onClick={() => commit(o.value)}
                className={cn(
                  "flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors",
                  active === rowIndex
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent hover:text-accent-foreground",
                  isSelected && "font-medium"
                )}
              >
                {o.value}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
