import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close
export const DialogPortal = DialogPrimitive.Portal

/**
 * Backdrop layer. Intentionally NOT scrollable — the scrollable
 * container is the `DialogContent` wrapper below, which sits *on
 * top of* the overlay (same z-index, later in DOM order). Splitting
 * "darken the page" from "scroll the dialog into view" lets the
 * dark layer animate independently from the dialog's position.
 */
export const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-[rgba(13,11,11,0.45)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { hideCloseButton?: boolean }
>(({ className, children, hideCloseButton, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    {/* `DialogPrimitive.Content` IS the scroll container.
        Radix wraps its `DialogOverlay` in `react-remove-scroll` with
        a single shard — the Content ref — so ONLY the Content
        element is allowed to receive wheel/touch scroll events
        while the modal is open. A separate sibling scroll wrapper
        (which we initially tried) gets its wheel events intercepted
        at the document level and silently dropped — that's why the
        scrollbar appeared but didn't move. Making Content itself
        the full-viewport scroll surface puts the scroll on the
        backdrop area (visually outside the dialog) while still
        passing through react-remove-scroll's allow-list.

        The OVERLAY (rendered above as a sibling) provides the
        dark backdrop and fades in/out on its own data-state.
        Content here is transparent, full-screen, and just hosts
        the centered dialog box + the click-outside catcher below. */}
    <DialogPrimitive.Content
      ref={ref}
      // `group` so the inner visual dialog can read the
      // open/closed animation state from Content's data-state via
      // Tailwind's group-data variants — without `group` the
      // animation classes on the inner box would have no source of
      // truth (Radix sets data-state on Content, not its children).
      className="group fixed inset-0 z-50 overflow-y-auto overscroll-contain"
      // Radix's default outside-click handler fires on clicks
      // OUTSIDE Content. Now that Content fills the viewport there
      // are no clicks outside it, so this handler never fires —
      // disabling it explicitly is just belt-and-braces against a
      // pointerdown that races the layout (e.g. from a focus-shift
      // before the animation completes). Dismissal-on-backdrop is
      // wired below via an embedded `DialogPrimitive.Close`.
      onInteractOutside={(e) => e.preventDefault()}
      {...props}
    >
      <div className="relative flex min-h-full items-center justify-center p-4">
        {/* Click-outside catcher. A hidden Radix `DialogClose`
            button stretched across the entire flex area, sitting
            BEHIND the visual dialog in DOM order so the dialog
            naturally renders on top. Click on the dark space →
            fires the same close path as the X button. Tabindex -1
            keeps it out of the focus-trap rotation, and
            `cursor-default` keeps the pointer from changing over
            the empty backdrop. */}
        <DialogPrimitive.Close asChild>
          <button
            type="button"
            aria-label="Close dialog"
            tabIndex={-1}
            className="absolute inset-0 cursor-default focus:outline-none"
          />
        </DialogPrimitive.Close>
        {/* Visual dialog box. `relative z-10` puts it above the
            click-outside catcher. Clicks here are NOT in the
            catcher's bubble chain (the box is a SIBLING of the
            close button, not a descendant), so they don't dismiss
            the dialog. */}
        <div
          className={cn(
            "relative z-10 grid w-full max-w-lg gap-4 border border-line bg-card p-6 shadow-[0_24px_70px_rgba(13,11,11,0.28)] sm:rounded-2xl duration-200",
            "group-data-[state=open]:animate-in group-data-[state=closed]:animate-out",
            "group-data-[state=closed]:fade-out-0 group-data-[state=open]:fade-in-0",
            "group-data-[state=closed]:zoom-out-95 group-data-[state=open]:zoom-in-95",
            className
          )}
        >
          {children}
          {!hideCloseButton ? (
            <DialogPrimitive.Close className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground transition hover:bg-accent hover:text-accent-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          ) : null}
        </div>
      </div>
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

export const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col gap-1.5 text-left", className)} {...props} />
)
DialogHeader.displayName = "DialogHeader"

export const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />
)
DialogFooter.displayName = "DialogFooter"

export const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn("text-lg font-semibold leading-tight", className)} {...props} />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName
