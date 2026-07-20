import type { ReactNode } from "react"
import { AlertTriangle, Info, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle
} from "@/components/ui/dialog"

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /**
   * When true, styles the confirm button with the `danger` variant and swaps
   * the header icon square to danger tones. Use for any irreversible action
   * (delete, reset, revoke, etc.). Otherwise the icon square + button both
   * fall back to the accent-informational tones.
   */
  destructive?: boolean
  /**
   * Pending state — disables both buttons, swaps the confirm button's
   * content for a spinner plus `loadingLabel`, and blocks Esc/backdrop
   * dismissal so the caller can rely on the dialog staying mounted
   * until the mutation settles.
   */
  loading?: boolean
  /**
   * Optional label shown next to the spinner while `loading` is true.
   * Defaults to `confirmLabel` so the button width stays stable; pass
   * a present-progressive form like "Deleting…" if you want the
   * intent to be obvious during the request.
   */
  loadingLabel?: string
  onConfirm: () => void
}

/**
 * Shared confirmation modal used across the admin dashboard for any
 * action that needs a "are you sure?" gate — deleting interviews,
 * deleting training nodes, deleting candidates, resetting candidate
 * passwords, etc. The shape intentionally mirrors the simpler
 * declarative pattern (caller owns the mutation, dialog is dumb)
 * rather than baking domain knowledge inside, so a single component
 * covers every destructive flow.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  loading = false,
  loadingLabel,
  onConfirm
}: ConfirmDialogProps) {
  // While a mutation is in flight we drop close events (Esc, backdrop
  // click) so the caller doesn't have to defensively unmount the
  // dialog and lose its toast/error feedback.
  const handleOpenChange = (next: boolean) => {
    if (loading) return
    onOpenChange(next)
  }

  const Icon = destructive ? AlertTriangle : Info

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {/* `overflow-hidden` so the tinted footer bar can bleed to the
          rounded corners; the X is hidden mid-request because the only
          honest way out at that point is to wait. */}
      <DialogContent
        className="max-w-[440px] gap-0 overflow-hidden p-0"
        hideCloseButton={loading}
      >
        <div className="flex gap-4 p-6">
          {/* Icon sits BESIDE the copy rather than above it: the block
              reads as one sentence, and it buys ~50px of height back on
              short viewports. The ring keeps the soft fill from looking
              like a flat blob against the card. */}
          <span
            className={
              destructive
                ? "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--danger-soft)] text-[var(--danger)] ring-1 ring-[color-mix(in_srgb,var(--danger),transparent_78%)]"
                : "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-primary ring-1 ring-[color-mix(in_srgb,var(--accent),transparent_78%)]"
            }
          >
            <Icon className="h-5 w-5" strokeWidth={1.9} />
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            {/* pr-6 keeps a long title clear of the close button. */}
            <DialogTitle className="pr-6 text-[16.5px] font-semibold leading-snug tracking-[-0.01em] text-ink">
              {title}
            </DialogTitle>
            <DialogDescription className="mt-1.5 text-[13px] leading-[1.55] text-ink-muted">
              {description}
            </DialogDescription>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-line bg-[var(--surface-2)] px-5 py-3.5">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            {cancelLabel}
          </Button>
          {/* Solid red, not the outlined `danger` pill: this is the
              dialog's primary action and has to out-weigh Cancel.
              `min-w` stops the button from resizing when the label
              swaps for the spinner. */}
          <Button
            variant={destructive ? "destructive" : "default"}
            size="sm"
            onClick={onConfirm}
            disabled={loading}
            className="min-w-[92px]"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {loadingLabel ?? confirmLabel}
              </>
            ) : (
              confirmLabel
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
