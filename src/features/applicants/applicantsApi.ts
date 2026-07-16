import api from "@/lib/api";
import type {
  ApplicantDetail,
  ApplicantListItem,
  FollowupTimeline,
  ListApplicantsParams,
  PaginatedApplicantsResponse,
} from "@/features/applicants/types";

/**
 * Filter query params shared by the list + CSV export (page/limit excluded).
 * Keeping one builder means an export "with current filters" hits exactly the
 * same server-side filter set the table is showing.
 */
function buildApplicantFilterParams(
  params: ListApplicantsParams,
): Record<string, string | string[]> {
  return {
    ...(params.statusKeys && params.statusKeys.length
      ? { statusKeys: params.statusKeys }
      : {}),
    ...(params.status ? { status: params.status } : {}),
    ...(params.initialDecision
      ? { initialDecision: params.initialDecision }
      : {}),
    ...(params.aiDecision ? { aiDecision: params.aiDecision } : {}),
    ...(params.label ? { label: params.label } : {}),
    ...(params.scheduling ? { scheduling: params.scheduling } : {}),
    ...(params.finalDecision ? { finalDecision: params.finalDecision } : {}),
    ...(params.activation ? { activation: params.activation } : {}),
    ...(params.manualRejection
      ? { manualRejection: params.manualRejection }
      : {}),
    ...(params.finalRejection ? { finalRejection: params.finalRejection } : {}),
    ...(params.response ? { response: params.response } : {}),
    ...(params.notInterestedPreSchedule
      ? { notInterestedPreSchedule: params.notInterestedPreSchedule }
      : {}),
    ...(params.notInterestedPostFinal
      ? { notInterestedPostFinal: params.notInterestedPostFinal }
      : {}),
    ...(params.linkRequested ? { linkRequested: params.linkRequested } : {}),
    ...(params.emailSuppressed
      ? { emailSuppressed: params.emailSuppressed }
      : {}),
    ...(params.source ? { source: params.source } : {}),
    ...(params.search?.trim() ? { search: params.search.trim() } : {}),
    // Only send `sort` when it diverges from the server default ("newest").
    ...(params.sort && params.sort !== "newest" ? { sort: params.sort } : {}),
  };
}

export async function listApplicants(params: ListApplicantsParams = {}) {
  const { data } = await api.get<PaginatedApplicantsResponse>(
    "/admin/applicants",
    {
      params: {
        page: params.page ?? 1,
        limit: params.limit ?? 25,
        ...buildApplicantFilterParams(params),
      },
    },
  );
  return data;
}

/**
 * CSV export. Honours the SAME filters as `listApplicants` (pass the current
 * filter params), or pass `{}` to export everyone. The backend returns the CSV
 * string inside the encrypted JSON envelope; the caller turns it into a file
 * download (no pagination, capped server-side).
 */
export async function exportApplicantsCsv(params: ListApplicantsParams = {}) {
  const { data } = await api.get<{
    filename: string;
    csv: string;
    count: number;
    truncated: boolean;
  }>("/admin/applicants/export", {
    params: buildApplicantFilterParams(params),
  });
  return data;
}

/**
 * Options for the Source filter dropdown, built LIVE from the DB: `direct`
 * (untagged applicants) plus every distinct raw `utmSource` tag currently
 * stored, alphabetically. Callers prepend their own "All sources" entry.
 * Shared by the Applicants page filter and the Overview page source overlay.
 */
export async function getSourceOptions() {
  const { data } = await api.get<{ sources: string[] }>(
    "/admin/applicants/source-options",
  );
  return data.sources;
}

export async function getApplicant(applicationId: string) {
  const { data } = await api.get<ApplicantDetail>(
    `/admin/applicants/${applicationId}`,
  );
  return data;
}

/**
 * Count of applicants with a pending "request a new interview link"
 * (the candidate clicked the expired-link button, not yet resolved by a
 * resend). Backs the sidebar count badge on the Link Requests tab.
 */
export async function getLinkRequestCount() {
  const { data } = await api.get<{ count: number }>(
    "/admin/applicants/link-requests/count",
  );
  return data.count;
}

/**
 * Full AI-pending follow-up lifecycle for one applicant: the computed
 * stage, the day-0 invite marker, and every pipeline email sent. Backs
 * the interview drawer's "Follow-up lifecycle" timeline.
 */
export async function getFollowupTimeline(applicationId: string) {
  const { data } = await api.get<FollowupTimeline>(
    `/admin/applicants/${applicationId}/followup`,
  );
  return data;
}

