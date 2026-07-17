import * as React from "react"
import { cn } from "@/lib/utils"

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      ref={ref}
      className={cn(
        "flex h-11 w-full rounded-lg border border-[var(--field-border)] bg-surface px-3.5 py-2 text-sm text-ink transition-colors placeholder:text-ink-subtle focus-visible:outline-none focus-visible:border-primary focus-visible:shadow-[0_0_0_3px_var(--accent-ring)] disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
})
Input.displayName = "Input"
