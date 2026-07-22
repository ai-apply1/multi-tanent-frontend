import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Info, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
  type OrgUser,
} from "@/features/users/types";
import type { UserRole } from "@/features/auth/types";
import { useAuth } from "@/features/auth/AuthContext";
import { errorMessage as apiError } from "@/lib/errors";
import { cn } from "@/lib/utils";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Backend caps fullName at `@MaxLength(100)` — mirror it on the trimmed value. */
const FULL_NAME_MAX = 100;

/**
 * The backend validates email with class-validator's `@IsEmail()`; a single
 * regex can't reproduce validator.js exactly, so on top of the loose shape
 * check we reject the drift it would 400 on that `EMAIL_PATTERN` and the
 * browser's native `type=email` both let through: an empty dot-delimited
 * segment on either side of the `@` (consecutive dots, or a leading/trailing
 * dot in the local part or any domain label, e.g. `john..doe@acme.com`).
 */
function isValidEmail(value: string): boolean {
  if (!EMAIL_PATTERN.test(value)) return false;
  const at = value.lastIndexOf("@");
  const noEmptySegment = (part: string) =>
    part.split(".").every((segment) => segment.length > 0);
  return (
    noEmptySegment(value.slice(0, at)) && noEmptySegment(value.slice(at + 1))
  );
}

const USER_NAME_HINT =
  "Lowercase letters, digits, dot, underscore or hyphen. 3–50 chars.";

/** Longer helper the field shows on invalid input (rules the design still expects surfaced). */
const USER_NAME_HINT_LONG =
  "Lowercase letters, digits, dot, underscore or hyphen. 3–50 characters, starting with a letter or digit.";

/** Role options with the descriptive labels the design ships with. */
const ROLE_OPTIONS: Array<{ value: UserRole; label: string }> = [
  { value: "hr", label: "HR — gets everything except team & org settings" },
  {
    value: "org_admin",
    label: "Org admin — manages the team and org settings",
  },
];

/**
 * Extra context for the 409s an org_admin cannot resolve by re-reading the
 * message. The backend's own wording is always shown verbatim above this — the
 * hint only adds what the message can't say for itself.
 */
