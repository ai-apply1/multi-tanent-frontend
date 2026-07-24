import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  Check,
  Copy,
  Download,
  KeyRound,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  disableMfa,
  enableMfa,
  fetchMfaStatus,
  regenerateRecoveryCodes,
  setupMfa,
  type MfaSetup,
} from "@/features/security/securityApi";
import { errorMessage } from "@/lib/errors";

const MFA_STATUS_KEY = ["mfa-status"] as const;

const inputClass =
  "h-[46px] w-full rounded-lg border border-[var(--field-border)] bg-[var(--surface)] px-3 text-center text-[15px] tracking-[0.3em] text-[var(--ink)] outline-none placeholder:tracking-normal placeholder:text-[var(--ink-subtle)] focus:border-primary focus:shadow-[0_0_0_3px_var(--accent-ring)]";

/** Presentational: the one-time recovery codes, with copy + download. */
function RecoveryCodes({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);
  const asText = codes.join("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy to clipboard.");
    }
  };

  const download = () => {
    const blob = new Blob([`${asText}\n`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-lg bg-[var(--warning-soft,var(--surface-3))] px-3 py-2.5 text-[12.5px] leading-relaxed text-[var(--ink-muted)]">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ink-subtle)]" />
        <span>
          Save these somewhere safe. Each works once, and this is the only time
          they are shown. If you lose your authenticator, a recovery code is the
          only way back in.
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-[var(--surface-2,var(--surface))] p-3">
        {codes.map((c) => (
          <span key={c} className="mono text-center text-[13.5px] text-ink">
            {c}
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={copy}>
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={download}>
          <Download className="h-4 w-4" />
          Download
        </Button>
      </div>
    </div>
  );
}

/** Enrol flow: confirm a code against the pending secret, then show codes. */
function EnrollDialog({
  setup,
  onClose,
  onEnabled,
}: {
  setup: MfaSetup;
  onClose: () => void;
  onEnabled: () => void;
}) {
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  const enable = useMutation({
    mutationFn: () => enableMfa(code.trim()),
    onSuccess: (codes) => {
      setRecoveryCodes(codes);
      onEnabled();
    },
    onError: (err) =>
      toast.error(errorMessage(err, "That code was not accepted.")),
  });

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !enable.isPending) onClose();
      }}
    >
      <DialogContent className="max-w-[440px]">
        {recoveryCodes ? (
          <>
            <div className="mb-4">
              <DialogTitle className="text-[17px] font-semibold text-ink">
                Save your recovery codes
              </DialogTitle>
              <DialogDescription className="mt-1 text-[13px] leading-relaxed text-ink-muted">
                Two-factor authentication is now on for your account.
              </DialogDescription>
            </div>
            <RecoveryCodes codes={recoveryCodes} />
            <div className="mt-5 flex justify-end">
              <Button type="button" size="sm" onClick={onClose}>
                Done
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="mb-4">
              <DialogTitle className="text-[17px] font-semibold text-ink">
                Set up two-factor authentication
              </DialogTitle>
              <DialogDescription className="mt-1 text-[13px] leading-relaxed text-ink-muted">
                Scan the QR code with an authenticator app (Google
                Authenticator, Authy, 1Password), then enter the 6-digit code it
                shows.
              </DialogDescription>
            </div>

            <div className="flex flex-col items-center gap-3">
              <img
                src={setup.qrDataUrl}
                alt="Two-factor authentication QR code"
                className="h-44 w-44 rounded-lg border border-line bg-white p-2"
              />
              <div className="w-full text-center">
                <p className="text-[12px] text-ink-subtle">
                  Or enter this key manually
                </p>
                <p className="mono mt-1 break-all text-[12px] text-ink">
                  {setup.secretBase32}
                </p>
              </div>
            </div>

            <form
              className="mt-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (code.trim().length === 6) enable.mutate();
              }}
            >
              <label
                htmlFor="enroll-code"
                className="mb-1.5 block text-[13px] font-medium text-ink"
              >
                Authenticator code
              </label>
              <input
                id="enroll-code"
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                className={inputClass}
                autoFocus
              />
              <div className="mt-5 flex justify-end gap-2.5">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={onClose}
                  disabled={enable.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={enable.isPending || code.trim().length !== 6}
                >
                  {enable.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  {enable.isPending ? "Verifying…" : "Verify and enable"}
                </Button>
              </div>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Enter a current code to confirm a sensitive change (disable / regenerate). */
function CodeActionDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  destructive,
  action,
  onCodes,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  action: (code: string) => Promise<string[] | void>;
  /** Called with the new recovery codes when the action returns them. */
  onCodes?: (codes: string[]) => void;
}) {
  const [code, setCode] = useState("");

  const mutation = useMutation({
    mutationFn: () => action(code.trim()),
    onSuccess: (result) => {
      if (result && onCodes) onCodes(result);
      else onClose();
    },
    onError: (err) =>
      toast.error(errorMessage(err, "That code was not accepted.")),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !mutation.isPending) {
          setCode("");
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-[440px]">
        <div className="mb-4">
          <DialogTitle className="text-[17px] font-semibold text-ink">
            {title}
          </DialogTitle>
          <DialogDescription className="mt-1 text-[13px] leading-relaxed text-ink-muted">
            {description}
          </DialogDescription>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim().length >= 6) mutation.mutate();
          }}
        >
          <label
            htmlFor="action-code"
            className="mb-1.5 block text-[13px] font-medium text-ink"
          >
            Authenticator or recovery code
          </label>
          <input
            id="action-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="one-time-code"
            placeholder="123456"
            className={inputClass}
            autoFocus
          />
          <div className="mt-5 flex justify-end gap-2.5">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setCode("");
                onClose();
              }}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              variant={destructive ? "destructive" : "default"}
              disabled={mutation.isPending || code.trim().length < 6}
            >
              {mutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              {confirmLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SecurityPage() {
  const qc = useQueryClient();
  const { data: status, isLoading, isError, refetch } = useQuery({
    queryKey: MFA_STATUS_KEY,
    queryFn: fetchMfaStatus,
  });

  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);

  const beginSetup = useMutation({
    mutationFn: setupMfa,
    onSuccess: (data) => setSetup(data),
    onError: (err) => toast.error(errorMessage(err, "Could not start setup.")),
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: MFA_STATUS_KEY });

  return (
    <div className="mx-auto max-w-[760px] px-6 py-6 lg:px-8 lg:py-8">
      <div className="mb-6 flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-primary">
          <ShieldCheck className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <h1 className="text-[23px] font-semibold tracking-tight text-ink">
            Security
          </h1>
          <p className="text-[13.5px] text-ink-muted">
            Protect your account with a second sign-in factor.
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-surface">
        <div className="border-b border-line p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-semibold text-ink">
              Two-factor authentication
            </h2>
            {status ? (
              <span
                className={
                  status.enabled
                    ? "rounded-full bg-[var(--success-soft,var(--accent))] px-2 py-0.5 text-[11px] font-semibold text-[var(--success,var(--primary))]"
                    : "rounded-full bg-[var(--surface-3)] px-2 py-0.5 text-[11px] font-semibold text-ink-muted"
                }
              >
                {status.enabled ? "On" : "Off"}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-[13px] text-ink-muted">
            A time-based code from an authenticator app, required after your
            password on every sign in.
          </p>
        </div>

        <div className="p-5 sm:p-6">
          {isError ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-[13.5px] text-[var(--danger)]">
                Could not load your security settings.
              </p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Retry
              </Button>
            </div>
          ) : isLoading || !status ? (
            <div className="flex items-center gap-2 py-2 text-[13.5px] text-ink-muted">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Loading…
            </div>
          ) : status.enabled ? (
            <div className="space-y-5">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-primary">
                  <ShieldCheck className="h-4.5 w-4.5" aria-hidden />
                </div>
                <div className="text-[13.5px]">
                  <p className="font-medium text-ink">
                    Your account is protected.
                  </p>
                  <p className="text-ink-muted">
                    {status.recoveryCodesRemaining} recovery code
                    {status.recoveryCodesRemaining === 1 ? "" : "s"} remaining.
                    {status.recoveryCodesRemaining <= 2
                      ? " Consider regenerating them soon."
                      : ""}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2.5">
                <Button variant="outline" size="sm" onClick={() => setRegenOpen(true)}>
                  <KeyRound className="h-4 w-4" />
                  Regenerate recovery codes
                </Button>
                <Button variant="outline" size="sm" onClick={() => setDisableOpen(true)}>
                  <ShieldOff className="h-4 w-4" />
                  Turn off
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--surface-3)] text-ink-muted">
                  <ShieldOff className="h-4.5 w-4.5" aria-hidden />
                </div>
                <div className="text-[13.5px]">
                  <p className="font-medium text-ink">
                    Two-factor authentication is off.
                  </p>
                  <p className="text-ink-muted">
                    Add an authenticator app so a stolen password isn&apos;t
                    enough to sign in.
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                onClick={() => beginSetup.mutate()}
                disabled={beginSetup.isPending}
              >
                {beginSetup.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4" />
                )}
                {beginSetup.isPending ? "Preparing…" : "Set up two-factor authentication"}
              </Button>
            </div>
          )}
        </div>
      </div>

      {setup ? (
        <EnrollDialog
          setup={setup}
          onClose={() => setSetup(null)}
          onEnabled={invalidate}
        />
      ) : null}

      <CodeActionDialog
        open={disableOpen}
        onClose={() => setDisableOpen(false)}
        title="Turn off two-factor authentication"
        description="This lowers your account security. Enter a current authenticator or recovery code to confirm."
        confirmLabel="Disable"
        destructive
        action={async (code) => {
          await disableMfa(code);
          toast.success("Two-factor authentication disabled.");
          invalidate();
        }}
      />

      <CodeActionDialog
        open={regenOpen && !newCodes}
        onClose={() => setRegenOpen(false)}
        title="Regenerate recovery codes"
        description="This invalidates your old codes. Enter a current authenticator or recovery code to confirm."
        confirmLabel="Regenerate"
        action={(code) => regenerateRecoveryCodes(code)}
        onCodes={(codes) => {
          setNewCodes(codes);
          invalidate();
        }}
      />

      {newCodes ? (
        <Dialog
          open
          onOpenChange={(o) => {
            if (!o) {
              setNewCodes(null);
              setRegenOpen(false);
            }
          }}
        >
          <DialogContent className="max-w-[440px]">
            <div className="mb-4">
              <DialogTitle className="text-[17px] font-semibold text-ink">
                Your new recovery codes
              </DialogTitle>
              <DialogDescription className="mt-1 text-[13px] leading-relaxed text-ink-muted">
                Your previous recovery codes no longer work.
              </DialogDescription>
            </div>
            <RecoveryCodes codes={newCodes} />
            <div className="mt-5 flex justify-end">
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setNewCodes(null);
                  setRegenOpen(false);
                }}
              >
                Done
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
