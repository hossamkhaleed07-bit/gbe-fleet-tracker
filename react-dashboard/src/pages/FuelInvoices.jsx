import { Navigate } from "react-router-dom";
import HeroPortal from "../components/HeroPortal";
import { useAuth } from "../contexts/AuthContext";
import FuelInvoiceGrid from "../components/FuelInvoiceGrid";

// The invoices table. Admins edit it; a fleet manager sees it read-only (the grid
// locks itself for anyone who is not an admin); everyone else has no access.
export default function FuelInvoices() {
  const { isAdmin, isFleetManager } = useAuth();
  if (!isAdmin && !isFleetManager) return <Navigate to="/overview" replace />;
  return (
    <>
      <HeroPortal target="fx-hero-actions" className="content-header">
        <div>
          <div className="breadcrumb">Fuel &amp; Invoice Management &gt; <b>Invoices</b></div>
          <h1 className="page-title">Invoices</h1>
        </div>
      </HeroPortal>
      <FuelInvoiceGrid />
    </>
  );
}
