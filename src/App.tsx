import { Navigate, Route, Routes } from "react-router-dom";
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
        {/* Both routes render CandidatesPage, so React would reconcile them in
            place and carry the per-job board's filter/view onto the org-wide
            URL. Distinct keys force a remount when crossing between them; job
            A → job B keeps one key, so the page's own re-seed effect still
            handles that case without a needless remount. */}
        <Route path={ROUTES.JOB_CANDIDATES} element={<CandidatesPage key="job-scoped" />} />

        <Route path={ROUTES.CANDIDATES} element={<CandidatesPage key="org-wide" />} />
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
