import { lazy, Suspense } from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { LanguageProvider } from "./contexts/LanguageContext";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { DataProvider } from "./contexts/DataContext";
import { DetailModalProvider } from "./contexts/DetailModalContext";
import { UndoProvider } from "./contexts/UndoContext";
import { ToastProvider } from "./contexts/ToastContext";
import Layout from "./components/Layout";
import DetailModal from "./components/DetailModal";
import NotificationCenter from "./components/NotificationCenter";
import Login from "./pages/Login";

// Lazy-loaded so each page ships as its own small chunk instead of one huge
// bundle — keeps individual deployed files well under GitHub's per-request
// upload limits and speeds up first load (only the visited page downloads).
const Overview = lazy(() => import("./pages/Overview"));
const Records = lazy(() => import("./pages/Records"));
const Attendance = lazy(() => import("./pages/Attendance"));
const FormResponse = lazy(() => import("./pages/FormResponse"));
const Compare = lazy(() => import("./pages/Compare"));
const Stations = lazy(() => import("./pages/Stations"));
const ProjectPerformance = lazy(() => import("./pages/ProjectPerformance"));
const Fleet = lazy(() => import("./pages/Fleet"));
const Drivers = lazy(() => import("./pages/Drivers"));
const FuelApprover = lazy(() => import("./pages/FuelApprover"));
const FuelApproval = lazy(() => import("./pages/FuelApproval"));
const FuelMissingForm = lazy(() => import("./pages/FuelMissingForm"));
const AutomaticFuel = lazy(() => import("./pages/AutomaticFuel"));

function RequireAuth({ children }) {
  const { session, loading } = useAuth();
  if (loading) return null;
  if (!session) return <Navigate to="/login" replace />;
  return children;
}

function DashboardShell() {
  return (
    <DataProvider>
      <UndoProvider>
        <ToastProvider>
          <DetailModalProvider>
            <Layout />
            <DetailModal />
            <NotificationCenter />
          </DetailModalProvider>
        </ToastProvider>
      </UndoProvider>
    </DataProvider>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <HashRouter>
          <Suspense fallback={null}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route element={<RequireAuth><DashboardShell /></RequireAuth>}>
                <Route path="/overview" element={<Overview />} />
                <Route path="/records" element={<Records />} />
                <Route path="/attendance" element={<Attendance />} />
                <Route path="/form-response" element={<FormResponse />} />
                <Route path="/compare" element={<Compare />} />
                <Route path="/stations" element={<Stations />} />
                <Route path="/project-performance" element={<ProjectPerformance />} />
                <Route path="/fleet" element={<Fleet />} />
                <Route path="/drivers" element={<Drivers />} />
                <Route path="/fuel-approver" element={<FuelApprover />} />
                <Route path="/fuel-approval" element={<FuelApproval />} />
                <Route path="/fuel-missing-form" element={<FuelMissingForm />} />
                <Route path="/automatic-fuel" element={<AutomaticFuel />} />
              </Route>
              <Route path="*" element={<Navigate to="/overview" replace />} />
            </Routes>
          </Suspense>
        </HashRouter>
      </AuthProvider>
    </LanguageProvider>
  );
}
