import type { ReactNode } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
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
   * When true, styles the confirm button with the `destructive`
   * variant. Use for any irreversible action (delete, reset, revoke,
   * etc.). The header itself stays icon-free for a clean, low-noise
   * look — the destructive intent reads from the title copy and the
   * red button.
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

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
