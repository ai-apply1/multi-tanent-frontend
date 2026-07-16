import type { BadgeProps } from "@/components/ui/badge";

/**
 * Front-end mirror of the backend `applicant-labels.catalog.ts`. Single
 * source of truth for how every status chip is displayed and which ones an
 * operator can assign. Keep keys + groups byte-for-byte in sync.
 *
 * Manual chips model the hiring pipeline in ordered stages:
 *   verdict -> scheduling -> final_decision -> activation
 * plus the parallel rejection-email dimensions (on reject paths) and the
 * `response` dimension (No Reply / Not Interested). The auto-seeded
 * placeholders ("Not Scheduled", "Manual Rejection Email", "Non Active", ...)
 * are PHYSICALLY stored server-side and rendered like any other chip; they
 * are never assigned directly by the operator.
 */
type BadgeVariant = NonNullable<BadgeProps["variant"]>;

export type LabelField = "scheduledAt" | "link" | "remarks";

export interface LabelDefinition {
  key: string;
  label: string;
  variant: BadgeVariant;
  source: "system" | "manual";
  group?: string;
  stageOrder?: number;
  /** Auto-seeded placeholder: stored, never assigned directly. */
  pending?: boolean;
  /** Written by a system side effect / cron, never assigned directly. */
  systemManaged?: boolean;
  terminal?: boolean;
  unlockedByKey?: string;
  fields?: LabelField[];
}

export const MANUAL_VERDICT_GROUP = "manual_review";
export const SCHEDULING_GROUP = "scheduling";
export const FINAL_DECISION_GROUP = "final_decision";
export const OFFER_EMAIL_GROUP = "offer_email";
export const ACTIVATION_GROUP = "activation";
export const MANUAL_REJECTION_GROUP = "manual_rejection_email";
export const FINAL_REJECTION_GROUP = "final_rejection_email";
export const RESPONSE_GROUP = "response";
// Stage-specific "candidate dropped out" markers, each its own single-member
// group so it carries its own filter (mirror of the backend catalog).
export const PRE_SCHEDULE_INTEREST_GROUP = "pre_schedule_interest";
export const POST_FINAL_INTEREST_GROUP = "post_final_interest";

