export const ROUTES = {
  LOGIN: "/login",
  /** Email → emailed 6-char code + new password. Public, like LOGIN. */
  FORGOT_PASSWORD: "/forgot-password",
  OVERVIEW: "/dashboard/overview",
  JOBS: "/dashboard/jobs",
  JOB_NEW: "/dashboard/jobs/new",
  JOB_DETAIL: "/dashboard/jobs/:jobId",
  JOB_EDIT: "/dashboard/jobs/:jobId/edit",
  /** The kanban board for a single job — the board endpoint is per-job. */
  JOB_CANDIDATES: "/dashboard/jobs/:jobId/candidates",
  CANDIDATES: "/dashboard/candidates",
  QUESTIONS: "/dashboard/questions",
  PIPELINE: "/dashboard/pipeline",
  /** The editable candidate-email templates editor + live preview. Its own
   *  top-level destination (reached from the Settings dropdown), not a Settings
   *  tab: the editor + preview want the full page width, like the Pipeline. */
  EMAIL_TEMPLATES: "/dashboard/email-templates",
  /**
   * The dedicated settings destination (identity, branding, domains, apply
   * video, email, defaults, notifications). Named `SETTINGS`, not
   * `ORG_SETTINGS`: it is its own top-level nav group, no longer a tab inside
   * an "Organization" page.
   */
  SETTINGS: "/dashboard/settings",
  TEAM: "/dashboard/team",
} as const;

/**
 * The Settings page's sub-sections. The page renders these as in-card tabs
 * driven by a `?tab=` query param, and the sidebar's Settings dropdown links
 * straight to each one. Defined here so the page and the sidebar share ONE
 * list of ids + labels rather than drifting apart.
 */
export type SettingsTabId =
  | "general"
  | "branding"
  | "domains"
  | "video"
  | "defaults"
  | "platform"
  | "notifications";

export const SETTINGS_TABS: ReadonlyArray<{ id: SettingsTabId; label: string }> =
  [
    { id: "general", label: "General" },
    { id: "branding", label: "Branding" },
    { id: "domains", label: "Domains" },
    { id: "video", label: "Apply video" },
    { id: "defaults", label: "Interview defaults" },
    { id: "platform", label: "Platform" },
    { id: "notifications", label: "My notifications" },
  ];

export const DEFAULT_SETTINGS_TAB: SettingsTabId = "general";

const SETTINGS_TAB_IDS = new Set<string>(SETTINGS_TABS.map((t) => t.id));

/** Narrow an untrusted `?tab=` value to a real tab id (falls back to default). */
export const asSettingsTab = (value: string | null | undefined): SettingsTabId =>
  value && SETTINGS_TAB_IDS.has(value)
    ? (value as SettingsTabId)
    : DEFAULT_SETTINGS_TAB;

/** Deep link into a specific Settings tab, e.g. the sidebar dropdown. */
export const settingsTab = (id: SettingsTabId): string =>
  `${ROUTES.SETTINGS}?tab=${id}`;

// Builders for the `:jobId` routes above. The pattern constants are what
// `<Route path>` wants; these are what every `navigate()` / `<Link to>`
// wants — so the param is interpolated in exactly one place per route.
export const jobDetail = (jobId: string): string => `/dashboard/jobs/${jobId}`;

export const jobEdit = (jobId: string): string =>
  `/dashboard/jobs/${jobId}/edit`;

export const jobCandidates = (jobId: string): string =>
  `/dashboard/jobs/${jobId}/candidates`;
