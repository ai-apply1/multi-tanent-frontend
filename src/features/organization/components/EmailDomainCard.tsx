import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Loader2, RefreshCw } from "lucide-react";
import toast from "react-hot-toast";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { verifyEmailDomain } from "@/features/organization/organizationApi";
import type {
  EmailDomainRecord,
  EmailDomainStatus,
  OrgEmailDomain,
} from "@/features/organization/types";

/**
 * Exhaustive `Record`s rather than ternaries, so adding a status to the backend
 * enum breaks the build here instead of rendering a blank chip.
 *
 * The wording avoids alarm on purpose. Only `failed` is our problem; everything
 * else is either normal progress or waiting on the customer's own DNS, and an
 * admin who reads red will open a support ticket for something working exactly
 * as designed.
 */
const statusLabel: Record<EmailDomainStatus, string> = {
  verified: "Verified",
  pending: "Checking DNS",
  not_started: "Awaiting DNS records",
  not_configured: "Not set up",
  partially_verified: "Some records found",
  partially_failed: "Some records missing",
  temporary_failure: "Retrying",
  failed: "Verification failed",
};

const statusVariant: Record<
  EmailDomainStatus,
  "success" | "warning" | "muted" | "destructive"
> = {
  verified: "success",
  pending: "warning",
  not_started: "warning",
  partially_verified: "warning",
  partially_failed: "warning",
  temporary_failure: "warning",
  not_configured: "muted",
  failed: "destructive",
};

/** A record's own state. Resend's per-record vocabulary is not documented as a
 *  closed set, so this tolerates anything and only special-cases the good case. */
const recordVerified = (record: EmailDomainRecord) =>
  record.status.toLowerCase() === "verified";

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-emerald-500" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

interface EmailDomainCardProps {
  emailDomain: OrgEmailDomain;
  canWrite: boolean;
}

/**
 * The org's own email sending domain: what candidates see in `From:`, and the
 * DNS records the admin must publish to get there.
 *
 * Read-only apart from "Check again" — the domain is registered by the backend
 * when the org is provisioned, so there is nothing to create here and no free
 * text to get wrong.
 */
export function EmailDomainCard({ emailDomain, canWrite }: EmailDomainCardProps) {
  const queryClient = useQueryClient();

  const verifyMutation = useMutation({
    mutationFn: verifyEmailDomain,
    onSuccess: (result) => {
      // Refetch the profile rather than trusting the response: the card renders
      // from the profile, and two copies of this state would drift.
      void queryClient.invalidateQueries({ queryKey: ["organization"] });
      if (result.active) {
        toast.success(`Verified. Emails now send from ${result.fromAddress}.`);
      } else {
        const missing = result.records.filter((r) => !recordVerified(r)).length;
        toast(
          missing > 0
            ? `Not verified yet: ${missing} of ${result.records.length} records still aren't visible. DNS can take a while to propagate.`
            : "Checked. Resend hasn't confirmed the records yet.",
        );
      }
    },
    onError: () => {
      toast.error("Could not check the domain. Please try again.");
    },
  });

  const notSetUp = emailDomain.status === "not_configured";

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>Email domain</CardTitle>
            <CardDescription>
              {emailDomain.active
                ? "Candidate emails are sent from your own domain."
                : "Add these records at your DNS provider to send candidate emails from your own domain."}
            </CardDescription>
          </div>
          <Badge variant={statusVariant[emailDomain.status]}>
            {statusLabel[emailDomain.status]}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* The single most useful line on the card: what a candidate actually
            sees. Resolved by the backend, never guessed here. */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Emails are sent from</span>
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
            {emailDomain.fromAddress}
          </code>
          {!emailDomain.active && !notSetUp ? (
            <span className="text-xs text-muted-foreground">
              until the records below are verified
            </span>
          ) : null}
        </div>

        {emailDomain.error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {emailDomain.error}
          </p>
        ) : null}

        {notSetUp ? (
          <p className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            No sending domain is set up for your organization yet, so candidate
            emails come from our address. Contact support to enable it.
          </p>
        ) : null}

        {emailDomain.records.length > 0 ? (
          <div className="space-y-2">
            {/* Deliberately a list of rows rather than a <table>: the values are
                long (a DKIM key is ~400 chars) and each one needs its own copy
                button, which a table cell handles badly on a narrow screen. */}
            {emailDomain.records.map((record) => (
              <div
                key={`${record.type}-${record.name}`}
                className="rounded-md border border-border/60 p-3"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {record.type}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {record.record}
                  </span>
                  {recordVerified(record) ? (
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      not found yet
                    </span>
                  )}
                </div>

                <dl className="space-y-1.5 text-xs">
                  <div className="flex items-start gap-2">
                    <dt className="w-16 shrink-0 text-muted-foreground">Name</dt>
                    <dd className="flex-1 break-all font-mono">{record.name}</dd>
                    <CopyButton value={record.name} label="name" />
                  </div>
                  <div className="flex items-start gap-2">
                    <dt className="w-16 shrink-0 text-muted-foreground">Value</dt>
                    <dd className="flex-1 break-all font-mono">{record.value}</dd>
                    <CopyButton value={record.value} label="value" />
                  </div>
                  {record.priority !== null ? (
                    <div className="flex items-start gap-2">
                      <dt className="w-16 shrink-0 text-muted-foreground">
                        Priority
                      </dt>
                      <dd className="flex-1 font-mono">{record.priority}</dd>
                    </div>
                  ) : null}
                  <div className="flex items-start gap-2">
                    <dt className="w-16 shrink-0 text-muted-foreground">TTL</dt>
                    <dd className="flex-1 font-mono">{record.ttl}</dd>
                  </div>
                </dl>
              </div>
            ))}

            {canWrite ? (
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => verifyMutation.mutate()}
                  disabled={verifyMutation.isPending}
                >
                  {verifyMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  Check again
                </Button>
                <p className="text-xs text-muted-foreground">
                  DNS changes can take up to a few hours to appear. We keep
                  checking on our own, so you can close this page.
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