export const APPLICANT_LABELS: Record<string, LabelDefinition> = {
  // System chips, derived server-side from initialDecision / aiDecision.
  initial_pass: {
    key: "initial_pass",
    label: "Initial pass",
    variant: "successSolid",
    source: "system",
  },
  initial_rejection: {
    key: "initial_rejection",
    label: "Initial rejection",
    variant: "destructiveSolid",
    source: "system",
  },
  ai_pass: {
    key: "ai_pass",
    label: "AI pass",
    variant: "successSolid",
    source: "system",
  },
  ai_rejection: {
    key: "ai_rejection",
    label: "AI rejection",
    variant: "destructiveSolid",
    source: "system",
  },
  ai_pending: {
    key: "ai_pending",
    label: "AI pending",
    variant: "muted",
    source: "system",
  },

  // Candidate response (set by cron / email button).
  no_reply: {
    key: "no_reply",
    label: "No Reply",
    variant: "muted",
    source: "manual",
    group: RESPONSE_GROUP,
    stageOrder: 0,
    systemManaged: true,
    terminal: true,
  },
  not_interested: {
    key: "not_interested",
    label: "Not Interested",
    variant: "warning",
    source: "manual",
    group: RESPONSE_GROUP,
    stageOrder: 0,
    terminal: true,
  },

  // Stage 3: manual verdict.
  // Auto-derived placeholder (server-side, like ai_pending): shows after the
  // AI verdict until a manual verdict is recorded. `pending: true` keeps it
  // out of the assignable modal options but in the verdict filter.
  manual_pending: {
    key: "manual_pending",
    label: "Manual Decision Pending",
    variant: "muted",
    source: "manual",
    group: MANUAL_VERDICT_GROUP,
    stageOrder: 1,
    pending: true,
  },
  manual_pass: {
    key: "manual_pass",
    label: "Manual Pass",
    variant: "successSolid",
    source: "manual",
    group: MANUAL_VERDICT_GROUP,
    stageOrder: 1,
  },
  manual_fail: {
    key: "manual_fail",
    label: "Manual Reject",
    variant: "destructiveSolid",
    source: "manual",
    group: MANUAL_VERDICT_GROUP,
    stageOrder: 1,
  },
  // Third verdict: park a candidate for later (neither pass nor reject). Amber
  // to read as a "hold" state, distinct from the green pass / red reject.
  manual_backlog: {
    key: "manual_backlog",
    label: "Backlog",
    variant: "warning",
    source: "manual",
    group: MANUAL_VERDICT_GROUP,
    stageOrder: 1,
  },

  // Stage 4B/5: scheduling.
  not_scheduled: {
    key: "not_scheduled",
    label: "Not Scheduled",
    variant: "muted",
    source: "manual",
    group: SCHEDULING_GROUP,
    stageOrder: 2,
    unlockedByKey: "manual_pass",
    pending: true,
  },
  scheduled: {
    key: "scheduled",
    label: "Scheduled",
    variant: "default",
    source: "manual",
    group: SCHEDULING_GROUP,
    stageOrder: 2,
    unlockedByKey: "manual_pass",
    fields: ["scheduledAt", "remarks"],
  },

  // Candidate dropped out before scheduling (terminal; unlocked by Manual Pass).
  not_interested_pre_schedule: {
    key: "not_interested_pre_schedule",
    label: "Not Interested Pre-Schedule",
    variant: "warning",
    source: "manual",
    group: PRE_SCHEDULE_INTEREST_GROUP,
    stageOrder: 2,
    unlockedByKey: "manual_pass",
    terminal: true,
  },

  // Stage 5/6: final decision.
  // Auto-seeded placeholder (server-side, like not_scheduled): written when
  // `scheduled` is added, so a scheduled candidate sits in "Final Decision
  // Pending" until a Final Pass / Final Reject replaces it. `pending: true`
  // keeps it out of the assignable modal but in the final-decision filter.
  final_decision_pending: {
    key: "final_decision_pending",
    label: "Final Decision Pending",
    variant: "muted",
    source: "manual",
    group: FINAL_DECISION_GROUP,
    stageOrder: 3,
    unlockedByKey: "scheduled",
    pending: true,
  },
  final_reject: {
    key: "final_reject",
    label: "Final Reject",
    variant: "destructiveSolid",
    source: "manual",
    group: FINAL_DECISION_GROUP,
    stageOrder: 3,
    unlockedByKey: "scheduled",
    fields: ["link", "remarks"],
  },
  final_pass: {
    key: "final_pass",
    label: "Final Pass",
    variant: "successSolid",
    source: "manual",
    group: FINAL_DECISION_GROUP,
    stageOrder: 3,
    unlockedByKey: "scheduled",
    fields: ["link", "remarks"],
  },

  // Offer email dimension (auto-seeded on Final Pass).
  offer_not_sent: {
    key: "offer_not_sent",
    label: "Offer Not Sent",
    variant: "warning",
    source: "manual",
    group: OFFER_EMAIL_GROUP,
    stageOrder: 4,
    pending: true,
  },
  offer_sent: {
    key: "offer_sent",
    label: "Offer Sent",
    variant: "successSolid",
    source: "manual",
    group: OFFER_EMAIL_GROUP,
    stageOrder: 4,
  },

  // Stage 7B: activation.
  non_active: {
    key: "non_active",
    label: "Non Active",
    variant: "muted",
    source: "manual",
    group: ACTIVATION_GROUP,
    stageOrder: 5,
    unlockedByKey: "final_pass",
    pending: true,
  },
  active: {
    key: "active",
    label: "Active",
    variant: "successSolid",
    source: "manual",
    group: ACTIVATION_GROUP,
    stageOrder: 5,
    unlockedByKey: "final_pass",
  },

  // Candidate dropped out after the final decision (terminal; unlocked by Final Pass).
  not_interested_post_final: {
    key: "not_interested_post_final",
    label: "Not Interested Post-Final",
    variant: "warning",
    source: "manual",
    group: POST_FINAL_INTEREST_GROUP,
    stageOrder: 4,
    unlockedByKey: "final_pass",
    terminal: true,
  },

  // Manual rejection email dimension (auto-seeded on manual_fail).
  manual_rejection_not_sent: {
    key: "manual_rejection_not_sent",
    label: "Pending Manual Rejection Email",
    variant: "muted",
    source: "manual",
    group: MANUAL_REJECTION_GROUP,
    stageOrder: 6,
    pending: true,
  },
  manual_rejection_sent: {
    key: "manual_rejection_sent",
    label: "Manual Rejection Email Sent",
    variant: "successSolid",
    source: "manual",
    group: MANUAL_REJECTION_GROUP,
    stageOrder: 6,
    systemManaged: true,
  },

  // Final rejection email dimension (auto-seeded on final_reject).
  final_rejection_not_sent: {
    key: "final_rejection_not_sent",
    label: "Pending Final Rejection Email",
    variant: "muted",
    source: "manual",
    group: FINAL_REJECTION_GROUP,
    stageOrder: 6,
    pending: true,
  },
  final_rejection_sent: {
    key: "final_rejection_sent",
    label: "Final Rejection Email Sent",
    variant: "successSolid",
    source: "manual",
    group: FINAL_REJECTION_GROUP,
    stageOrder: 6,
    systemManaged: true,
  },
};

