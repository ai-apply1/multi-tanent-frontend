/**
 * The signed-in user's own organization, read from `/admin/organization`.
 * The org is resolved server-side from the JWT — there is deliberately no
 * org id anywhere in the request, and no org selector in this app.
 */

/** Org-wide defaults a job may override per-job (`maxAttempts`). */
export interface OrganizationSettings {
  maxInterviewAttempts: number
  interviewExpiryDays: number
  /** IANA zone (`@IsTimeZone` on the backend), e.g. "Asia/Karachi". */
  timezone: string
}

/**
 * Verification state of the org's own sending domain on Resend. Resend's
 * vocabulary, stored and shown verbatim so this app never disagrees with their
 * console.
 *
 * `verified` is the ONLY state in which candidate emails come from the org's
 * own address; every other one means the platform address is still being used.
 * `not_configured` means no domain was ever registered (or the backend ran
 * without a Resend key).
 */
export type EmailDomainStatus =
  | "not_configured"
  | "not_started"
  | "pending"
  | "verified"
  | "partially_verified"
  | "partially_failed"
  | "failed"
  | "temporary_failure"

/**
 * One DNS record the org admin must publish at their registrar.
 *
 * Render whatever the array holds and never assume a count or a type: the set
 * is Resend's to decide and has already changed once (their docs say three DKIM
 * CNAMEs; the live API returns a single DKIM TXT plus two SPF records).
 */
export interface EmailDomainRecord {
  /** Resend's grouping, e.g. "SPF" | "DKIM". */
  record: string
  /** "MX" | "TXT" | "CNAME". */
  type: string
  /** The host, e.g. `send` or `resend._domainkey`. */
  name: string
  value: string
  /** Resend returns the string "Auto", not a number. */
  ttl: string
  /** Per-record state — this is what tells the admin WHICH record is missing. */
  status: string
  /** MX only; null otherwise. */
  priority: number | null
}

/** The org's sending domain, as `/admin/organization` returns it. */
export interface OrgEmailDomain {
  /** The apex we registered, e.g. `acme.com`. Empty if never registered. */
  name: string
  status: EmailDomainStatus
  /** True only when emails really are coming from the org's own domain. */
  active: boolean
  /**
   * The org's OWN From: identity, e.g. `DevExcel <no-reply@softmind.com>`. When
   * `active` it is the live sender; before verification it is the identity the
   * org is setting up, and delivery falls back to the shared address until then
   * (say so, don't imply it's already live). Never guess this locally.
   */
  fromAddress: string
  /** The org's own sending domain (its verified apex, else its parentDomain). */
  sendingDomain: string
  records: EmailDomainRecord[]
  lastCheckedAt: string | null
  error: string
}

/** Lifecycle of the apply intro video, mirroring the backend `ApplyVideoStatus`. */
export type ApplyVideoStatus =
  | "draft"
  | "uploading"
  | "processing"
  | "ready"
  | "failed"

/**
 * The apply intro video as the OWNER sees it: full pipeline state.
 *
 * An INGESTED ASSET now, not a link the org hosts. HR uploads a file, a worker
 * transcodes it to HLS, and the funnel streams it back. `status` drives the
 * progress/failure UI; `hasVideo` (a live bundle exists) drives Replace-vs-
 * Choose and whether the preview can render. The two differ during a replace:
 * status is `processing`/`failed` while a previously-transcoded bundle stays
 * live.
 */
export interface OrgApplyVideo {
  status: ApplyVideoStatus
  /** Transcode progress 0-100. A number, never a parsed string. */
  progressPct: number
  /** Short current-phase label for display (e.g. "Transcoding"). */
  progressLabel: string
  /** Why the last transcode failed; "" otherwise. */
  error: string
  /** Runtime seconds of the live bundle. 0 = none/unknown. */
  durationSec: number
  originalFilename: string
  sizeBytes: number
  uploadedAt: string | null
  readyAt: string | null
  /** A live, playable bundle exists (may be a prior upload during a replace). */
  hasVideo: boolean
  /**
   * The reviewer's preview manifest (full `/api/v1` path, resolve with
   * `apiUrl`), present whenever `hasVideo`. Same proxy the candidate uses.
   */
  manifestUrl: string
}

