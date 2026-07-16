import { useEffect, useState } from "react";
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
  unfillableTokens,
  useVariables,
} from "@/features/templates/useVariables";
import { APPLICANT_LINK_TOKENS } from "@/features/templates/templateVariables";
import { humanizePurpose } from "@/features/templates/types";
import { bulkSendTemplate } from "@/features/applicants/applicantsApi";

interface BulkSendTemplateDialogProps {
  open: boolean;
  applicationIds: string[];
  onClose: () => void;
  onSent: () => void;
}

const NONE = "__none__";

/**
 * Generic bulk send: pick an email and/or SMS template and deliver it to the
 * selected applicants (variables filled per recipient). Blocks when a chosen
 * template uses a token a generic send cannot fill (e.g. the interview link).
 */
export function BulkSendTemplateDialog({
  open,
  applicationIds,
  onClose,
  onSent,
}: BulkSendTemplateDialogProps) {
  const queryClient = useQueryClient();
  const count = applicationIds.length;

  const { data: emailData } = useTemplates(
    { channel: "email", activeOnly: true },
    { enabled: open },
  );
  const { data: smsData } = useTemplates(
    { channel: "sms", activeOnly: true },
    { enabled: open },
  );
  const { data: variables } = useVariables({ enabled: open });
  const emailTemplates = emailData?.data ?? [];
  const smsTemplates = smsData?.data ?? [];

  const [emailId, setEmailId] = useState(NONE);
  const [smsId, setSmsId] = useState(NONE);

  useEffect(() => {
    if (!open) return;
    setEmailId(NONE);
    setSmsId(NONE);
  }, [open]);

  const emailTpl = emailTemplates.find((t) => t.id === emailId);
  const smsTpl = smsTemplates.find((t) => t.id === smsId);

  // Interview-link tokens are minted per recipient by the backend, so they no
  // longer block; only truly unfillable context tokens (e.g. {{code}}) do.
  const texts: string[] = [];
  if (emailTpl) texts.push(emailTpl.subject, emailTpl.body);
  if (smsTpl) texts.push(smsTpl.body);
  const blocked = unfillableTokens(texts, variables ?? [], {
    withInterviewLinks: true,
  });

  // Whether the chosen template(s) use the interview-link tokens. When they do
  // we show a heads-up that a fresh link is generated (and the prior one
  // revoked) for every selected applicant.
  const usesInterviewLinks = unfillableTokens(texts, variables ?? []).some(
    (t) => APPLICANT_LINK_TOKENS.includes(t),
  );

  const mutation = useMutation({
    mutationFn: () =>
      bulkSendTemplate(applicationIds, {
        emailTemplateId: emailId !== NONE ? emailId : undefined,
        smsTemplateId: smsId !== NONE ? smsId : undefined,
      }),
    onSuccess: (res) => {
      toast.success(
        `Sending to ${res.requested} applicant${res.requested === 1 ? "" : "s"} in the background. This can take a moment to finish.`,
      );
      queryClient.invalidateQueries({ queryKey: ["applicants"] });
      onSent();
      onClose();
    },
    onError: (err: unknown) => {
      const message =
        (axios.isAxiosError(err) &&
          (err.response?.data as { message?: string } | undefined)?.message) ||
        (err instanceof Error ? err.message : null) ||
        "Could not send the templates.";
      toast.error(message);
    },
  });

  const canSend = (emailId !== NONE || smsId !== NONE) && blocked.length === 0;

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
            Send a template to the <strong>{count}</strong> selected applicant
            {count === 1 ? "" : "s"}. Pick an email template, an SMS template,
            or both; variables are filled per recipient.
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
                <SelectItem value={NONE}>None (no email)</SelectItem>
                {emailTemplates.map((tpl) => (
                  <SelectItem key={tpl.id} value={tpl.id}>
                    {tpl.name}
                    {` · ${humanizePurpose(tpl.purpose)}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
                <SelectItem value={NONE}>None (no SMS)</SelectItem>
                {smsTemplates.map((tpl) => (
                  <SelectItem key={tpl.id} value={tpl.id}>
                    {tpl.name}
                    {` · ${humanizePurpose(tpl.purpose)}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {blocked.length > 0 ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-[11px] text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                This template uses{" "}
                <span className="font-mono">
                  {blocked.map((t) => `{{${t}}}`).join(", ")}
                </span>
                , which this send cannot fill. Use the matching action instead,
                e.g. the training login code send.
              </span>
            </div>
          ) : usesInterviewLinks ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-600 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                This template includes the interview link. A fresh link is
                generated for each selected applicant, which replaces any
                previous link they were sent.
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
            Send to {count}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
