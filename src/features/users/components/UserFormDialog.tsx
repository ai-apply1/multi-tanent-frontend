import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Mail } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createUser, updateUser } from "@/features/users/usersApi";
import {
  USER_NAME_PATTERN,
  USER_ROLES,
  USER_ROLE_LABELS,
  type OrgUser,
} from "@/features/users/types";
import type { UserRole } from "@/features/auth/types";
import { errorMessage as apiError } from "@/lib/errors";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const USER_NAME_HINT =
  "Lowercase letters, digits, dot, underscore or hyphen. 3–50 characters, starting with a letter or digit.";

/**
 * Extra context for the 409s an org_admin cannot resolve by re-reading the
 * message. The backend's own wording is always shown verbatim above this — the
 * hint only adds what the message can't say for itself.
 */
function errorHint(message: string): string | null {
  if (/seat/i.test(message)) {
    return "Seat counts are set by the platform admin — you can deactivate an existing member to free a seat, or ask them to raise the limit.";
  }
  // Deliberately narrow: a loose "use" would also match the word "user" and
  // stamp this hint on unrelated failures.
  if (/(already|taken|duplicate|in use|registered)/i.test(message)) {
    return "Emails and usernames are unique across every organization on the platform, not just yours — a value that looks free here may be claimed elsewhere.";
  }
  return null;
}

interface UserFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pass a row to edit it; omit/null to invite a new member. */
  user?: OrgUser | null;
  /** True when the row being edited is the signed-in user — the backend 403s a self-role-change. */
  isSelf?: boolean;
}

/**
 * Invite / edit dialog for an org member.
 *
 * Create sends no password: the backend generates a temporary one and emails
 * it, and the toast reports whether that mail actually went out. Edit only
 * touches `fullName` and `role` — email and username are immutable once minted,
 * and `isActive` is driven from the row's own Deactivate/Reactivate action.
 */
export function UserFormDialog({
  open,
  onOpenChange,
  user,
  isSelf = false,
}: UserFormDialogProps) {
  const queryClient = useQueryClient();
  const isEdit = Boolean(user);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [userName, setUserName] = useState("");
  const [role, setRole] = useState<UserRole>("hr");
  // Only show a field's error once it has been interacted with — a fresh
  // dialog shouldn't open covered in red.
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  // The backend's message stays on-screen (a toast would take the seat-limit
  // and duplicate-value explanations with it).
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTouched({});
    setFormError(null);
    if (user) {
      setFullName(user.fullName);
      setEmail(user.email);
      setUserName(user.userName);
      setRole(user.role);
    } else {
      setFullName("");
      setEmail("");
      setUserName("");
      setRole("hr");
    }
  }, [open, user]);

  const invalidateLists = () =>
    queryClient.invalidateQueries({ queryKey: ["users"] });

  const createMutation = useMutation({
    mutationFn: () =>
      createUser({
        fullName: fullName.trim(),
        email: email.trim(),
        userName: userName.trim(),
        role,
      }),
    onSuccess: (result) => {
      invalidateLists();
      if (result.credentialsEmailSent) {
        toast.success(
          `${result.user.fullName} added. Their temporary password was emailed to ${result.user.email}.`,
        );
      } else {
        // Not an error — the account is live. But nobody has the password
        // except this response, so it must not scroll past in a 3s toast.
        toast(
          `${result.user.fullName} added, but the credentials email could not be sent to ${result.user.email}. Share their temporary password another way, or have them reset it from the login screen.`,
          { icon: "⚠️", duration: 12000 },
        );
      }
      onOpenChange(false);
    },
    onError: (err) => setFormError(apiError(err, "Could not add member.")),
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      updateUser(user!._id, {
        fullName: fullName.trim(),
        // A self-role-change 403s, so it isn't offered — and isn't sent.
        ...(isSelf ? {} : { role }),
      }),
    onSuccess: () => {
      invalidateLists();
      toast.success("Member updated.");
      onOpenChange(false);
    },
    onError: (err) => setFormError(apiError(err, "Could not update member.")),
  });

  const mutation = isEdit ? updateMutation : createMutation;
  const busy = mutation.isPending;

  const nameError = fullName.trim().length === 0 ? "A full name is required." : null;
  const emailError = !EMAIL_PATTERN.test(email.trim())
    ? "Enter a valid email address."
    : null;
  const userNameError = !USER_NAME_PATTERN.test(userName.trim())
    ? USER_NAME_HINT
    : null;

  const canSubmit =
    !busy && !nameError && (isEdit || (!emailError && !userNameError));

  const submit = () => {
    setTouched({ fullName: true, email: true, userName: true });
    if (!canSubmit) return;
    setFormError(null);
    mutation.mutate();
  };

  const hint = formError ? errorHint(formError) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit member" : "Add member"}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? "Email and username are fixed once an account exists. To remove someone, deactivate them from the row menu."
                : "They get an account straight away — the temporary password is generated and emailed for you."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-5 py-4">
            <div className="flex flex-col gap-2.5">
              <Label htmlFor="u-name">Full name</Label>
              <Input
                id="u-name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, fullName: true }))}
                placeholder="Ayesha Khan"
                autoFocus
                aria-invalid={Boolean(touched.fullName && nameError)}
              />
              {touched.fullName && nameError ? (
                <p className="text-xs text-destructive">{nameError}</p>
              ) : null}
            </div>

            <div className="flex flex-col gap-2.5">
              <Label htmlFor="u-email">Email</Label>
              <Input
                id="u-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                placeholder="ayesha@company.com"
                disabled={isEdit}
                aria-invalid={Boolean(touched.email && emailError)}
              />
              {isEdit ? null : touched.email && emailError ? (
                <p className="text-xs text-destructive">{emailError}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Where their sign-in details are sent.
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2.5">
              <Label htmlFor="u-username">Username</Label>
              <Input
                id="u-username"
                value={userName}
                // Lowercased as they type: the pattern only accepts lowercase,
                // so silently fixing it beats rejecting "Ayesha.Khan".
                onChange={(e) => setUserName(e.target.value.toLowerCase())}
                onBlur={() => setTouched((t) => ({ ...t, userName: true }))}
                placeholder="ayesha.khan"
                disabled={isEdit}
                aria-invalid={Boolean(touched.userName && userNameError)}
              />
              {isEdit ? null : touched.userName && userNameError ? (
                <p className="text-xs text-destructive">{userNameError}</p>
              ) : (
                <p className="text-xs text-muted-foreground">{USER_NAME_HINT}</p>
              )}
            </div>

            <div className="flex flex-col gap-2.5">
              <Label htmlFor="u-role">Role</Label>
              <Select
                value={role}
                onValueChange={(v) => setRole(v as UserRole)}
                disabled={isSelf}
              >
                <SelectTrigger id="u-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {USER_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {USER_ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {isSelf
                  ? "You can't change your own role — ask another org admin to do it."
                  : "Org admins manage the team and organization settings. HR gets everything else."}
              </p>
            </div>

            {isEdit ? null : (
              <p className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                No password to set: a temporary one is generated and emailed on
                save. They can change it after signing in.
              </p>
            )}

            {formError ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <p>{formError}</p>
                {hint ? <p className="mt-1.5 opacity-90">{hint}</p> : null}
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {isEdit ? "Saving…" : "Adding…"}
                </>
              ) : isEdit ? (
                "Save changes"
              ) : (
                "Add member"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
