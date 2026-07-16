import type { BadgeProps } from "@/components/ui/badge";
import type {
  FollowupStage,
  FollowupSummary,
} from "@/features/applicants/types";

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

/** Human-readable label for each follow-up stage. */
export const FOLLOWUP_STAGE_LABEL: Record<FollowupStage, string> = {
  not_invited: "Not in cycle",
  in_progress: "Following up",
  no_reply: "No reply",
  opted_out: "Opted out",
  responded: "Responded",
};

export interface FollowupDisplay {
  /** Short text for the row badge, e.g. "Follow-up 2/4" or "Awaiting reply". */
  label: string;
  variant: BadgeVariant;
  /**
   * Whether to render a row badge for this stage. Only the in-flight
   * `in_progress` stage gets a row badge, the terminal states (no_reply /
   * opted_out) already show as Status chips, and responded/not_invited are
   * conveyed elsewhere, so we don't duplicate them in the Invite column.
   */
  showOnRow: boolean;
}

/**
 * Badge for a single email's async delivery outcome (drawer timeline).
 * Returns null for "sent" (outcome not yet known, no badge needed).
 */
export function deliveryBadge(
  status: string,
  bounceType?: string,
): { label: string; variant: BadgeVariant } | null {
  switch (status) {
    case "delivered":
      return { label: "Delivered", variant: "success" };
    case "delayed":
      return { label: "Delayed", variant: "warning" };
    case "bounced":
      return {
        label: bounceType === "transient" ? "Bounced (soft)" : "Bounced",
        variant: "destructive",
      };
    case "complained":
      return { label: "Complained", variant: "destructive" };
    default:
      return null;
  }
}

/**
 * Badge for a single SMS's async delivery outcome (drawer timeline + table).
 * Unlike email (whose Resend webhook reliably confirms delivery), the VeevoTech
 * DLR is often not wired up, so an SMS can sit at "sent" indefinitely. We render
 * a muted "Sent" chip for that state (rather than nothing) so the operator can
 * always see an SMS went out and is awaiting a delivery report. It flips to
 * green "Delivered" / red "Failed" once a DLR arrives. A failed SMS that was
 * auto-resent shows "Failed (resent)" so the recovery is visible. Returns null
 * only when no SMS exists yet ("").
 */
export function smsDeliveryBadge(
  status: string,
  retryCount?: number,
): { label: string; variant: BadgeVariant } | null {
  switch (status) {
    case "delivered":
      return { label: "Delivered", variant: "success" };
    case "pending":
      return { label: "Sending", variant: "warning" };
    case "sent":
      return { label: "Sent", variant: "muted" };
    case "failed":
      return {
        label: (retryCount ?? 0) > 0 ? "Failed (resent)" : "Failed",
        variant: "destructive",
      };
    default:
      return null;
  }
}

/** Short label for an applicant-level email suppression reason. */
export function emailSuppressionLabel(reason: string): string {
  return reason === "complaint" ? "Spam complaint" : "Email bounced";
}

/** Resolve a follow-up summary to its compact row-badge presentation. */
export function followupDisplay(f: FollowupSummary): FollowupDisplay {
  switch (f.stage) {
    case "in_progress":
      return {
        // Both in-progress states ("Awaiting reply" and "Follow-up X/Y") use
        // the purple `default` variant; the distinct labels keep them readable
        // next to the purple "Link requested" row badge (a separate signal).
        label: f.sent > 0 ? `Follow-up ${f.sent}/${f.total}` : "Awaiting reply",
        variant: "default",
        showOnRow: true,
      };
    case "no_reply":
      return { label: "No reply", variant: "muted", showOnRow: false };
    case "opted_out":
      return { label: "Opted out", variant: "warning", showOnRow: false };
    case "responded":
      return { label: "Responded", variant: "success", showOnRow: false };
    case "not_invited":
    default:
      return { label: "Not in cycle", variant: "muted", showOnRow: false };
  }
}