/**
 * Mint a short-lived presigned GET URL for this applicant's CV.
 * Required because the S3 bucket is private (raw `applicant.cvUrl`
 * returns S3's `AccessDenied` XML to an anonymous browser). The
 * caller is expected to call this on the click handler and then
 * `window.open(url, "_blank")` the response — see ApplicantsPage
 * for the popup-blocker-safe pattern.
 */
export async function getApplicantCvUrl(applicationId: string) {
  const { data } = await api.get<{ url: string; expiresIn: number }>(
    `/admin/applicants/${applicationId}/cv`,
  );
  return data;
}

export async function deleteApplicant(applicationId: string) {
  const { data } = await api.delete<{
    success: boolean;
    applicationId: string;
    deletedInterview: string | null;
  }>(`/admin/applicants/${applicationId}`);
  return data;
}

/**
 * Re-mint a fresh interview-invite JWT and re-send the candidate
 * their email. Refreshes the link only — the candidate RESUMES any
 * existing session. Use `reattemptInterview` to let them take the
 * interview again while keeping the prior attempt as history.
 */
export async function resendInvite(applicationId: string) {
  const { data } = await api.post<{
    success: boolean;
    applicationId: string;
    tokenExpiresAt: string;
  }>(`/admin/applicants/${applicationId}/resend-invite`, {});
  return data;
}

/**
 * Send a TECHNICAL-round invite for one or more picked catalog questions
 * (ordered). Mints a technical magic link (separate from the AI token) and
 * emails it to the candidate. Independent of the AI-interview invite above.
 */
export async function sendTechnicalInvite(
  applicationId: string,
  payload: { questionIds: string[]; force?: boolean }
) {
  const { data } = await api.post<{
    success: boolean
    applicationId: string
    tokenExpiresAt: string
    resendId: string
  }>(`/admin/applicants/${applicationId}/send-technical-invite`, payload)
  return data
}

/**
 * Re-open the AI interview stage so the candidate can take it AGAIN,
 * keeping every prior attempt as history. FULL reset: the AI verdict goes
 * back to pending AND every manual pipeline status is cleared (logged to the
 * status history), then a fresh token is minted and a new link emailed, all
 * in one call. The previous interview's RESULTS (recording / transcript /
 * scores) are untouched and stay reachable via the detail drawer's version
 * dropdown. `statusesCleared` reports how many pipeline statuses were reset.
 */
export async function reattemptInterview(applicationId: string) {
  const { data } = await api.post<{
    success: boolean;
    applicationId: string;
    attemptCount: number;
    statusesCleared: number;
    tokenExpiresAt: string;
    resendId: string;
  }>(`/admin/applicants/${applicationId}/reattempt-interview`, {});
  return data;
}

export interface AssignApplicantLabelPayload {
  key: string;
  remarks?: string;
  /** ISO string — required when key === "scheduled". */
  scheduledAt?: string;
  /** URL — used for scheduled interview link and final decision meeting link. */
  link?: string;
}

/**
 * Assign a manual status to an applicant (verdict or a pipeline stage:
 * Scheduled / Final Decision), with optional typed fields + remark.
 * Returns the refreshed applicant whose `chips` reflect the new state.
 */
export async function assignApplicantLabel(
  applicationId: string,
  payload: AssignApplicantLabelPayload,
) {
  const body: Record<string, unknown> = { key: payload.key };
  if (payload.remarks?.trim()) body.remarks = payload.remarks.trim();
  if (payload.scheduledAt) body.scheduledAt = payload.scheduledAt;
  if (payload.link?.trim()) body.link = payload.link.trim();
  const { data } = await api.post<ApplicantDetail>(
    `/admin/applicants/${applicationId}/labels`,
    body,
  );
  return data;
}

/** Remove a manual label / status from an applicant by its catalog key. */
export async function removeApplicantLabel(applicationId: string, key: string) {
  const { data } = await api.delete<ApplicantDetail>(
    `/admin/applicants/${applicationId}/labels/${encodeURIComponent(key)}`,
  );
  return data;
}

/**
 * Generic send: deliver an arbitrary active email and/or SMS template to the
 * candidate ad-hoc (variables substituted server-side). At least one id.
 */
export async function sendTemplateToApplicant(
  applicationId: string,
  payload: { emailTemplateId?: string; smsTemplateId?: string },
) {
  const { data } = await api.post<{
    success: boolean;
    emailSent: boolean;
    smsSent: boolean;
  }>(`/admin/applicants/${applicationId}/send-template`, payload);
  return data;
}

