/**
 * Mirror of `ApplicantStatus` from
 * `jobjen-backend/src/modules/apply/schema/applicant.schema.ts`.
 *
 * Lifecycle:
 *   initial_pass       — passed both pre-screen rules (experience + city)
 *   initial_rejection  — failed at least one pre-screen rule
 *   ai_pass            — completed AI interview, recommendation in
 *                        (strong_yes | yes)
 *   ai_rejection       — completed AI interview, recommendation in
 *                        (maybe | no)
 *
 * The pre-screen is informational only — every applicant receives the
 * interview invite regardless of the verdict. The AI score is the
 * canonical hiring signal.
 *
 * `ApplicantStatus` is the legacy combined "latest stage" rollup —
 * preserved for backwards compatibility but the admin UI no longer
 * renders it directly. The new `InitialDecision` + `AiDecision` pair
 * (mirrored from the backend schema split) is rendered as two
 * side-by-side badges so the operator can see BOTH the pre-screen
 * verdict and the AI verdict at once.
 */
export type ApplicantStatus =
  | "initial_pass"
  | "initial_rejection"
  | "ai_pass"
  | "ai_rejection";

/** Pre-screen verdict, never overwritten by the AI stage. */
export type InitialDecision = "pass" | "rejection";

/**
 * AI scoring verdict. `null` while the candidate hasn't been scored
 * yet (interview pending / unscored / abandoned) — rendered by the
 * UI as a muted "Pending" pill.
 */
export type AiDecision = "pass" | "rejection";

/**
 * AI-verdict FILTER value (table dropdown). Superset of `AiDecision`
 * with `pending` (no verdict yet). Maps to the backend's
 * `aiDecision` query param.
 */
export type AiDecisionFilter = "pending" | "pass" | "rejection";

/**
 * One rendered status chip. `source: "system"` chips are derived
 * server-side from the Initial / AI decisions; `source: "manual"` chips
 * are operator-assigned pipeline labels (with remarks + audit). System chips
 * resolve their display (label text + colour) on the client from
 * `labelsCatalog.ts` via `key`; manual chips carry their live `label` + `color`
 * on the chip itself (so admin-edited / admin-created statuses paint without a
 * static lookup).
 */
export interface ApplicantChip {
  /** Manual chips only: the label doc id (lets the UI target it). */
  id?: string;
  key: string;
  source: "system" | "manual";
  remarks?: string;
  setByName?: string;
  setAt?: string;
  /** Scheduled interview time (ISO) — the `scheduled` chip only. */
  scheduledAt?: string;
  /** Meeting link — the `final_reject` / `final_pass` chips only. */
  link?: string;
  /** Manual chips only: display text (the live catalog label). */
  label?: string;
  /** Manual chips only: a Badge variant for the chip colour. */
  color?: string;
}

/**
 * Where a candidate sits in the AI-pending follow-up cycle. Mirrors the
 * backend `FollowupStage` from `apply-followup.service.ts`.
 *   not_invited  — invite withheld (video pending) / never sent.
 *   in_progress  — invited, awaiting reply; 0..total nudges sent so far.
 *   no_reply     — reached day 10 with no reply (terminal).
 *   opted_out    — clicked "Not Interested" (terminal).
 *   responded    — started the interview (dropped from the schedule).
 */
export type FollowupStage =
  | "not_invited"
  | "in_progress"
  | "no_reply"
  | "opted_out"
  | "responded";

/** Compact follow-up read-model attached to every applicant row. */
export interface FollowupSummary {
  stage: FollowupStage;
  /** Follow-up nudges sent so far (0..total). */
  sent: number;
  /** Total nudges in a full cycle (currently 4: days 2/4/6/8). */
  total: number;
  /** ISO of the most recent follow-up sent, or null. */
  lastSentAt: string | null;
  /** Day-from-first-invite the next action is due, or null when not running. */
  nextDueDay: number | null;
  /** ISO instant of the next action, or null. */
  nextDueAt: string | null;
  /** Day-from-invite the candidate is marked no_reply (informational). */
  noReplyDay: number;
}

/** One sent email in the drawer's follow-up timeline. */
export interface FollowupEmailRow {
  /** invite | followup | rejection | offer */
  type: string;
  attemptNumber: number;
  subject: string;
  to: string;
  sentAt: string | null;
  /** Async delivery outcome: sent | delivered | delayed | bounced | complained. */
  deliveryStatus: string;
  /** For bounces: permanent | transient | "". */
  bounceType: string;
}

