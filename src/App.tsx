import { Navigate, Route, Routes } from "react-router-dom";
import { GuestRoute, ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { LoginPage } from "@/pages/LoginPage";
import { OverviewPage } from "@/pages/OverviewPage";
import { ApplicantsPage } from "@/pages/ApplicantsPage";
import { InterviewQuestionsPage } from "@/pages/InterviewQuestionsPage";
import { DemoVideoPage } from "@/pages/DemoVideoPage";
import { ApplyVideoPage } from "@/pages/ApplyVideoPage";
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

      <Route
        path={ROUTES.DASHBOARD}
        element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to={ROUTES.OVERVIEW} replace />} />
        <Route path="overview" element={<OverviewPage />} />
        <Route path="applicants" element={<ApplicantsPage />} />
        <Route path="interview/questions" element={<InterviewQuestionsPage />} />
        <Route path="interview/demo-video" element={<DemoVideoPage />} />
        <Route path="landing/apply-video" element={<ApplyVideoPage />} />
      </Route>

      <Route path="/" element={<Navigate to={ROUTES.OVERVIEW} replace />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
