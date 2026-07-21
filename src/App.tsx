import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { GuestRoute, ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { LoginPage } from "@/pages/LoginPage";
import { ForgotPasswordPage } from "@/pages/ForgotPasswordPage";
import { OverviewPage } from "@/pages/OverviewPage";
import { JobsPage } from "@/pages/JobsPage";
import { JobFormPage } from "@/pages/JobFormPage";
import { JobDetailPage } from "@/pages/JobDetailPage";
import { CandidatesPage } from "@/pages/CandidatesPage";
import { QuestionBankPage } from "@/pages/QuestionBankPage";
import { OrgSettingsPage } from "@/pages/OrgSettingsPage";
import { PipelinePage } from "@/pages/PipelinePage";
import { TeamPage } from "@/pages/TeamPage";
import { CvViewerPage } from "@/pages/CvViewerPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { ROUTES } from "@/routes";

/**
 * The standalone per-job candidates board was retired. A job's candidates now
 * live on the org-wide list filtered by `?job=`. This redirect keeps the old
 * `JOB_CANDIDATES` route registered so stale links and notifications land on
 * the filtered list instead of the 404 page.
 */
function JobCandidatesRedirect() {
  const { jobId } = useParams<{ jobId: string }>();
  return (
    <Navigate
      to={jobId ? `${ROUTES.CANDIDATES}?job=${jobId}` : ROUTES.CANDIDATES}
      replace
    />
  );
}

export default function App() {
  return (
    <Routes>
      <Route
        path={ROUTES.LOGIN}
        element={
          <GuestRoute>
            <LoginPage />
          </GuestRoute>
        }
      />

      {/* GuestRoute like /login: someone with a live session has no business
          here, and the reset itself revokes every session anyway. */}
      <Route
        path={ROUTES.FORGOT_PASSWORD}
        element={
          <GuestRoute>
            <ForgotPasswordPage />
          </GuestRoute>
        }
      />

      {/*
       * Child paths are the absolute `ROUTES` constants rather than relative
       * segments, so `routes.ts` stays the single source of truth for every
       * URL in the app. React Router permits this as long as each child path
       * starts with the parent's — which is why the parent is the literal
       * "/dashboard" prefix those constants are built on.
       */}
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to={ROUTES.OVERVIEW} replace />} />
        <Route path={ROUTES.OVERVIEW} element={<OverviewPage />} />

        {/*
         * JOB_NEW and JOB_DETAIL both match "/dashboard/jobs/new". Router v7
         * ranks by specificity rather than declaration order, so the static
         * "new" segment wins over ":jobId" wherever it sits — the ordering
         * below is for readability, not correctness. Keep them adjacent so the
         * overlap stays obvious to the next reader.
         */}
        <Route path={ROUTES.JOBS} element={<JobsPage />} />
        <Route path={ROUTES.JOB_NEW} element={<JobFormPage />} />
        <Route path={ROUTES.JOB_DETAIL} element={<JobDetailPage />} />
        <Route path={ROUTES.JOB_EDIT} element={<JobFormPage />} />
        {/* Retired standalone per-job board — redirect to the org-wide list
            filtered by `?job=`. The route stays registered so stale links and
            notifications redirect here instead of 404ing. */}
        <Route path={ROUTES.JOB_CANDIDATES} element={<JobCandidatesRedirect />} />

        <Route path={ROUTES.CANDIDATES} element={<CandidatesPage />} />
        <Route path={ROUTES.QUESTIONS} element={<QuestionBankPage />} />
        <Route path={ROUTES.PIPELINE} element={<PipelinePage />} />
        <Route path={ROUTES.SETTINGS} element={<OrgSettingsPage />} />
        <Route path={ROUTES.TEAM} element={<TeamPage />} />
      </Route>

      {/* Standalone full-screen CV viewer, opened in a new tab from "Open CV".
          Protected (it mints an org-scoped token) but deliberately OUTSIDE the
          dashboard shell — it's just the PDF. Path is `/cv-view/*`, not
          `/cv/*`, because `/cv/*` is reverse-proxied to the backend. */}
      <Route
        path="/cv-view/:candidateId"
        element={
          <ProtectedRoute>
            <CvViewerPage />
          </ProtectedRoute>
        }
      />

      <Route path="/" element={<Navigate to={ROUTES.OVERVIEW} replace />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
