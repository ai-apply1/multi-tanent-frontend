import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import axios from "axios";
import { AlertTriangle, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTemplates } from "@/features/templates/useTemplates";
import {
  customValuesFromVariables,
  useVariables,
} from "@/features/templates/useVariables";
import {
  APPLICANT_LINK_TOKENS,
  applyTemplateVariables,
  buildCandidateVariables,
  extractTokens,
} from "@/features/templates/templateVariables";
import { humanizePurpose } from "@/features/templates/types";
import { sendTemplateToApplicant } from "@/features/applicants/applicantsApi";

export interface SendTemplateTarget {
  applicationId: string;
  name?: string;
  email?: string;
  phone?: string;
}

interface SendTemplateDialogProps {
  target: SendTemplateTarget | null;
  onClose: () => void;
}

const NONE = "__none__";

/**
 * Generic "send a template to this candidate" modal: pick any active email
 * and/or SMS template (any purpose), preview the filled-in text, and send.
 * The variables are filled with the candidate's data; link tokens have no
 * value here, so they stay visible in the preview.
 */
export function SendTemplateDialog({
  target,
  onClose,
}: SendTemplateDialogProps) {
  const queryClient = useQueryClient();
  const open = Boolean(target);

  const { data: emailData } = useTemplates(
    { channel: "email", activeOnly: true },
    { enabled: open },
  );
  const { data: smsData } = useTemplates(
    { channel: "sms", activeOnly: true },
    { enabled: open },
  );
  const emailTemplates = emailData?.data ?? [];
  const smsTemplates = smsData?.data ?? [];

  const [emailId, setEmailId] = useState(NONE);
  const [smsId, setSmsId] = useState(NONE);

  useEffect(() => {
    if (!open) return;
    setEmailId(NONE);
    setSmsId(NONE);
  }, [open, target?.applicationId]);

  const { data: variables } = useVariables({ enabled: open });
  const vars = useMemo(
    () => ({
      ...customValuesFromVariables(variables ?? []),
      ...buildCandidateVariables({
        fullName: target?.name,
        email: target?.email,
        phone: target?.phone,
      }),
    }),
    [variables, target?.name, target?.email, target?.phone],
  );

  const emailTpl = emailTemplates.find((t) => t.id === emailId);
  const smsTpl = smsTemplates.find((t) => t.id === smsId);
  const previewSubject = emailTpl
    ? applyTemplateVariables(emailTpl.subject, vars)
    : "";
  const previewBody = emailTpl
    ? applyTemplateVariables(emailTpl.body, vars)
    : "";
  const previewSms = smsTpl ? applyTemplateVariables(smsTpl.body, vars) : "";

  // Whether the chosen template(s) use the interview-link tokens. The backend
  // mints a fresh link for this candidate on send (replacing any prior link),
  // so the preview can't show the real URL, we surface a heads-up instead.
  const usesInterviewLinks = (() => {
    const texts: string[] = [];
    if (emailTpl) texts.push(emailTpl.subject, emailTpl.body);
    if (smsTpl) texts.push(smsTpl.body);
    return extractTokens(...texts).some((t) =>
      APPLICANT_LINK_TOKENS.includes(t),
    );
  })();

  const mutation = useMutation({
    mutationFn: () =>
      sendTemplateToApplicant(target!.applicationId, {
        emailTemplateId: emailId !== NONE ? emailId : undefined,
        smsTemplateId: smsId !== NONE ? smsId : undefined,
      }),
    onSuccess: (res) => {
      const parts = [res.emailSent ? "email" : null, res.smsSent ? "SMS" : null]
        .filter(Boolean)
        .join(" + ");
      toast.success(`Sent ${parts || "message"}.`);
      queryClient.invalidateQueries({ queryKey: ["applicants"] });
      onClose();
    },
    onError: (err: unknown) => {
      const message =
        (axios.isAxiosError(err) &&
          (err.response?.data as { message?: string } | undefined)?.message) ||
        (err instanceof Error ? err.message : null) ||
        "Could not send the template.";
      toast.error(message);
    },
  });

  const canSend = emailId !== NONE || smsId !== NONE;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (mutation.isPending) return;
        if (!next) onClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Send Email / SMS</DialogTitle>
          <DialogDescription>
            Send an email and/or SMS template to{" "}
            <strong>{target?.name || "this applicant"}</strong>. Placeholders
            are filled with their details.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">
              Email template
            </label>
            <Select value={emailId} onValueChange={setEmailId}>
              <SelectTrigger>
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {emailTemplates.map((tpl) => (
                  <SelectItem key={tpl.id} value={tpl.id}>
                    {tpl.name}
                    {` · ${humanizePurpose(tpl.purpose)}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {emailTpl ? (
              <div className="rounded-md border border-border bg-muted/40 p-2 text-[11px] text-muted-foreground">
                <p className="mb-1 font-medium text-foreground">
                  {previewSubject || "(no subject)"}
                </p>
                <p className="whitespace-pre-wrap">{previewBody}</p>
              </div>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">
              SMS template
            </label>
            <Select value={smsId} onValueChange={setSmsId}>
              <SelectTrigger>
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {smsTemplates.map((tpl) => (
                  <SelectItem key={tpl.id} value={tpl.id}>
                    {tpl.name}
                    {` · ${humanizePurpose(tpl.purpose)}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {smsTpl ? (
              <p className="whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-2 text-[11px] text-muted-foreground">
                {previewSms || "(empty)"}
              </p>
            ) : null}
          </div>

          {usesInterviewLinks ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-600 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                This template includes the interview link. A fresh link is
                generated for this applicant on send, which replaces any
                previous link they were sent, so the preview above shows the
                placeholder rather than the real URL.
              </span>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!canSend || mutation.isPending}
          >
            {mutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
