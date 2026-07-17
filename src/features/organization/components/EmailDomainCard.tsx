import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  AlertCircle,
  Check,
  Clock,
  Copy,
  Loader2,
  RefreshCw,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import toast from "react-hot-toast"
import { Button } from "@/components/ui/button"
import { verifyEmailDomain } from "@/features/organization/organizationApi"
import type {
  EmailDomainRecord,
  EmailDomainStatus,
  OrgEmailDomain,
} from "@/features/organization/types"

/**
 * Exhaustive `Record`s rather than ternaries, so adding a status to the backend
 * enum breaks the build here instead of rendering a blank chip.
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
}

type ChipTone = "success" | "warning" | "danger" | "muted"

const statusTone: Record<EmailDomainStatus, ChipTone> = {
  verified: "success",
  pending: "warning",
  not_started: "warning",
  partially_verified: "warning",
  partially_failed: "warning",
  temporary_failure: "warning",
  not_configured: "muted",
  failed: "danger",
}

const toneChipClass: Record<ChipTone, string> = {
  success: "bg-[var(--success-soft)] text-[var(--success)]",
  warning: "bg-[var(--warning-soft)] text-[var(--warning)]",
  danger: "bg-[var(--danger-soft)] text-[var(--danger)]",
  muted: "bg-surface-3 text-ink-muted",
}

const toneIcon: Record<ChipTone, LucideIcon> = {
  success: Check,
  warning: Clock,
  danger: AlertCircle,
  muted: Clock,
}

/** A record's own state. Resend's per-record vocabulary is not documented as a
 *  closed set, so this tolerates anything and only special-cases the good case. */
const recordVerified = (record: EmailDomainRecord) =>
  record.status.toLowerCase() === "verified"

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-subtle transition-colors hover:bg-surface-3 hover:text-ink"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-[var(--success)]" strokeWidth={1.9} />
      ) : (
        <Copy className="h-3.5 w-3.5" strokeWidth={1.7} />
      )}
    </button>
  )
}

interface EmailDomainCardProps {
  emailDomain: OrgEmailDomain
  canWrite: boolean
}

/**
 * The org's own email sending domain: what candidates see in `From:`, and the
 * DNS records the admin must publish to get there.
 *
 * Read-only apart from "Re-verify" — the domain is registered by the backend
 * when the org is provisioned, so there is nothing to create here and no free
 * text to get wrong.
 */
export function EmailDomainCard({ emailDomain, canWrite }: EmailDomainCardProps) {
  const queryClient = useQueryClient()

  const verifyMutation = useMutation({
    mutationFn: verifyEmailDomain,
    onSuccess: (result) => {
      // Refetch the profile rather than trusting the response: the card renders
      // from the profile, and two copies of this state would drift.
      void queryClient.invalidateQueries({ queryKey: ["organization"] })
      if (result.active) {
        toast.success(`Verified. Emails now send from ${result.fromAddress}.`)
      } else {
        const missing = result.records.filter((r) => !recordVerified(r)).length
        toast(
          missing > 0
            ? `Not verified yet: ${missing} of ${result.records.length} records still aren't visible. DNS can take a while to propagate.`
            : "Checked. Resend hasn't confirmed the records yet.",
        )
      }
    },
    onError: () => {
      toast.error("Could not check the domain. Please try again.")
    },
  })

  const notSetUp = emailDomain.status === "not_configured"
  const tone = statusTone[emailDomain.status]
  const StatusIcon = toneIcon[tone]

  return (
    <div className="rounded-2xl border border-line bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-ink">
            Email sending domain
          </h3>
          <p className="mt-1.5 text-[13.5px] text-ink-muted leading-relaxed">
            {emailDomain.active
              ? "Candidate emails are sent from your own domain."
              : "Add these records at your DNS provider to send candidate emails from your own domain."}
          </p>
        </div>
        <span
          className={
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold " +
            toneChipClass[tone]
          }
        >
          <StatusIcon className="h-3.5 w-3.5" strokeWidth={1.9} />
          {statusLabel[emailDomain.status]}
        </span>
      </div>

      <div className="mt-4 space-y-4">
        {/* The single most useful line on the card: what a candidate actually
            sees. Resolved by the backend, never guessed here. */}
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-ink-muted">Emails are sent from</span>
          <code className="mono rounded-md bg-surface-2 border border-line px-2 py-0.5 text-[12.5px] text-ink">
            {emailDomain.fromAddress}
          </code>
          {!emailDomain.active && !notSetUp ? (
            <span className="text-[12px] text-ink-subtle">
              until the records below are verified
            </span>
          ) : null}
        </div>

        {emailDomain.error ? (
          <p className="rounded-lg border border-[color-mix(in_srgb,var(--danger),transparent_60%)] bg-[var(--danger-soft)] px-3 py-2 text-[12.5px] text-[var(--danger)]">
            {emailDomain.error}
          </p>
        ) : null}

        {notSetUp ? (
          <p className="rounded-lg border border-line bg-surface-2 px-3.5 py-3 text-[13px] text-ink-muted">
            No sending domain is set up for your organization yet, so candidate
            emails come from our address. Contact support to enable it.
          </p>
        ) : null}

        {emailDomain.records.length > 0 ? (
          <div className="space-y-2">
            {/* Column header row, keeps the mono grid legible when there are
                multiple records. */}
            <div className="hidden sm:grid grid-cols-[80px_140px_1fr_auto] gap-3 items-center px-3 text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-subtle">
              <span>Type</span>
              <span>Host</span>
              <span>Value</span>
              <span className="sr-only">Copy</span>
            </div>

            {emailDomain.records.map((record) => (
              <div
                key={`${record.type}-${record.name}`}
                className="rounded-lg border border-line bg-surface-2 p-3 grid grid-cols-[80px_140px_1fr_auto] gap-3 items-center text-[12.5px] mono"
              >
                <span className="inline-flex items-center gap-1.5 text-ink font-semibold">
                  {recordVerified(record) ? (
                    <Check
                      className="h-3.5 w-3.5 text-[var(--success)]"
                      strokeWidth={2}
                    />
                  ) : (
                    <Clock
                      className="h-3.5 w-3.5 text-ink-subtle"
                      strokeWidth={1.9}
                    />
                  )}
                  {record.type}
                </span>
                <span className="truncate text-ink-2" title={record.name}>
                  {record.name}
                </span>
                <span className="truncate text-ink-2" title={record.value}>
                  {record.value}
                </span>
                <CopyButton value={record.value} label="value" />
              </div>
            ))}

            {canWrite ? (
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => verifyMutation.mutate()}
                  disabled={verifyMutation.isPending}
                >
                  {verifyMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" strokeWidth={1.7} />
                  )}
                  Re-verify
                </Button>
                <p className="text-[12px] text-ink-subtle">
                  DNS changes can take up to a few hours to appear. We keep
                  checking on our own, so you can close this page.
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
