import { Navigate } from "react-router-dom";
import HeroPortal from "../components/HeroPortal";
import { useAuth } from "../contexts/AuthContext";
import FuelInvoiceGrid from "../components/FuelInvoiceGrid";

export default function FuelInvoiceEntries() {
  const { isAdmin, isFleetManager } = useAuth();
  // Entries is admin-only. A fleet manager gets the read-only Data Base instead;
  // anyone else has no access to this module.
  if (!isAdmin) return <Navigate to={isFleetManager ? "/fuel-invoice/database" : "/overview"} replace />;
  return (
    <>
      <HeroPortal target="fx-hero-actions" className="content-header">
        <div>
          <div className="breadcrumb">Fuel &amp; Invoice Management &gt; <b>Entries</b></div>
          <h1 className="page-title">Entries</h1>
        </div>
      </HeroPortal>
      <FuelInvoiceGrid />
    </>
  );
}
