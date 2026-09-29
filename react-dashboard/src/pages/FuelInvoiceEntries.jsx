import HeroPortal from "../components/HeroPortal";
import FuelInvoiceGrid from "../components/FuelInvoiceGrid";

export default function FuelInvoiceEntries() {
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
