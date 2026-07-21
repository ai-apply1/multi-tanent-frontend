import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/**
 * Button variants follow the DevExcel org-portal design: pill radius,
 * 13px/600 label, tight inline-flex layout. `variant="default"` is the
 * primary blue pill; `secondary` is the white outlined pill; `ghost` is
 * a transparent accent-colored pill for inline actions.
 *
 * Sizes: `sm` = 8px 14px (list/toolbars); `default` = 10px 16px (forms,
 * page CTAs); `icon` = 38x38 square with 9px radius (top-bar controls);
 * `iconSm` = 30x30 for row-level trailing icons.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "rounded-full bg-primary text-primary-foreground border border-transparent hover:bg-[var(--accent-hover)]",
        destructive: "rounded-full bg-[var(--danger)] text-white border border-transparent hover:opacity-90",
        outline: "rounded-full bg-transparent border border-[var(--line-2)] text-[var(--ink)] hover:bg-[var(--surface-3)]",
        secondary: "rounded-full bg-[var(--surface)] text-[var(--ink)] border border-[var(--line-2)] hover:bg-[var(--surface-3)]",
        ghost: "rounded-md bg-transparent text-[var(--accent-foreground)] hover:bg-[var(--accent)]",
        danger: "rounded-full bg-[var(--surface)] text-[var(--danger)] border border-[color-mix(in_srgb,var(--danger),transparent_60%)] hover:bg-[var(--danger-soft)]",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 px-3.5 text-[12.5px]",
        lg: "h-11 px-6",
        icon: "h-9 w-9 rounded-md",
        iconSm: "h-7 w-7 rounded-md",
        iconLg: "h-10 w-10 rounded-md",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    // A native <button> with no `type` defaults to `type="submit"`, so any
    // action button dropped inside a <form> silently submits it. Default to
    // "button" and make submit an explicit opt-in. `asChild` renders an
    // arbitrary element (often an <a>), which has no submit semantics, so its
    // type is left untouched.
    const resolvedType = asChild ? type : (type ?? "button")
    return <Comp ref={ref} type={resolvedType} className={cn(buttonVariants({ variant, size, className }))} {...props} />
  }
)
Button.displayName = "Button"

export { buttonVariants }
