import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, KeyRound, Loader2, MailCheck, MailX } from "lucide-react";
import toast from "react-hot-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/common/CopyButton";
import { resetUserPassword } from "@/features/users/usersApi";
import type { OrgUser, ResetPasswordResponse } from "@/features/users/types";
import { errorMessage as apiError } from "@/lib/errors";
import { titleCase } from "@/lib/text";

interface ResetPasswordDialogProps {
  user: OrgUser | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Two-step modal for the org_admin "reset a team member's password" action.
 *
 *   1. Confirm - warns that it signs the member out everywhere and mints a new
 *                temporary password.
 *   2. Reveal  - shows that password ONCE with a copy button, and whether it was
 *                also emailed to the member. The backend stores only the hash, so
 *                this is the admin's single chance to copy it; closing the modal
 *                drops it for good.
 *
 * Self-contained (mirrors UserFormDialog): owns its mutation and its
 * confirm/reveal state, and clears the revealed secret whenever it closes.
 */
export function ResetPasswordDialog({
  user,
  open,
  onOpenChange,
}: ResetPasswordDialogProps) {
  const [result, setResult] = useState<ResetPasswordResponse | null>(null);

  const mutation = useMutation({
    mutationFn: (id: string) => resetUserPassword(id),
    onSuccess: (res) => setResult(res),
    onError: (err) => toast.error(apiError(err, "Could not reset password.")),
  });

  // Any close (Esc, backdrop, buttons) clears both the request and the revealed
  // secret so the next open starts clean at the confirm step. Blocked while the
  // request is in flight, matching ConfirmDialog.
  const handleOpenChange = (next: boolean) => {
    if (mutation.isPending) return;
    if (!next) {
      setResult(null);
      mutation.reset();
    }
    onOpenChange(next);
  };

  const name = user ? titleCase(user.fullName) : "this member";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-[460px] gap-0 overflow-hidden p-0"
        hideCloseButton={mutation.isPending}
      >
        {result === null ? (
          /* Step 1: confirm */
          <>
            <div className="flex gap-4 p-6">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--danger-soft)] text-[var(--danger)] ring-1 ring-[color-mix(in_srgb,var(--danger),transparent_78%)]">
                <AlertTriangle className="h-5 w-5" strokeWidth={1.9} />
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <DialogTitle className="pr-6 text-[16.5px] font-semibold leading-snug tracking-[-0.01em] text-ink">
                  Reset password for {name}?
                </DialogTitle>
                <DialogDescription className="mt-1.5 text-[13px] leading-[1.55] text-ink-muted">
                  This generates a new temporary password and signs them out
                  everywhere. Their current password stops working right away. We
                  email the new one to them, and you&apos;ll also see it on the
                  next screen to share directly.
                </DialogDescription>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-line bg-[var(--surface-2)] px-5 py-3.5">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleOpenChange(false)}
                disabled={mutation.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => user && mutation.mutate(user._id)}
                disabled={mutation.isPending || !user}
                className="min-w-[132px]"
              >
                {mutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Resetting…
                  </>
                ) : (
                  "Reset password"
                )}
              </Button>
            </div>
          </>
        ) : (
          /* Step 2: reveal */
          <>
            <div className="p-6">
              <div className="flex gap-4">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-primary ring-1 ring-[color-mix(in_srgb,var(--accent),transparent_78%)]">
                  <KeyRound className="h-5 w-5" strokeWidth={1.9} />
                </span>
                <div className="min-w-0 flex-1 pt-0.5">
                  <DialogTitle className="pr-6 text-[16.5px] font-semibold leading-snug tracking-[-0.01em] text-ink">
                    Temporary password ready
                  </DialogTitle>
                  <DialogDescription className="mt-1.5 text-[13px] leading-[1.55] text-ink-muted">
                    Share this with {name} over a secure channel. It won&apos;t
                    be shown again, so copy it now. Ask them to change it after
                    signing in.
                  </DialogDescription>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-2 rounded-lg border border-line bg-surface-3 px-3 py-2.5">
                <span className="mono flex-1 break-all text-[14px] font-semibold text-ink">
                  {result.tempPassword}
                </span>
                <CopyButton
                  value={result.tempPassword}
                  label="temporary password"
                />
              </div>

              {/* Email delivery status, mirroring how the create flow reports
                  `credentialsEmailSent`: a green line when it went out, a warning
                  line when it did not so the admin knows to hand it over. */}
              {result.emailSent ? (
                <p className="mt-2.5 flex items-center gap-1.5 text-[12.5px] text-[var(--success)]">
                  <MailCheck className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                  We also emailed it to {user?.email ?? "the member"}.
                </p>
              ) : (
                <p className="mt-2.5 flex items-center gap-1.5 text-[12.5px] text-[var(--warning)]">
                  <MailX className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                  We couldn&apos;t email it this time, so share it with them
                  directly.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-line bg-[var(--surface-2)] px-5 py-3.5">
              <Button
                size="sm"
                onClick={() => handleOpenChange(false)}
                className="min-w-[92px]"
              >
                Done
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
