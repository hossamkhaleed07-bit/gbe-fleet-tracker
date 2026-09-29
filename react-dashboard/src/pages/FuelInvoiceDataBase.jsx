import HeroPortal from "../components/HeroPortal";
import FuelInvoiceGrid from "../components/FuelInvoiceGrid";

// Same underlying table/hook/component as Entries — this page IS the
// module's central data table, not a separate disconnected spreadsheet
// (per the module spec: both pages must read/write the same records).
export default function FuelInvoiceDataBase() {
  return (
    <>
      <HeroPortal target="fx-hero-actions" className="content-header">
        <div>
          <div className="breadcrumb">Fuel &amp; Invoice Management &gt; <b>Data Base</b></div>
          <h1 className="page-title">Data Base</h1>
        </div>
      </HeroPortal>
      <FuelInvoiceGrid />
    </>
  );
}