function errorHint(message: string): string | null {
  if (/seat/i.test(message)) {
    return "Seat counts are set by the platform admin — you can deactivate an existing member to free a seat, or ask them to raise the limit.";
  }
  if (/(already|taken|duplicate|in use|registered)/i.test(message)) {
    return "That email or username is already used by a member of your organization — reactivate the existing member (they may be deactivated) or pick a different value.";
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
 * touches `fullName`, `role`, and `isActive` — email and username are
 * immutable once minted.
 */
export function UserFormDialog({
  open,
  onOpenChange,
  user,
  isSelf = false,
}: UserFormDialogProps) {
  const queryClient = useQueryClient();
  const { refreshMe } = useAuth();
  const isEdit = Boolean(user);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [userName, setUserName] = useState("");
  const [role, setRole] = useState<UserRole>("hr");
  const [isActive, setIsActive] = useState(true);
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
      setIsActive(user.isActive);
    } else {
      setFullName("");
      setEmail("");
      setUserName("");
      setRole("hr");
      setIsActive(true);
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
        // Only send isActive when the toggle actually moved; deactivating
        // yourself is not offered either (the toggle is disabled).
        ...(!isSelf && user!.isActive !== isActive ? { isActive } : {}),
      }),
    onSuccess: async () => {
      invalidateLists();
      // A self-rename must also refresh the session identity: TopBar and
      // Sidebar render fullName from AuthContext, which the list invalidation
      // above doesn't touch, so without this they stay stale until a reload.
      if (isSelf) await refreshMe();
      toast.success("Member updated.");
      onOpenChange(false);
    },
    onError: (err) => setFormError(apiError(err, "Could not update member.")),
  });

  const mutation = isEdit ? updateMutation : createMutation;
  const busy = mutation.isPending;

  const trimmedName = fullName.trim();
  const nameError =
    trimmedName.length === 0
      ? "A full name is required."
      : trimmedName.length > FULL_NAME_MAX
        ? `Full name must be ${FULL_NAME_MAX} characters or fewer.`
        : null;
  const emailError = !isValidEmail(email.trim())
    ? "Enter a valid email address."
    : null;
  const userNameError = !USER_NAME_PATTERN.test(userName.trim())
    ? USER_NAME_HINT_LONG
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
      <DialogContent className="max-w-[480px] gap-0 p-0">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="flex items-start justify-between gap-4 px-6 pt-[22px] pb-[14px]">
            <div className="min-w-0">
              <DialogTitle className="text-[18px] font-semibold leading-tight">
                {isEdit ? "Edit member" : "Add member"}
              </DialogTitle>
              <DialogDescription className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
                {isEdit
                  ? "Update this member's role or status."
                  : "They get an account straight away — a temporary password is generated and emailed to them."}
              </DialogDescription>
            </div>
          </div>

          <div className="grid gap-4 px-6 pb-5">
            {isEdit ? (
              <div className="grid gap-3 rounded-xl border border-line bg-surface-2 px-3.5 py-3">
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-bold uppercase tracking-[0.05em] text-ink-subtle">
                    Email
                  </span>
                  <span className="text-[13px] text-ink">{email}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-bold uppercase tracking-[0.05em] text-ink-subtle">
                    Username
                  </span>
                  <span className="text-[13px] text-ink">{userName}</span>
                </div>
              </div>
            ) : null}

            <div>
              <label
                htmlFor="u-name"
                className="mb-1.5 block text-[13px] font-semibold text-ink"
              >
                Full name
              </label>
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
                <p className="mt-1.5 text-[12px] text-[var(--danger)]">
                  {nameError}
                </p>
              ) : null}
            </div>

            {isEdit ? null : (
              <>
                <div>
                  <label
                    htmlFor="u-email"
                    className="mb-1.5 block text-[13px] font-semibold text-ink"
                  >
                    Email
                  </label>
                  <Input
                    id="u-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                    placeholder="ayesha@company.com"
                    aria-invalid={Boolean(touched.email && emailError)}
                  />
                  {touched.email && emailError ? (
                    <p className="mt-1.5 text-[12px] text-[var(--danger)]">
                      {emailError}
                    </p>
                  ) : (
                    <p className="mt-1.5 text-[12px] text-ink-muted">
                      Where their sign-in details are sent.
                    </p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="u-username"
                    className="mb-1.5 block text-[13px] font-semibold text-ink"
                  >
                    Username
                  </label>
                  <Input
                    id="u-username"
                    value={userName}
                    // Lowercased as they type: the pattern only accepts
                    // lowercase, so silently fixing it beats rejecting
                    // "Ayesha.Khan".
                    onChange={(e) =>
                      setUserName(e.target.value.toLowerCase())
                    }
                    onBlur={() =>
                      setTouched((t) => ({ ...t, userName: true }))
                    }
                    placeholder="ayesha.khan"
                    aria-invalid={Boolean(touched.userName && userNameError)}
                  />
                  {touched.userName && userNameError ? (
                    <p className="mt-1.5 text-[12px] text-[var(--danger)]">
                      {userNameError}
                    </p>
                  ) : (
                    <p className="mt-1.5 text-[12px] text-ink-muted">
                      {USER_NAME_HINT}
                    </p>
                  )}
                </div>
              </>
            )}

            <div>
              <label
                htmlFor="u-role"
                className="mb-1.5 block text-[13px] font-semibold text-ink"
              >
                Role
              </label>
              <Select
                value={role}
                onValueChange={(v) => setRole(v as UserRole)}
                disabled={isSelf}
              >
                <SelectTrigger id="u-role" className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isSelf ? (
                <p className="mt-1.5 text-[12px] text-ink-muted">
                  You can't change your own role — ask another org admin to do
                  it.
                </p>
              ) : null}
            </div>

            {isEdit ? (
              <div className="flex items-center justify-between rounded-xl border border-line bg-surface px-3.5 py-3">
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-ink">
                    Active
                  </div>
                  <div className="text-[12px] text-ink-muted">
                    {isSelf
                      ? "You can't deactivate your own account."
                      : isActive
                        ? "Sign-in is enabled."
                        : "Sign-in is blocked; history is kept."}
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isActive}
                  disabled={isSelf}
                  onClick={() => setIsActive((v) => !v)}
                  className={cn(
                    "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    isActive
                      ? "bg-primary"
                      : "bg-[var(--line-2)]",
                    isSelf && "cursor-not-allowed opacity-50",
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
                      isActive ? "translate-x-5" : "translate-x-0.5",
                    )}
                  />
                </button>
              </div>
            ) : null}

            {isEdit ? null : (
              <div className="flex items-start gap-2.5 rounded-xl bg-accent px-3.5 py-3">
                <span className="mt-0.5 inline-flex text-primary">
                  <Info className="h-4 w-4" strokeWidth={1.7} />
                </span>
                <p className="text-[12.5px] leading-relaxed text-ink-2">
                  No password to set — a temporary one is generated and emailed
                  on save. They can change it after signing in.
                </p>
              </div>
            )}

            {formError ? (
              <div className="rounded-lg border border-[color-mix(in_srgb,var(--danger),transparent_60%)] bg-[var(--danger-soft)] px-3 py-2 text-[12.5px] text-[var(--danger)]">
                <p>{formError}</p>
                {hint ? <p className="mt-1.5 opacity-90">{hint}</p> : null}
              </div>
            ) : null}
          </div>

          <div className="flex justify-end gap-2.5 border-t border-line px-6 py-4">
            <Button
              type="button"
              variant="secondary"
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
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
