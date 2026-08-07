import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { cva, type VariantProps } from "class-variance-authority"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

export const Sheet = DialogPrimitive.Root
export const SheetTrigger = DialogPrimitive.Trigger
export const SheetClose = DialogPrimitive.Close
export const SheetPortal = DialogPrimitive.Portal

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out",
      className
    )}
    {...props}
  />
))
SheetOverlay.displayName = DialogPrimitive.Overlay.displayName

const sheetVariants = cva(
  // The slide lives on the Content node (Radix owns its `data-state` and its
  // Presence waits on THIS node's exit animation before unmounting) so the
  // panel animates both in and out. Backdrop fades on the sibling overlay.
  //
  // `focus:outline-none` is load-bearing, not cosmetic. This node carries
  // `tabindex="-1"` and Radix's FocusScope parks focus on it whenever the
  // element that HAD focus stops being focusable (a control that disables
  // itself mid-request is the common one). Focus lands here programmatically,
  // but the browser still honours the LAST INPUT MODALITY — so after a
  // keyboard submit `:focus-visible` matches and Chrome rings the entire
  // panel. `react-menu`/`react-select` set `outline: none` inline for exactly
  // this; `react-dialog` leaves it to the consumer.
  "fixed z-50 gap-4 bg-card border-border p-0 shadow-lg focus:outline-none",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 border-b data-[state=open]:animate-sheet-in-top data-[state=closed]:animate-sheet-out-top",
        bottom:
          "inset-x-0 bottom-0 border-t data-[state=open]:animate-sheet-in-bottom data-[state=closed]:animate-sheet-out-bottom",
        left: "inset-y-0 left-0 h-full w-3/4 border-r data-[state=open]:animate-sheet-in-left data-[state=closed]:animate-sheet-out-left sm:max-w-sm",
        right:
          "inset-y-0 right-0 h-full w-full border-l data-[state=open]:animate-sheet-in-right data-[state=closed]:animate-sheet-out-right sm:max-w-2xl"
      }
    },
    defaultVariants: { side: "right" }
  }
)

interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
    VariantProps<typeof sheetVariants> {
  hideCloseButton?: boolean
}

export const SheetContent = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Content>, SheetContentProps>(
  ({ side = "right", className, children, hideCloseButton, ...props }, ref) => (
    <SheetPortal>
      <SheetOverlay />
      <DialogPrimitive.Content ref={ref} className={cn(sheetVariants({ side }), className)} {...props}>
        {children}
        {!hideCloseButton ? (
          <DialogPrimitive.Close className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground transition hover:bg-accent hover:text-accent-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </SheetPortal>
  )
)
SheetContent.displayName = "SheetContent"

export const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col gap-1.5 border-b border-border px-6 py-5", className)} {...props} />
)
SheetHeader.displayName = "SheetHeader"

export const SheetTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn("text-lg font-semibold tracking-tight", className)} {...props} />
))
SheetTitle.displayName = DialogPrimitive.Title.displayName

export const SheetDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
))
SheetDescription.displayName = DialogPrimitive.Description.displayName

export const SheetBody = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("overflow-y-auto px-6 py-5", className)} {...props} />
)
SheetBody.displayName = "SheetBody"