/** Generic bulk send: a chosen email/SMS template to many selected rows. */
export async function bulkSendTemplate(
  applicationIds: string[],
  payload: { emailTemplateId?: string; smsTemplateId?: string },
) {
  // Fire-and-forget: validated synchronously, then sent in the background.
  const { data } = await api.post<{ accepted: boolean; requested: number }>(
    "/admin/applicants/bulk-send-template",
    { applicationIds, ...payload },
  );
  return data;
}

/** History timeline row for an applicant's status changes. */
export interface StatusHistoryRow {
  statusKey: string;
  label: string;
  action: string;
  fromKey: string;
  fromLabel: string;
  actorType: string;
  actorName: string;
  reason: string;
  createdAt: string | null;
}

/** Fetch the full hiring-pipeline status-change timeline for an applicant. */
export async function getApplicantHistory(applicationId: string) {
  const { data } = await api.get<StatusHistoryRow[]>(
    `/admin/applicants/${applicationId}/history`,
  );
  return data;
}

/**
 * Cascade-delete many applicants in one call (multi-select). Fire-and-forget:
 * the backend accepts the job and removes each applicant in the background
 * (sequential, since each delete fans out into several S3 + Mongo ops;
 * partial-failure tolerant), so the admin isn't blocked while N applicants are
 * removed.
 */
export async function bulkDeleteApplicants(applicationIds: string[]) {
  const { data } = await api.post<{ accepted: boolean; requested: number }>(
    "/admin/applicants/bulk-delete",
    { applicationIds },
  );
  return data;
}

/**
 * Re-send the interview invite to many applicants at once. Sent
 * sequentially server-side (Resend rate limits); `failed` lists any
 * addresses Resend rejected (e.g. unverified domain) without aborting
 * the rest.
 */
export async function bulkResendInvites(applicationIds: string[]) {
  // Fire-and-forget: the backend accepts the job and sends in the background.
  const { data } = await api.post<{ accepted: boolean; requested: number }>(
    "/admin/applicants/bulk-resend-invite",
    { applicationIds },
  );
  return data;
}

/**
 * Restart the AI-interview follow-up lifecycle for one applicant: re-open the
 * cycle, set the no-reply cutoff to `days` (2-10, nudges every 2 days up to
 * it), and send a fresh invite now. The backend rejects ineligible candidates
 * (already attempted / opted out / suppressed).
 */
export async function restartFollowup(applicationId: string, days: number) {
  const { data } = await api.post<{
    success: boolean;
    applicationId: string;
    noReplyDay: number;
    tokenExpiresAt: string;
  }>(`/admin/applicants/${applicationId}/restart-followup`, { days });
  return data;
}

/**
 * Restart the follow-up lifecycle for many applicants at once. Fire-and-forget:
 * the backend accepts the job and restarts each lifecycle in the background
 * (sequential, since each restart sends an invite; ineligible / failed ids are
 * skipped without aborting the rest), so the admin isn't blocked while N
 * lifecycles process.
 */
export async function bulkRestartFollowup(
  applicationIds: string[],
  days: number,
) {
  const { data } = await api.post<{ accepted: boolean; requested: number }>(
    "/admin/applicants/bulk-restart-followup",
    { applicationIds, days },
  );
  return data;
}

/**
 * Result shape from `POST /admin/applicants/cleanup-broken-cvs`.
 * See `AdminApplicantsService.cleanupBrokenCvs` for what each
 * counter means.
 */
export interface CleanupBrokenCvsResult {
  checked: number;
  deleted: number;
  stillHealthy: number;
  deletedApplicants: Array<{ applicationId: string; email: string }>;
}

/**
 * One-shot migration helper: scan applicants whose `cvKey` is still
 * in the pre-May-2026 `pending/` quarantine prefix, then cascade-
 * delete the ones whose S3 object has already been swept by the
 * bucket's lifecycle rule. Healthy rows are left alone.
 *
 * Idempotent — operators can re-invoke until `checked === 0` if a
 * very large backlog needs draining (the endpoint processes up to
 * 200 candidates per call).
 */
export async function cleanupBrokenCvs() {
  const { data } = await api.post<CleanupBrokenCvsResult>(
    "/admin/applicants/cleanup-broken-cvs",
    {},
  );
  return data;
}

/** Returned by `deleteApplicant` — useful for toast messaging. */
export type ApplicantListListItem = ApplicantListItem;