/**
 * `slug`, `status`, `seats` and `industry` are super-admin owned: they come
 * back on the profile but the org-settings PATCH ignores them.
 */
export interface OrgProfile {
  _id: string
  /**
   * READ-ONLY, and not what you send back to change the logo — see
   * `UpdateOrganizationPayload.logoKey`.
   *
   * A permanent public URL the backend resolves from the org's stored S3
   * key, safe to drop straight into an `<img src>`. Empty when the org
   * hasn't uploaded one — the shell falls back to `<BrandLogo>`.
   */
  logoUrl: string
  /**
   * READ-ONLY, like `logoUrl`, and written back as `faviconKey` (see
   * `UpdateOrganizationPayload`).
   *
   * A permanent public URL for the icon shown on the org's careers and apply
   * pages. Empty when the org hasn't uploaded one, in which case the portal
   * falls back to the platform favicon. Separate from the logo on purpose: a
   * wide wordmark scaled to 32x32 is an unreadable smudge.
   */
  faviconUrl: string
  name: string
  slug: string
  status: "active" | "inactive"
  industry: string
  seats: number
  settings: OrganizationSettings
  /** The apply funnel's intro video. `url: ""` means the funnel skips it. */
  applyVideo: OrgApplyVideo
  /**
   * The org's own sending domain + the DNS records to publish. Read-only:
   * the domain is registered by the backend at provisioning; the only action
   * here is asking Resend to re-check (see `verifyEmailDomain`).
   */
  emailDomain: OrgEmailDomain
  createdAt: string
  updatedAt: string
}

/**
 * Everything an `org_admin` may change; `hr` gets the same form read-only.
 *
 * Note the asymmetry with `OrgProfile`: you READ `logoUrl` but WRITE
 * `logoKey`. The key is the one handed back by `presignLogo()` after the
 * file is in S3 — the backend re-checks it against this org's own prefix and
 * rejects anything else. `""` removes the logo.
 */
export interface UpdateOrganizationPayload {
  name?: string
  logoKey?: string
  /**
   * The key handed back by `presignFavicon()` after the file is in S3. Same
   * READ-`faviconUrl` / WRITE-`faviconKey` asymmetry as the logo; the backend
   * re-checks it against this org's own favicon prefix and rejects anything
   * else. `""` clears the favicon.
   */
  faviconKey?: string
  settings?: Partial<OrganizationSettings>
  /*
   * No `applyVideo` here: it is an ingested asset with its own upload/transcode
   * routes (`applyVideoApi.ts`), not a profile field. The backend rejects it on
   * this PATCH (`forbidNonWhitelisted`).
   */
}

/** Body of `POST /admin/organization/logo/presign`. */
export interface LogoPresignPayload {
  contentType: string
  sizeBytes: number
  fileName: string
}

/**
 * Its response. `uploadUrl` is a short-lived S3 PUT — send the bytes with
 * the SAME `Content-Type` that was presigned or S3 rejects the request.
 * `key` is what goes back on the profile PATCH as `logoKey`.
 */
export interface LogoPresignResult {
  fileName: string
  uploadUrl: string
  key: string
  contentType: string
  expiresIn: number
}

/**
 * Body of `POST /admin/organization/favicon/presign`. Same shape as the logo's,
 * but the backend accepts a NARROWER set of content types (`.ico`/`.png`/`.svg`,
 * no JPEG or WebP) because a favicon is drawn by a browser and cached hard.
 */
export interface FaviconPresignPayload {
  contentType: string
  sizeBytes: number
  fileName: string
}

/** Its response — identical contract to `LogoPresignResult`. */
export interface FaviconPresignResult {
  fileName: string
  uploadUrl: string
  key: string
  contentType: string
  expiresIn: number
}
