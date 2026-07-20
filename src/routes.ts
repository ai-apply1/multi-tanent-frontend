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
  SETTINGS: "/dashboard/settings",
  TEAM: "/dashboard/team",
} as const;

// Builders for the `:jobId` routes above. The pattern constants are what
// `<Route path>` wants; these are what every `navigate()` / `<Link to>`
// wants — so the param is interpolated in exactly one place per route.
export const jobDetail = (jobId: string): string => `/dashboard/jobs/${jobId}`;

export const jobEdit = (jobId: string): string =>
  `/dashboard/jobs/${jobId}/edit`;

export const jobCandidates = (jobId: string): string =>
  `/dashboard/jobs/${jobId}/candidates`;
