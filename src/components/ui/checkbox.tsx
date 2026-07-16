import { Check, Minus } from "lucide-react"
import { cn } from "@/lib/utils"

export interface CheckboxProps {
  /** `true` / `false` / `"indeterminate"` (the header "some selected" state). */
  checked?: boolean | "indeterminate"
  onCheckedChange?: (checked: boolean) => void
  disabled?: boolean
  className?: string
  "aria-label"?: string
  title?: string
}

/**
 * Minimal accessible checkbox — a `role="checkbox"` button so we can
 * render a tri-state (checked / unchecked / indeterminate) without a
 * Radix dependency. Used by the Applicants table's multi-select column.
 * Stops click propagation so toggling a row's box never bubbles to a
 * row-level handler.
 */
export function Checkbox({
  checked = false,
  onCheckedChange,
  disabled,
  className,
  ...props
}: CheckboxProps) {
  const isIndeterminate = checked === "indeterminate"
  const isChecked = checked === true

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={isIndeterminate ? "mixed" : isChecked}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onCheckedChange?.(!isChecked)
      }}
      className={cn(
        "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        isChecked || isIndeterminate
          ? "border-primary bg-primary text-white"
          : "border-border bg-transparent hover:border-primary/60",
        disabled && "cursor-not-allowed opacity-50",
        className
      )}
      {...props}
    >
      {isIndeterminate ? (
        <Minus className="h-3 w-3" />
      ) : isChecked ? (
        <Check className="h-3 w-3" />
      ) : null}
    </button>
  )
}
