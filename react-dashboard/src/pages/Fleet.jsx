import { useMemo, useState } from "react";
import { useDashboard } from "../contexts/DataContext";
import { useLang } from "../contexts/LanguageContext";
import DataTable from "../components/DataTable";
import { sb } from "../lib/supabase";
import { downloadCsv } from "../lib/csv";

const emptyForm = { plate: "", vendor: "", fuel: "", model: "", rate: "" };

export default function Fleet() {
  const { scopedVehicles: allVehicles, vehicleDriverMap, upsertVehicle } = useDashboard();
  const { t } = useLang();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [editingPlate, setEditingPlate] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);

  const rows = useMemo(() => {
    let r = allVehicles;
    if (status === "active") r = r.filter(v => v.is_active);
    if (status === "inactive") r = r.filter(v => !v.is_active);
    if (search.trim()) r = r.filter(v => (v.vehicle_plate || "").toLowerCase().includes(search.trim().toLowerCase()));
    return r;
  }, [allVehicles, status, search]);

  function openAdd() {
    setIsNew(true);
    setEditingPlate(null);
    setForm(emptyForm);
    setSaveError("");
    setModalOpen(true);
  }

  function openEdit(v) {
    setIsNew(false);
    setEditingPlate(v.vehicle_plate);
    setForm({ plate: v.vehicle_plate || "", vendor: v.vehicle_vendor || "", fuel: v.fuel_type || "", model: v.model || "", rate: v.avg_per_liter ?? "" });
    setSaveError("");
    setModalOpen(true);
  }

  async function handleSave() {
    if (!form.plate.trim()) { setSaveError(t("fleet.plateRequired")); return; }
    setSaving(true);
    setSaveError("");
    const payload = {
      vehicle_vendor: form.vendor.trim() || null,
      fuel_type: form.fuel.trim() || null,
      model: form.model.trim() || null,
      avg_per_liter: form.rate === "" ? null : Number(form.rate),
    };
    let error;
    if (isNew) {
      payload.vehicle_plate = form.plate.trim();
      payload.is_active = true;
      ({ error } = await sb.from("vehicles").insert(payload));
    } else {
      ({ error } = await sb.from("vehicles").update(payload).eq("vehicle_plate", editingPlate));
    }
    setSaving(false);
    if (error) { setSaveError(t("common.saveFailed") + error.message); return; }
    setModalOpen(false);
    upsertVehicle({ ...payload, vehicle_plate: isNew ? payload.vehicle_plate : editingPlate });
  }

  async function toggleActive(v) {
    const is_active = !v.is_active;
    const { error } = await sb.from("vehicles").update({ is_active }).eq("vehicle_plate", v.vehicle_plate);
    if (error) { window.alert(t("common.saveFailed") + error.message); return; }
    upsertVehicle({ ...v, is_active });
  }

  const columns = useMemo(() => [
    { id: "index", header: t("fleet.colIndex"), cell: ({ row }) => row.index + 1, enableSorting: false },
    { accessorKey: "vehicle_plate", header: t("fleet.colPlate") },
    { id: "driverId", header: t("fleet.colDriverId"), accessorFn: v => vehicleDriverMap[v.vehicle_plate]?.identity_number || "—" },
    { id: "driverName", header: t("fleet.colDriverName"), accessorFn: v => vehicleDriverMap[v.vehicle_plate]?.full_name || "—" },
    { accessorKey: "vehicle_vendor", header: t("fleet.colVendor") },
    { accessorKey: "fuel_type", header: t("fleet.colFuelType") },
    { accessorKey: "model", header: t("fleet.colModel") },
    { accessorKey: "avg_per_liter", header: t("fleet.colRate"), meta: { align: "end" }, cell: ({ getValue }) => getValue() ?? "—" },
    {
      id: "status", header: t("common.status"), enableSorting: false,
      cell: ({ row }) => (
        <button className={"toggle-pill " + (row.original.is_active ? "active" : "inactive")} onClick={() => toggleActive(row.original)}>
          {row.original.is_active ? t("fleet.activeF") : t("fleet.inactiveF")}
        </button>
      ),
    },
    {
      id: "actions", header: "", enableSorting: false,
      cell: ({ row }) => (
        <div className="row-actions"><button className="btn" onClick={() => openEdit(row.original)}>{t("common.edit")}</button></div>
      ),
    },
  ], [t, vehicleDriverMap, toggleActive, openEdit]);

  function handleExport() {
    if (!rows.length) return;
    const keys = ["vehicle_plate", "driver_identity_number", "driver_full_name", "vehicle_vendor", "fuel_type", "model", "avg_per_liter", "is_active"];
    const csvRows = rows.map(v => {
      const drv = vehicleDriverMap[v.vehicle_plate];
      return { ...v, driver_identity_number: drv?.identity_number || "", driver_full_name: drv?.full_name || "" };
    });
    downloadCsv(`fleet_${new Date().toISOString().slice(0, 10)}.csv`, keys, csvRows);
  }

  return (
    <>
      <div className="content-header">
        <div>
          <div className="breadcrumb">{t("common.dashboard")} &gt; <b>{t("fleet.breadcrumb")}</b></div>
          <h1 className="page-title">{t("fleet.breadcrumb")}</h1>
        </div>
        <button className="btn" onClick={handleExport}>{t("common.exportCsv")}</button>
      </div>
      <div style={{ marginBottom: "1rem" }}>
        <button className="btn btn-primary" style={{ width: "auto" }} onClick={openAdd}>{t("fleet.addNew")}</button>
      </div>
      <div className="local-filters">
        <div className="field">
          <label>{t("fleet.plateLabel")}</label>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder={t("common.typeHere")} />
        </div>
        <div className="field">
          <label>{t("common.status")}</label>
          <select value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">{t("common.all")}</option>
            <option value="active">{t("fleet.activeF")}</option>
            <option value="inactive">{t("fleet.inactiveF")}</option>
          </select>
        </div>
      </div>
      <div className="cards-count">{t("fleet.vehiclesCount", { n: rows.length })}</div>
      <DataTable columns={columns} data={rows} emptyMessage={t("fleet.noVehicles")} />

      {modalOpen && (
        <div id="vehicle-backdrop" style={{ display: "flex" }}>
          <div id="vehicle-modal">
            <h2>{isNew ? t("fleet.modalAdd") : t("fleet.modalEdit")}</h2>
            <div className="field"><label>{t("fleet.plateLabel")}</label><input value={form.plate} disabled={!isNew} onChange={e => setForm(f => ({ ...f, plate: e.target.value }))} /></div>
            <div className="field"><label>{t("fleet.fieldVendor")}</label><input value={form.vendor} onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))} /></div>
            <div className="field"><label>{t("fleet.fieldFuelType")}</label><input value={form.fuel} onChange={e => setForm(f => ({ ...f, fuel: e.target.value }))} /></div>
            <div className="field"><label>{t("fleet.fieldModel")}</label><input value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} /></div>
            <div className="field"><label>{t("fleet.fieldRate")}</label><input type="number" value={form.rate} onChange={e => setForm(f => ({ ...f, rate: e.target.value }))} /></div>
            {saveError && <div style={{ color: "var(--critical)", fontSize: "0.8rem" }}>{saveError}</div>}
            <div id="vehicle-actions">
              <button className="btn" onClick={() => setModalOpen(false)} disabled={saving}>{t("common.cancel")}</button>
              <button className={"btn btn-primary" + (saving ? " btn-loading" : "")} onClick={handleSave} disabled={saving}>{t("common.save")}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
