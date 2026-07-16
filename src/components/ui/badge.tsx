import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary/10 text-primary",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "text-foreground",
        success: "border-transparent bg-[color-mix(in_oklch,var(--success),white_82%)] text-[var(--success)]",
        warning: "border-transparent bg-[color-mix(in_oklch,var(--warning),white_75%)] text-[color-mix(in_oklch,var(--warning),black_30%)]",
        destructive: "border-transparent bg-destructive/10 text-destructive",
        successSolid: "border-transparent bg-[var(--success)] text-white",
        destructiveSolid: "border-transparent bg-destructive text-white",
        muted: "border-transparent bg-muted text-muted-foreground",
        purple: "border-transparent bg-purple-100 text-purple-700"
      }
    },
    defaultVariants: { variant: "default" }
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}
