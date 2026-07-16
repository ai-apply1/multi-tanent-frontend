import * as React from "react"
import { cn } from "@/lib/utils"

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>

/**
 * Multi-line input styled to match `Input`. We deliberately keep
 * `rows` configurable by the caller (default 3) and let the browser
 * handle vertical resize — most usages are short free-form notes
 * where one-or-two lines is the norm. For the AI-summary bullet
 * editor we render a textarea per bullet so a wrapped 100-char
 * sentence is fully visible without horizontal scroll, which a
 * single-line `<Input>` would force.
 */
export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, rows = 3, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        rows={rows}
        className={cn(
          "flex min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      />
    )
  }
)
Textarea.displayName = "Textarea"
