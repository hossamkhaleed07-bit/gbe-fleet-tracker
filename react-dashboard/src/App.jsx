import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { LanguageProvider } from "./contexts/LanguageContext";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { DataProvider } from "./contexts/DataContext";
import { DetailModalProvider } from "./contexts/DetailModalContext";
import { UndoProvider } from "./contexts/UndoContext";
import Layout from "./components/Layout";
import DetailModal from "./components/DetailModal";
import NotificationCenter from "./components/NotificationCenter";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import Records from "./pages/Records";
import FormResponse from "./pages/FormResponse";
import Compare from "./pages/Compare";
import Stations from "./pages/Stations";
import ProjectPerformance from "./pages/ProjectPerformance";
import Fleet from "./pages/Fleet";
import Drivers from "./pages/Drivers";
import FuelApprover from "./pages/FuelApprover";
import FuelApproval from "./pages/FuelApproval";
import FuelMissingForm from "./pages/FuelMissingForm";

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
        <DetailModalProvider>
          <Layout />
          <DetailModal />
          <NotificationCenter />
        </DetailModalProvider>
      </UndoProvider>
    </DataProvider>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <HashRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<RequireAuth><DashboardShell /></RequireAuth>}>
              <Route path="/overview" element={<Overview />} />
              <Route path="/records" element={<Records />} />
              <Route path="/form-response" element={<FormResponse />} />
              <Route path="/compare" element={<Compare />} />
              <Route path="/stations" element={<Stations />} />
              <Route path="/project-performance" element={<ProjectPerformance />} />
              <Route path="/fleet" element={<Fleet />} />
              <Route path="/drivers" element={<Drivers />} />
              <Route path="/fuel-approver" element={<FuelApprover />} />
              <Route path="/fuel-approval" element={<FuelApproval />} />
              <Route path="/fuel-missing-form" element={<FuelMissingForm />} />
            </Route>
            <Route path="*" element={<Navigate to="/overview" replace />} />
          </Routes>
        </HashRouter>
      </AuthProvider>
    </LanguageProvider>
  );
}
