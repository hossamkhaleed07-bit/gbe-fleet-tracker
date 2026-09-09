import { useMemo, useState } from "react";
import { useDashboard } from "../contexts/DataContext";
import { useLang } from "../contexts/LanguageContext";
import { StatusBadge } from "../components/DetailModal";
import ProjectBadge from "../components/ProjectBadge";
import GlobalFilters from "../components/GlobalFilters";
import { sb } from "../lib/supabase";
import { compareStatus } from "../lib/calc";
import { downloadCsv } from "../lib/csv";
import { PROJECT_LIST } from "../lib/constants";

const AVATAR_BG = ["c-blue", "c-green", "c-purple", "c-orange", "c-cyan", "c-pink"];
const emptyForm = {
  identity: "", name: "", nationality: "", mobile: "", project: "",
  assignedVehiclePlate: "", jobId: "", vendorName: "", cityName: "",
  employeeType: "", contractType: "", vehicleType: "", jobTitle: "",
  pnsStatus: "", dateOfHiring: "", petroAppLink: "",
};

export default function Drivers() {
  const { scopedDrivers: allDrivers, scopedCompareGroups: allCompareGroups, upsertDriver, removeDriver } = useDashboard();
  const { t } = useLang();
  const [search, setSearch] = useState("");
  const [project, setProject] = useState("");
  const [status, setStatus] = useState("");
  const [shiftStatusFilter, setShiftStatusFilter] = useState("");
  const [view, setView] = useState("gallery");
  const [modalOpen, setModalOpen] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [editingIdentity, setEditingIdentity] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);

  const shiftStatusMap = useMemo(() => {
    const map = {};
    for (const g of allCompareGroups) {
      if (!map[g.identity_number]) map[g.identity_number] = compareStatus(g);
    }
    return map;
  }, [allCompareGroups]);

  function shiftStatusOf(d) {
    return shiftStatusMap[d.identity_number] || "not_submitted";
  }

  const rows = useMemo(() => {
    let r = allDrivers;
    if (project) r = r.filter(d => d.project === project);
    if (status === "active") r = r.filter(d => d.is_active);
    if (status === "inactive") r = r.filter(d => !d.is_active);
    if (shiftStatusFilter === "incomplete") r = r.filter(d => shiftStatusOf(d) !== "complete");
    else if (shiftStatusFilter) r = r.filter(d => shiftStatusOf(d) === shiftStatusFilter);
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      r = r.filter(d => (d.full_name || "").toLowerCase().includes(s) || (d.identity_number || "").toLowerCase().includes(s));
    }
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDrivers, project, status, shiftStatusFilter, shiftStatusMap, search]);

  function handleReset() {
    setSearch("");
    setProject("");
    setStatus("");
    setShiftStatusFilter("");
  }

  function openAdd() {
    setIsNew(true);
    setEditingIdentity(null);
    setForm(emptyForm);
    setSaveError("");
    setModalOpen(true);
  }

  function openEdit(d) {
    setIsNew(false);
    setEditingIdentity(d.identity_number);
    setForm({
      identity: d.identity_number || "", name: d.full_name || "", nationality: d.nationality || "",
      mobile: d.mobile_number || "", project: d.project || "",
      assignedVehiclePlate: d.assigned_vehicle_plate || "", jobId: d.job_id || "", vendorName: d.vendor_name || "",
      cityName: d.city_name || "", employeeType: d.employee_type || "", contractType: d.contract_type || "",
      vehicleType: d.vehicle_type || "", jobTitle: d.job_title || "", pnsStatus: d.pns_status || "",
      dateOfHiring: d.date_of_hiring || "", petroAppLink: d.petro_app_link || "",
    });
    setSaveError("");
    setModalOpen(true);
  }

  async function handleSave() {
    if (!form.identity.trim()) { setSaveError(t("drivers.idRequired")); return; }
    setSaving(true);
    setSaveError("");
    const payload = {
      full_name: form.name.trim() || null,
      nationality: form.nationality.trim() || null,
      mobile_number: form.mobile.trim() || null,
      project: form.project || null,
      assigned_vehicle_plate: form.assignedVehiclePlate.trim() || null,
      job_id: form.jobId.trim() || null,
      vendor_name: form.vendorName.trim() || null,
      city_name: form.cityName.trim() || null,
      employee_type: form.employeeType.trim() || null,
      contract_type: form.contractType.trim() || null,
      vehicle_type: form.vehicleType.trim() || null,
      job_title: form.jobTitle.trim() || null,
      pns_status: form.pnsStatus.trim() || null,
      date_of_hiring: form.dateOfHiring || null,
      petro_app_link: form.petroAppLink.trim() || null,
    };
    let error;
    if (isNew) {
      payload.identity_number = form.identity.trim();
      payload.is_active = true;
      ({ error } = await sb.from("drivers").insert(payload));
    } else {
      ({ error } = await sb.from("drivers").update(payload).eq("identity_number", editingIdentity));
    }
    setSaving(false);
    if (error) { setSaveError(t("common.saveFailed") + error.message); return; }
    setModalOpen(false);
    upsertDriver({ ...payload, identity_number: isNew ? payload.identity_number : editingIdentity });
  }

  async function toggleActive(d) {
    const is_active = !d.is_active;
    const { error } = await sb.from("drivers").update({ is_active }).eq("identity_number", d.identity_number);
    if (error) { window.alert(t("common.saveFailed") + error.message); return; }
    upsertDriver({ ...d, is_active });
  }

  async function handleDelete(d) {
    if (!window.confirm(t("drivers.confirmDelete"))) return;
    const { error } = await sb.from("drivers").delete().eq("identity_number", d.identity_number);
    if (error) {
      if (error.message.includes("foreign key") || error.message.includes("violates")) {
        window.alert(t("drivers.deleteBlockedFk"));
      } else {
        window.alert(t("common.deleteFailed") + error.message);
      }
      return;
    }
    removeDriver(d.identity_number);
  }

  function handleExport() {
    if (!rows.length) return;
    const keys = [
      "identity_number", "full_name", "nationality", "mobile_number", "project", "is_active",
      "assigned_vehicle_plate", "job_id", "vendor_name", "city_name", "employee_type",
      "contract_type", "vehicle_type", "job_title", "pns_status", "date_of_hiring", "petro_app_link", "shift_status",
    ];
    const csvRows = rows.map(d => ({ ...d, shift_status: shiftStatusOf(d) }));
    downloadCsv(`drivers_${new Date().toISOString().slice(0, 10)}.csv`, keys, csvRows);
  }

  return (
    <>
      <div className="content-header">
        <div>
          <div className="breadcrumb">{t("common.dashboard")} &gt; <b>{t("drivers.breadcrumb")}</b></div>
          <h1 className="page-title">{t("drivers.breadcrumb")}</h1>
        </div>
        <button className="btn" onClick={handleExport}>{t("common.exportCsv")}</button>
      </div>
      <GlobalFilters />
      <div className="pill-bar">
        <div className="pill-search">
          <span className="pill-search-ic">🔍</span>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder={t("common.searchByNameOrId")} />
        </div>
        <div className="pill-select-wrap">
          <select value={project} onChange={e => setProject(e.target.value)}>
            <option value="">{t("common.allProjects")}</option>
            {PROJECT_LIST.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="pill-select-wrap">
          <select value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">{t("drivers.allStatuses")}</option>
            <option value="active">{t("common.active")}</option>
            <option value="inactive">{t("common.inactive")}</option>
          </select>
        </div>
        <div className="pill-select-wrap">
          <select value={shiftStatusFilter} onChange={e => setShiftStatusFilter(e.target.value)}>
            <option value="">{t("drivers.allShiftStatuses")}</option>
            <option value="incomplete">{t("drivers.shiftIncomplete")}</option>
            <option value="not_submitted">{t("drivers.shiftNotSubmitted")}</option>
            <option value="start_only">{t("detailModal.startOnly")}</option>
            <option value="end_only">{t("detailModal.endOnly")}</option>
            <option value="complete">{t("common.complete")}</option>
          </select>
        </div>
        <button className="btn" onClick={handleReset}>{t("common.clearFilters")}</button>
        <div className="view-toggle">
          <button className={"view-btn" + (view === "gallery" ? " active" : "")} title={t("common.galleryView")} onClick={() => setView("gallery")}>🖼️</button>
          <button className={"view-btn" + (view === "table" ? " active" : "")} title={t("common.gridView")} onClick={() => setView("table")}>📋</button>
        </div>
        <button className="btn btn-primary pill-add-btn" onClick={openAdd}>{t("drivers.addNew")}</button>
      </div>
      <div className="cards-count">{t("drivers.driversCount", { n: rows.length })}</div>
      {view === "gallery" ? (
      <div className="cards-grid">
        {!rows.length ? <div className="empty-cards">{t("drivers.noMatchingDrivers")}</div> : rows.map((d, i) => {
          const c = AVATAR_BG[i % AVATAR_BG.length];
          return (
            <div key={d.identity_number} className="driver-card">
              <div className="driver-card-avatar" style={{ background: `var(--${c}-bg)`, color: `var(--${c}-ink)` }}>🧑</div>
              <div className="driver-card-body">
                <div className="driver-card-id">{d.identity_number}</div>
                <div className="driver-card-field"><label>{t("common.name")}</label><div className="val">{d.full_name || "—"}</div></div>
                <div className="driver-card-field"><label>{t("common.nationality")}</label><div className="val">{d.nationality || "—"}</div></div>
                <div className="driver-card-field"><label>{t("common.mobileNumber")}</label><div className="val">{d.mobile_number || "—"}</div></div>
                <div className="driver-card-field"><label>{t("common.project")}</label><div className="val">{d.project ? <ProjectBadge project={d.project} /> : "—"}</div></div>
                <div className="driver-card-field"><label>{t("common.assignedVehicle")}</label><div className="val">{d.assigned_vehicle_plate || "—"}</div></div>
                <div className="driver-card-field"><label>{t("common.vehicleType")}</label><div className="val">{d.vehicle_type || "—"}</div></div>
                <div className="driver-card-field"><label>{t("common.city")}</label><div className="val">{d.city_name || "—"}</div></div>
                <div className="driver-card-field"><label>{t("common.jobTitle")}</label><div className="val">{d.job_title || "—"}</div></div>
                <div className="driver-card-field"><label>{t("common.employeeType")}</label><div className="val">{d.employee_type || "—"}</div></div>
                <div className="driver-card-field"><label>{t("common.contractType")}</label><div className="val">{d.contract_type || "—"}</div></div>
                <div className="driver-card-field"><label>{t("common.vendor")}</label><div className="val">{d.vendor_name || "—"}</div></div>
                <div className="driver-card-field"><label>{t("common.jobId")}</label><div className="val">{d.job_id || "—"}</div></div>
                <div className="driver-card-field"><label>{t("common.hiringDate")}</label><div className="val">{d.date_of_hiring || "—"}</div></div>
                <div className="driver-card-field"><label>{t("common.pnsStatus")}</label><div className="val">{d.pns_status || "—"}</div></div>
                <div className="driver-card-field"><label>{t("common.petroAppLink")}</label><div className="val">{d.petro_app_link ? <a className="media-link" href={d.petro_app_link} target="_blank" rel="noreferrer">{t("common.petroAppLink")}</a> : "—"}</div></div>
                <div className="driver-card-field"><label>{t("drivers.shiftStatus")}</label><div className="val"><StatusBadge status={shiftStatusOf(d)} /></div></div>
                <div className="driver-card-field"><label>{t("common.status")}</label><div className="val"><span className={`badge ${d.is_active ? "complete" : "partial"}`}>{d.is_active ? t("common.active") : t("common.inactive")}</span></div></div>
              </div>
              <div className="driver-card-actions">
                <button onClick={() => toggleActive(d)}>{d.is_active ? t("drivers.deactivate") : t("drivers.activate")}</button>
                <button onClick={() => openEdit(d)}>{t("common.edit")}</button>
                <button className="danger" onClick={() => handleDelete(d)}>{t("common.delete")}</button>
              </div>
            </div>
          );
        })}
      </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("drivers.colIdNumber")}</th><th>{t("common.name")}</th><th>{t("common.nationality")}</th><th>{t("drivers.colMobile")}</th><th>{t("common.project")}</th>
                <th>{t("common.assignedVehicle")}</th><th>{t("common.vehicleType")}</th><th>{t("common.city")}</th><th>{t("common.jobTitle")}</th>
                <th>{t("common.employeeType")}</th><th>{t("common.contractType")}</th><th>{t("common.vendor")}</th><th>{t("common.jobId")}</th>
                <th>{t("common.hiringDate")}</th><th>{t("common.pnsStatus")}</th><th>{t("common.petroAppLink")}</th><th>{t("drivers.shiftStatus")}</th><th>{t("common.status")}</th><th>{t("drivers.colActions")}</th>
              </tr>
            </thead>
            <tbody>
              {!rows.length ? (
                <tr className="empty-row"><td colSpan={19}>{t("drivers.noMatchingDrivers")}</td></tr>
              ) : rows.map(d => (
                <tr key={d.identity_number}>
                  <td>{d.identity_number}</td>
                  <td>{d.full_name || "—"}</td>
                  <td>{d.nationality || "—"}</td>
                  <td>{d.mobile_number || "—"}</td>
                  <td>{d.project ? <ProjectBadge project={d.project} /> : "—"}</td>
                  <td>{d.assigned_vehicle_plate || "—"}</td>
                  <td>{d.vehicle_type || "—"}</td>
                  <td>{d.city_name || "—"}</td>
                  <td>{d.job_title || "—"}</td>
                  <td>{d.employee_type || "—"}</td>
                  <td>{d.contract_type || "—"}</td>
                  <td>{d.vendor_name || "—"}</td>
                  <td>{d.job_id || "—"}</td>
                  <td>{d.date_of_hiring || "—"}</td>
                  <td>{d.pns_status || "—"}</td>
                  <td>{d.petro_app_link ? <a className="media-link" href={d.petro_app_link} target="_blank" rel="noreferrer">{t("common.petroAppLink")}</a> : "—"}</td>
                  <td><StatusBadge status={shiftStatusOf(d)} /></td>
                  <td><span className={`badge ${d.is_active ? "complete" : "partial"}`}>{d.is_active ? t("common.active") : t("common.inactive")}</span></td>
                  <td className="row-actions">
                    <button className="btn" onClick={() => toggleActive(d)}>{d.is_active ? t("drivers.deactivate") : t("drivers.activate")}</button>
                    <button className="btn" onClick={() => openEdit(d)}>{t("common.edit")}</button>
                    <button className="btn btn-danger" onClick={() => handleDelete(d)}>{t("common.delete")}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <div id="driver-backdrop" style={{ display: "flex" }}>
          <div id="driver-modal">
            <h2>{isNew ? t("drivers.modalAdd") : t("drivers.modalEdit")}</h2>
            <div className="field"><label>{t("drivers.idOrIqama")}</label><input value={form.identity} disabled={!isNew} onChange={e => setForm(f => ({ ...f, identity: e.target.value }))} /></div>
            <div className="field"><label>{t("common.name")}</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div className="field"><label>{t("common.nationality")}</label><input value={form.nationality} onChange={e => setForm(f => ({ ...f, nationality: e.target.value }))} /></div>
            <div className="field"><label>{t("common.mobileNumber")}</label><input value={form.mobile} onChange={e => setForm(f => ({ ...f, mobile: e.target.value }))} /></div>
            <div className="field">
              <label>{t("common.project")}</label>
              <select value={form.project} onChange={e => setForm(f => ({ ...f, project: e.target.value }))}>
                <option value="">{t("common.none")}</option>
                {PROJECT_LIST.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="field"><label>{t("common.assignedVehicle")}</label><input value={form.assignedVehiclePlate} onChange={e => setForm(f => ({ ...f, assignedVehiclePlate: e.target.value }))} /></div>
            <div className="field"><label>{t("common.vehicleType")}</label><input value={form.vehicleType} onChange={e => setForm(f => ({ ...f, vehicleType: e.target.value }))} /></div>
            <div className="field"><label>{t("common.city")}</label><input value={form.cityName} onChange={e => setForm(f => ({ ...f, cityName: e.target.value }))} /></div>
            <div className="field"><label>{t("common.jobTitle")}</label><input value={form.jobTitle} onChange={e => setForm(f => ({ ...f, jobTitle: e.target.value }))} /></div>
            <div className="field"><label>{t("common.employeeType")}</label><input value={form.employeeType} onChange={e => setForm(f => ({ ...f, employeeType: e.target.value }))} /></div>
            <div className="field"><label>{t("common.contractType")}</label><input value={form.contractType} onChange={e => setForm(f => ({ ...f, contractType: e.target.value }))} /></div>
            <div className="field"><label>{t("common.vendor")}</label><input value={form.vendorName} onChange={e => setForm(f => ({ ...f, vendorName: e.target.value }))} /></div>
            <div className="field"><label>{t("common.jobId")}</label><input value={form.jobId} onChange={e => setForm(f => ({ ...f, jobId: e.target.value }))} /></div>
            <div className="field"><label>{t("common.hiringDate")}</label><input type="date" value={form.dateOfHiring} onChange={e => setForm(f => ({ ...f, dateOfHiring: e.target.value }))} /></div>
            <div className="field"><label>{t("common.pnsStatus")}</label><input value={form.pnsStatus} onChange={e => setForm(f => ({ ...f, pnsStatus: e.target.value }))} /></div>
            <div className="field"><label>{t("common.petroAppLink")}</label><input type="url" value={form.petroAppLink} onChange={e => setForm(f => ({ ...f, petroAppLink: e.target.value }))} /></div>
            {saveError && <div style={{ color: "var(--critical)", fontSize: "0.8rem" }}>{saveError}</div>}
            <div id="driver-actions">
              <button className="btn" onClick={() => setModalOpen(false)} disabled={saving}>{t("common.cancel")}</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? t("common.saving") : t("common.save")}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
