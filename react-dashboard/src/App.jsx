import { lazy, Suspense } from "react";
import { HashRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { isViewerPath } from "./lib/viewerAccess";
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
const DriverPerformance = lazy(() => import("./pages/DriverPerformance"));
const DriverPerformanceProject = lazy(() => import("./pages/DriverPerformanceProject"));
const DriverPerformanceDriver = lazy(() => import("./pages/DriverPerformanceDriver"));
const Stations = lazy(() => import("./pages/Stations"));
const ProjectPerformance = lazy(() => import("./pages/ProjectPerformance"));
const ProjectPerformanceRCAPage = lazy(() => import("./pages/ProjectPerformanceRCAPage"));
const Fleet = lazy(() => import("./pages/Fleet"));
const Drivers = lazy(() => import("./pages/Drivers"));
const FuelApprover = lazy(() => import("./pages/FuelApprover"));
const FuelApproval = lazy(() => import("./pages/FuelApproval"));
const FuelMissingForm = lazy(() => import("./pages/FuelMissingForm"));
const AutomaticFuel = lazy(() => import("./pages/AutomaticFuel"));
const FuelInvoices = lazy(() => import("./pages/FuelInvoices"));
const FuelUsageReport = lazy(() => import("./pages/FuelUsageReport"));
// Visual prototype — standalone full-screen page (no sidebar), mock data only.
const FormResponseDemo = lazy(() => import("./pages/FormResponseDemo"));

function RequireAuth({ children, blockViewer = false }) {
  const { session, loading, isViewer } = useAuth();
  if (loading) return null;
  if (!session) return <Navigate to="/login" replace />;
  if (blockViewer && isViewer) return <Navigate to="/overview" replace />;
  return children;
}

function DashboardShell() {
  const { isViewer } = useAuth();
  const { pathname } = useLocation();
  // A viewer only has a few pages: any other address goes to Overview.
  if (isViewer && !isViewerPath(pathname)) return <Navigate to="/overview" replace />;
  return (
    <DataProvider>
      <UndoProvider>
        <ToastProvider>
          <DetailModalProvider>
            <Layout />
            <DetailModal />
            {/* the bell shows fuel requests and admin notices: not for a read-only viewer */}
            {!isViewer && <NotificationCenter />}
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
              <Route path="/form-response-demo" element={<RequireAuth blockViewer><FormResponseDemo /></RequireAuth>} />
              <Route element={<RequireAuth><DashboardShell /></RequireAuth>}>
                <Route path="/overview" element={<Overview />} />
                <Route path="/records" element={<Records />} />
                <Route path="/attendance" element={<Attendance />} />
                <Route path="/form-response" element={<FormResponse />} />
                <Route path="/compare" element={<Compare />} />
                <Route path="/driver-performance" element={<DriverPerformance />} />
                <Route path="/driver-performance/:project" element={<DriverPerformanceProject />} />
                <Route path="/driver-performance/:project/:identityNumber" element={<DriverPerformanceDriver />} />
                <Route path="/stations" element={<Stations />} />
                <Route path="/project-performance" element={<ProjectPerformance />} />
                <Route path="/project-performance/rca" element={<ProjectPerformanceRCAPage />} />
                <Route path="/fleet" element={<Fleet />} />
                <Route path="/drivers" element={<Drivers />} />
                <Route path="/fuel-approver" element={<FuelApprover />} />
                <Route path="/fuel-approval" element={<FuelApproval />} />
                <Route path="/fuel-missing-form" element={<FuelMissingForm />} />
                <Route path="/automatic-fuel" element={<AutomaticFuel />} />
                <Route path="/fuel-invoice/invoices" element={<FuelInvoices />} />
                <Route path="/fuel-invoice/usage-report" element={<FuelUsageReport />} />
                {/* old addresses keep working */}
                <Route path="/fuel-invoice/entries" element={<Navigate to="/fuel-invoice/invoices" replace />} />
                <Route path="/fuel-invoice/database" element={<Navigate to="/fuel-invoice/invoices" replace />} />
              </Route>
              <Route path="*" element={<Navigate to="/overview" replace />} />
            </Routes>
          </Suspense>
        </HashRouter>
      </AuthProvider>
    </LanguageProvider>
  );
}
