import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import Layout from "./components/Layout";
import DashboardPage from "./pages/DashboardPage";
import LiveMapPage from "./pages/LiveMapPage";
import RoutesPage from "./pages/RoutesPage";
import VehiclesPage from "./pages/VehiclesPage";
import IncidentsPage from "./pages/IncidentsPage";
import AlertsPage from "./pages/AlertsPage";
import AnalyticsPage from "./pages/AnalyticsPage";
import SettingsPage from "./pages/SettingsPage";
import DisruptionPredictorPage from "./pages/DisruptionPredictorPage";
import FieldIntelligencePage from "./pages/FieldIntelligencePage";
import FieldReportsReviewPage from "./pages/FieldReportsReviewPage";
import FeedbackPage from "./pages/FeedbackPage";
import FeedbackReviewPage from "./pages/FeedbackReviewPage";
import EmergencyModePage from "./pages/EmergencyModePage";
import ManageUsersPage from "./pages/ManageUsersPage";
import ForbiddenPage from "./pages/ForbiddenPage";
import LoginPage from "./pages/LoginPage";
import ProfilePage from "./pages/ProfilePage";
import NotFoundPage from "./pages/NotFoundPage";
import { MIN_ROLE, hasRole, type AppPath } from "./lib/access";
import { useAppStore } from "./store/appStore";

/**
 * Sends signed-out visitors to /login and shows an "Access restricted" page to
 * signed-in users whose role is below the page's minimum (see lib/access.ts).
 */
function ProtectedRoute({ path, children }: { path: AppPath; children: ReactNode }) {
  const { isAuthenticated, user } = useAppStore();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const required = MIN_ROLE[path];
  if (!hasRole(user?.role, required)) {
    return <ForbiddenPage required={required} />;
  }

  return <>{children}</>;
}

/**
 * The dashboard is for Field Officers and above. A plain User lands on the
 * live map instead, so signing in never drops them on a restricted page.
 */
function HomeRoute() {
  const { isAuthenticated, user } = useAppStore();

  if (isAuthenticated && !hasRole(user?.role, MIN_ROLE["/"])) {
    return <Navigate to="/live-map" replace />;
  }

  return (
    <ProtectedRoute path="/">
      <DashboardPage />
    </ProtectedRoute>
  );
}

function App() {
  const { isAuthenticated } = useAppStore();

  return (
    <Routes>
      <Route path="/login" element={isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route element={<Layout />}>
        <Route index element={<HomeRoute />} />
        <Route path="live-map" element={<ProtectedRoute path="/live-map"><LiveMapPage /></ProtectedRoute>} />
        <Route path="routes" element={<ProtectedRoute path="/routes"><RoutesPage /></ProtectedRoute>} />
        <Route path="vehicles" element={<ProtectedRoute path="/vehicles"><VehiclesPage /></ProtectedRoute>} />
        <Route path="incidents" element={<ProtectedRoute path="/incidents"><IncidentsPage /></ProtectedRoute>} />
        <Route path="alerts" element={<ProtectedRoute path="/alerts"><AlertsPage /></ProtectedRoute>} />
        <Route path="analytics" element={<ProtectedRoute path="/analytics"><AnalyticsPage /></ProtectedRoute>} />
        <Route path="disruption-predictor" element={<ProtectedRoute path="/disruption-predictor"><DisruptionPredictorPage /></ProtectedRoute>} />
        <Route path="field-intelligence" element={<ProtectedRoute path="/field-intelligence"><FieldIntelligencePage /></ProtectedRoute>} />
        <Route path="field-reports-review" element={<ProtectedRoute path="/field-reports-review"><FieldReportsReviewPage /></ProtectedRoute>} />
        <Route path="feedback" element={<ProtectedRoute path="/feedback"><FeedbackPage /></ProtectedRoute>} />
        <Route path="feedback-review" element={<ProtectedRoute path="/feedback-review"><FeedbackReviewPage /></ProtectedRoute>} />
        <Route path="emergency-mode" element={<ProtectedRoute path="/emergency-mode"><EmergencyModePage /></ProtectedRoute>} />
        <Route path="manage-users" element={<ProtectedRoute path="/manage-users"><ManageUsersPage /></ProtectedRoute>} />
        <Route path="settings" element={<ProtectedRoute path="/settings"><SettingsPage /></ProtectedRoute>} />
        <Route path="profile" element={<ProtectedRoute path="/profile"><ProfilePage /></ProtectedRoute>} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

export default App;
