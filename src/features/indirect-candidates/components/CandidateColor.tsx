import { Check } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  ACTIVE_CANDIDATE_COLORS,
  COLOR_LABELS,
  type ActiveCandidateColor
} from "@/features/indirect-candidates/types"

/** Tailwind fill class per triage color (Apple Files/Finder tag palette). */
export const COLOR_DOT_CLASS: Record<ActiveCandidateColor, string> = {
  red: "bg-red-500",
  orange: "bg-orange-500",
  yellow: "bg-yellow-400",
  green: "bg-emerald-500",
  blue: "bg-blue-500",
  purple: "bg-purple-500",
  gray: "bg-gray-400"
}

/**
 * The colored dot shown before a candidate's name. A `null` color renders a
 * hollow ring so an uncolored candidate still has a consistent, clickable
 * target for the inline picker.
 */
export function CandidateColorDot({
  color,
  className
}: {
  color: ActiveCandidateColor | null
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block h-2.5 w-2.5 shrink-0 rounded-full",
        color ? COLOR_DOT_CLASS[color] : "border border-muted-foreground/40",
        className
      )}
    />
  )
}

/**
 * A row of selectable color swatches (None + green / yellow / red). Shared by
 * the create/edit/activate dialog and the roster's inline recolor popover, so
 * both surfaces offer the identical choice set. `onSelect(null)` clears the
 * color.
 */
export function ColorSwatchPicker({
  value,
  onSelect,
  disabled
}: {
  value: ActiveCandidateColor | null
  onSelect: (color: ActiveCandidateColor | null) => void
  disabled?: boolean
}) {
  const optionClass = (selected: boolean) =>
    cn(
      "flex h-8 w-8 items-center justify-center rounded-full border transition",
      selected ? "border-foreground" : "border-transparent hover:border-border",
      disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
    )

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSelect(null)}
        title="No color"
        aria-label="No color"
        aria-pressed={value === null}
        className={optionClass(value === null)}
      >
        <span className="flex h-4 w-4 items-center justify-center rounded-full border border-muted-foreground/40">
          {value === null ? <Check className="h-3 w-3" /> : null}
        </span>
      </button>
      {ACTIVE_CANDIDATE_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(color)}
          title={COLOR_LABELS[color]}
          aria-label={COLOR_LABELS[color]}
          aria-pressed={value === color}
          className={optionClass(value === color)}
        >
          <span
            className={cn(
              "flex h-4 w-4 items-center justify-center rounded-full text-white",
              COLOR_DOT_CLASS[color]
            )}
          >
            {value === color ? <Check className="h-3 w-3" /> : null}
          </span>
        </button>
      ))}
    </div>
  )
}