const inGroup = (group: string) =>
  Object.values(APPLICANT_LABELS).filter((d) => d.group === group);

/** Verdict options for the Manual Verification modal + verdict filter. */
export const VERDICT_LABELS: LabelDefinition[] = inGroup(MANUAL_VERDICT_GROUP);
/** Scheduling-stage options (Not Scheduled / Scheduled) for the filter. */
export const SCHEDULING_LABELS: LabelDefinition[] = inGroup(SCHEDULING_GROUP);
/** Final-decision options (Final Decision Pending / Final Reject / Final Pass). */
export const FINAL_DECISION_LABELS: LabelDefinition[] =
  inGroup(FINAL_DECISION_GROUP);
/** Activation options (Non Active / Active). */
export const ACTIVATION_LABELS: LabelDefinition[] = inGroup(ACTIVATION_GROUP);
/** Manual rejection email options (auto-seeded on manual_fail). */
export const MANUAL_REJECTION_EMAIL_LABELS: LabelDefinition[] = inGroup(
  MANUAL_REJECTION_GROUP,
);
/** Final rejection email options (auto-seeded on final_reject). */
export const FINAL_REJECTION_EMAIL_LABELS: LabelDefinition[] = inGroup(
  FINAL_REJECTION_GROUP,
);
/** Rejection email options across both manual and final paths. */
export const REJECTION_EMAIL_LABELS: LabelDefinition[] = [
  ...MANUAL_REJECTION_EMAIL_LABELS,
  ...FINAL_REJECTION_EMAIL_LABELS,
];
/** Candidate-response options (Not Interested / No Reply). */
export const RESPONSE_LABELS: LabelDefinition[] = inGroup(RESPONSE_GROUP);
/** "Not Interested Pre-Schedule" filter option(s). */
export const PRE_SCHEDULE_INTEREST_LABELS: LabelDefinition[] = inGroup(
  PRE_SCHEDULE_INTEREST_GROUP,
);
/** "Not Interested Post-Final" filter option(s). */
export const POST_FINAL_INTEREST_LABELS: LabelDefinition[] = inGroup(
  POST_FINAL_INTEREST_GROUP,
);

/** Resolve a chip key to its display definition (null for unknown keys). */
export const resolveLabel = (key: string): LabelDefinition | null =>
  APPLICANT_LABELS[key] ?? null;

/** Minimal chip shape the unified resolver reads (a subset of ApplicantChip). */
interface ResolvableChip {
  key: string;
  source: "system" | "manual";
  label?: string;
  color?: string;
}

/**
 * Resolve ANY chip to its display text + Badge variant. Pipeline statuses are
 * stamped by the backend with their LIVE `label` + `color` (so an admin-edited
 * or admin-created status renders correctly with no static lookup); we render
 * those directly. System-derived chips (initial / AI verdicts) are not stamped,
 * so they fall back to the static catalog. Returns null for an unknown,
 * unstamped key so callers keep the existing "drop unknown chips" behaviour.
 */
export const resolveChipDisplay = (
  chip: ResolvableChip,
): { label: string; variant: BadgeVariant } | null => {
  if (chip.label) {
    return {
      label: chip.label,
      variant: (chip.color as BadgeVariant) ?? "muted",
    };
  }
  const def = resolveLabel(chip.key);
  return def ? { label: def.label, variant: def.variant } : null;
};

/** Display ordering for a chip (lower = earlier; unknown = last). */
export const stageOrderOf = (key: string): number =>
  APPLICANT_LABELS[key]?.stageOrder ?? 99;

// ── Action-unlock map (mirror of the backend) ───────────────────────────
export interface ActionUnlockRule {
  action: string;
  requiresAll: string[];
}

export const ACTION_UNLOCK_MAP: ActionUnlockRule[] = [
  { action: "schedule", requiresAll: ["manual_pass"] },
  { action: "final_decision", requiresAll: ["scheduled"] },
  { action: "activation", requiresAll: ["final_pass"] },
  { action: "rejection_email", requiresAll: ["manual_rejection_not_sent"] },
  { action: "rejection_email", requiresAll: ["final_rejection_not_sent"] },
];

/** Resolve the set of admin actions unlocked by a set of present chip keys. */
export const unlockedActions = (presentKeys: string[]): Set<string> => {
  const present = new Set(presentKeys);
  const out = new Set<string>();
  for (const rule of ACTION_UNLOCK_MAP) {
    if (rule.requiresAll.every((k) => present.has(k))) out.add(rule.action);
  }
  return out;
};
