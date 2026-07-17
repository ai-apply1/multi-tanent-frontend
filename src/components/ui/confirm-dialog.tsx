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
      <DialogContent className="max-w-[420px] p-0 gap-0">
        <div className="p-6 pb-2">
          <span
            className={
              destructive
                ? "h-11 w-11 rounded-xl bg-[var(--danger-soft)] text-[var(--danger)] inline-flex items-center justify-center mb-3.5"
                : "h-11 w-11 rounded-xl bg-[var(--accent-soft)] text-primary inline-flex items-center justify-center mb-3.5"
            }
          >
            <Icon className="h-[22px] w-[22px]" strokeWidth={1.7} />
          </span>
          <DialogTitle className="text-[18px] font-semibold text-ink">
            {title}
          </DialogTitle>
          <DialogDescription className="mt-2 text-[13.5px] text-ink-muted leading-relaxed">
            {description}
          </DialogDescription>
        </div>
        <div className="border-t border-line px-6 py-4 flex justify-end gap-2.5">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "danger" : "default"}
            size="sm"
            onClick={onConfirm}
            disabled={loading}
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