/** One sent SMS in the drawer's follow-up timeline (companion to an email). */
export interface FollowupSmsRow {
  /** invite | followup | rejection | offer */
  type: string;
  attemptNumber: number;
  to: string;
  sentAt: string | null;
  /** Async delivery outcome from the DLR: sent | delivered | pending | failed. */
  deliveryStatus: string;
  /** How many times a failed DLR has been auto-resent (bounded). */
  retryCount: number;
}

/** Full follow-up lifecycle for one applicant (drawer detail). */
export interface FollowupTimeline {
  summary: FollowupSummary;
  inviteSentAt: string | null;
  terminal: { key: string; at: string | null } | null;
  emails: FollowupEmailRow[];
  /** Every pipeline SMS sent, oldest first (companion to the emails). */
  sms: FollowupSmsRow[];
}

export interface ApplicantListItem {
  applicationId: string;
  fullName: string;
  email: string;
  phoneNumber: string;
  city: string;
  /** Raw first-touch `utm_source` (lowercased; "" when none). */
  utmSource: string;
  /**
   * Marketing source derived server-side from `utmSource`: the raw stored tag,
   * or `direct` when no campaign tag. Drives the Source column + filter.
   */
  source: ApplicantSource;
  status: ApplicantStatus;
  initialDecision: InitialDecision;
  aiDecision: AiDecision | null;
  rejectionReason: string;
  /**
   * Unified status chips for the Status column = derived Initial/AI
   * verdicts + stored manual labels, assembled by the backend.
   */
  chips: ApplicantChip[];
  yearsOfExperience: number;
  primaryRole: string;
  cvUrl: string;
  /** Empty string when the candidate hasn't started their AI interview. */
  interviewSessionId: string;
  /**
   * Most recent attempt's sessionId, for the "View Result" drawer. Persists
   * across a reattempt (when `interviewSessionId` is cleared so the candidate
   * can start a fresh attempt), so the interview history stays openable.
   * Empty when the candidate never attempted.
   */
  latestInterviewSessionId: string;
  /**
   * Number of interview attempts the candidate has STARTED. `> 1` means they
   * reattempted, so the table shows a "Reattempted" marker on the name.
   */
  interviewAttemptCount: number;
  inviteSentAt: string | null;
  /**
   * ISO timestamp the candidate confirmed on the apply video step, or
   * `null` if they have not finished the intro video. Drives the Invite
   * Sent column's "Video pending" (not confirmed) vs "Email pending"
   * (confirmed, invite queued) distinction.
   */
  interviewConfirmedAt: string | null;
  tokenExpiresAt: string | null;
  lastBackgroundError: string;
  /**
   * Last invite-email send failure (empty when none). Independent of
   * `lastBackgroundError` (profile pipeline) — the Invite Sent column
   * renders "Failed" off this field.
   */
  inviteEmailError: string;
  /**
   * ISO timestamp the candidate clicked "Request a new interview link"
   * on the expired-link screen, or `null` when no request is pending.
   * Drives the "Link requested" row badge + the Link Requests queue.
   * Cleared server-side when an admin resends the invite.
   */
  linkRequestedAt: string | null;
  /** Where this candidate sits in the AI-pending follow-up cycle. */
  followup: FollowupSummary;
  /**
   * Set when the candidate's email hard-bounced or they complained, so all
   * automated email to them is suppressed. `null` = deliverable. Drives the
   * "Bounced/Suppressed" row indicator + filter.
   */
  emailSuppressedAt: string | null;
  /** Why suppressed: "hard_bounce" | "complaint" | "". */
  emailSuppressionReason: string;
  /**
   * Latest email delivery outcome (most recent email_log row), learned from
   * Resend webhooks: "" | sent | delivered | delayed | bounced | complained.
   * Drives the table's per-row email delivery chip. "" / "sent" render no chip
   * (outcome not yet known).
   */
  emailDeliveryStatus: string;
  /** Bounce class of that email: "permanent" | "transient" | "". */
  emailBounceType: string;
  /**
   * Latest SMS delivery outcome (most recent sms_log row's DLR status):
   * "" | sent | delivered | pending | failed. Drives the per-row SMS chip.
   */
  smsDeliveryStatus: string;
  /** Auto-resend count of that latest SMS (a failed DLR resends, bounded). */
  smsRetryCount: number;
  /**
   * Most recent technical-round invite (null = none sent). Once
   * `inviteSentAt` is set the technical-invite dialog locks the question
   * and only allows resending the same one.
   */
  technicalInvite: TechnicalInviteSummary | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** One picked question in a technical invite's snapshot. */
export interface TechnicalInviteQuestion {
  questionId: string;
  name: string;
  /** Answer environment (code-editor/canvas/notebook). Environments may repeat
   *  in an invite EXCEPT notebook, which is capped at one per invite. */
  environment: string;
  /** Free-form topic label (display only). */
  type: string;
}

/** Compact technical-round invite snapshot shown on the admin side. */
export interface TechnicalInviteSummary {
  /** The picked catalog questions, in order (one or more). */
  questions: TechnicalInviteQuestion[];
  inviteSentAt: string | null;
  tokenExpiresAt: string | null;
  inviteEmailError: string;
}

export interface ApplicantDetail extends ApplicantListItem {
  profileSummary: string;
  /**
   * Number of pre-cached interview questions on the applicant doc.
   * Non-zero means the background pre-screen finished question
   * generation; zero typically means the pass is still running or
   * crashed (check `lastBackgroundError`).
   */
  questionsCount: number;
}

export interface PaginatedApplicantsResponse {
  data: ApplicantListItem[];
  count: number;
  page: number;
  limit: number;
  totalPage: number;
  nextPage: number | null;
}

/**
 * Result ordering for the Applicants table. Mirrors the backend
 * `ApplicantSortOrder` enum one-for-one. `newest`/`oldest` sort by
 * `createdAt`; `scheduled_soonest`/`scheduled_latest` sort by the scheduled
 * interview date (applicants with no scheduled date sort last).
 */
export type ApplicantSortOrder =
  | "newest"
  | "oldest"
  | "scheduled_soonest"
  | "scheduled_latest";

/**
 * Marketing source for an applicant, derived server-side from the first-touch
 * `utm_source`. `direct` = arrived with no campaign tag; every other value is
 * the raw stored tag as-is (no fixed bucketing). The Source filter's options
 * are the distinct stored tags served by GET /admin/applicants/source-options,
 * so this is an open string rather than a fixed union.
 */
export type ApplicantSource = string;

export interface ListApplicantsParams {
  page?: number;
  limit?: number;
  /** Legacy combined-status filter (still supported; prefer the two below). */
  status?: ApplicantStatus;
  /** Pre-screen verdict filter. */
  initialDecision?: InitialDecision;
  /** AI verdict filter (`pending` = not yet scored). */
  aiDecision?: AiDecisionFilter;
  /** Manual verdict filter (catalog key, e.g. `manual_pass`). */
  label?: string;
  /** Scheduling-stage filter (`not_scheduled` | `scheduled`). */
  scheduling?: string;
  /** Final-decision filter (`final_decision_pending` | `final_reject` | `final_pass`). */
  finalDecision?: string;
  /** Activation filter (`non_active` | `active`). */
  activation?: string;
  /** Manual rejection email filter (`manual_rejection_not_sent` | `manual_rejection_sent`). */
  manualRejection?: string;
  /** Final rejection email filter (`final_rejection_not_sent` | `final_rejection_sent`). */
  finalRejection?: string;
  /** Candidate-response filter (`not_interested` | `no_reply`). */
  response?: string;
  /** "Not Interested Pre-Schedule" filter (`not_interested_pre_schedule`). */
  notInterestedPreSchedule?: string;
  /** "Not Interested Post-Final" filter (`not_interested_post_final`). */
  notInterestedPostFinal?: string;
  /** Pending "request a new link" filter (`pending`). */
  linkRequested?: "pending";
  /** Email-suppressed filter (`suppressed`), hard bounce / complaint. */
  emailSuppressed?: "suppressed";
  /** Marketing source bucket filter (`direct` | `linkedin` | `instagram` | `meta` | `other`). */
  source?: ApplicantSource;
  /** Generic pipeline-status filter: applicants must carry ALL these keys. */
  statusKeys?: string[];
  search?: string;
  /** Defaults to `"newest"` server-side when omitted. */
  sort?: ApplicantSortOrder;
}
