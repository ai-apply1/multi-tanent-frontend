import { useEffect, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { AlertCircle, Eye, EyeOff, Loader2, Lock } from "lucide-react"
import toast from "react-hot-toast"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle
} from "@/components/ui/dialog"
import { changePasswordRequest } from "@/features/auth/authApi"
import { errorMessage } from "@/lib/errors"

const fieldClass =
  "h-[46px] w-full rounded-lg border border-[var(--field-border)] bg-[var(--surface)] px-3 pl-10 text-[14px] text-[var(--ink)] outline-none placeholder:text-[var(--ink-subtle)] focus:border-primary focus:shadow-[0_0_0_3px_var(--accent-ring)]"

/** Mirrors the backend's `@MinLength(8)` on `newPassword`. */
const MIN_PASSWORD = 8

interface ChangePasswordDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Self-service password change for the signed-in user. Takes the current
 * password (proof of ownership), a new password, and a confirmation.
 *
 * The backend keeps THIS device signed in (it refreshes the session cookies)
 * while revoking the user's other sessions, so there's no re-login dance — a
 * success toast and close is the whole flow.
 */
export function ChangePasswordDialog({
  open,
  onOpenChange
}: ChangePasswordDialogProps) {
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNext, setShowNext] = useState(false)
  const [touched, setTouched] = useState(false)

  // Reset on every open so a reopened dialog never shows stale input.
  useEffect(() => {
    if (open) {
      setCurrent("")
      setNext("")
      setConfirm("")
      setShowCurrent(false)
      setShowNext(false)
      setTouched(false)
    }
  }, [open])

  const tooShort = next.length > 0 && next.length < MIN_PASSWORD
  const mismatch = confirm.length > 0 && next !== confirm
  const sameAsCurrent = next.length > 0 && next === current
  const canSubmit =
    current.length > 0 &&
    next.length >= MIN_PASSWORD &&
    next === confirm &&
    !sameAsCurrent

  const mutation = useMutation({
    mutationFn: () => changePasswordRequest(current, next),
    onSuccess: () => {
      toast.success("Password changed.")
      onOpenChange(false)
    },
    onError: (err) =>
      // The backend returns specific messages for a wrong current password
      // (401) and for reusing the old one (400) — surface them as-is.
      toast.error(errorMessage(err, "Could not change your password."))
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (!canSubmit || mutation.isPending) return
    mutation.mutate()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && mutation.isPending) return
        onOpenChange(nextOpen)
      }}
    >
      <DialogContent className="max-w-[440px]">
        <div className="mb-4">
          <DialogTitle className="text-[17px] font-semibold text-ink">
            Change password
          </DialogTitle>
          <DialogDescription className="mt-1 text-[13px] leading-relaxed text-ink-muted">
            Enter your current password and choose a new one. Your other
            devices will be signed out.
          </DialogDescription>
        </div>

        <form onSubmit={handleSubmit} className="grid gap-3.5">
          {/* Current password */}
          <div>
            <label
              htmlFor="current-password"
              className="mb-1.5 block text-[13px] font-medium text-ink"
            >
              Current password
            </label>
            <div className="relative">
              <Lock
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
                aria-hidden
              />
              <input
                id="current-password"
                type={showCurrent ? "text" : "password"}
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                placeholder="Your current password"
                className={`${fieldClass} pr-12`}
              />
              <button
                type="button"
                aria-label={showCurrent ? "Hide password" : "Show password"}
                onClick={() => setShowCurrent((s) => !s)}
                className="absolute right-2 top-2 flex h-[30px] w-[30px] items-center justify-center rounded-md text-ink-subtle transition hover:bg-surface-3 hover:text-ink"
              >
                {showCurrent ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {/* New password */}
          <div>
            <label
              htmlFor="new-password"
              className="mb-1.5 block text-[13px] font-medium text-ink"
            >
              New password
            </label>
            <div className="relative">
              <Lock
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
                aria-hidden
              />
              <input
                id="new-password"
                type={showNext ? "text" : "password"}
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                placeholder="At least 8 characters"
                aria-invalid={touched && (tooShort || sameAsCurrent)}
                className={`${fieldClass} pr-12`}
              />
              <button
                type="button"
                aria-label={showNext ? "Hide password" : "Show password"}
                onClick={() => setShowNext((s) => !s)}
                className="absolute right-2 top-2 flex h-[30px] w-[30px] items-center justify-center rounded-md text-ink-subtle transition hover:bg-surface-3 hover:text-ink"
              >
                {showNext ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            {tooShort ? (
              <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--danger)]">
                <AlertCircle className="h-3.5 w-3.5" />
                Use at least {MIN_PASSWORD} characters.
              </p>
            ) : sameAsCurrent ? (
              <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--danger)]">
                <AlertCircle className="h-3.5 w-3.5" />
                Choose a password different from your current one.
              </p>
            ) : null}
          </div>

          {/* Confirm new password */}
          <div>
            <label
              htmlFor="confirm-password"
              className="mb-1.5 block text-[13px] font-medium text-ink"
            >
              Confirm new password
            </label>
            <div className="relative">
              <Lock
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
                aria-hidden
              />
              <input
                id="confirm-password"
                type={showNext ? "text" : "password"}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Re-enter your new password"
                aria-invalid={touched && mismatch}
                className={fieldClass}
              />
            </div>
            {mismatch ? (
              <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--danger)]">
                <AlertCircle className="h-3.5 w-3.5" />
                Passwords don&apos;t match.
              </p>
            ) : null}
          </div>

          <div className="mt-1 flex justify-end gap-2.5">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!canSubmit || mutation.isPending}>
              {mutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              {mutation.isPending ? "Changing…" : "Change password"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
