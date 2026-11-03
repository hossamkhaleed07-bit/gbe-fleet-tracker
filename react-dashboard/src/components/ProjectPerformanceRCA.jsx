import { useCallback, useMemo, useState } from "react";
import { useDashboard } from "../contexts/DataContext";
import { useAuth } from "../contexts/AuthContext";
import { useLang } from "../contexts/LanguageContext";
import DataTable from "../components/DataTable";
import { sb } from "../lib/supabase";
import { buildDriverComparison } from "../lib/calc";
import { buildRcaRows } from "../lib/rcaFollowup";
import { useRcaShifts } from "../hooks/useRcaShifts";
import { PROJECT_LIST, PROJECT_MANAGERS, SUBMISSION_REASON_OPTIONS, reasonColorKey } from "../lib/constants";

function rowKey(row) {
  return `${row.identity_number}|${row.day}`;
}

// Editable Notes text cell — local draft state so typing feels instant,
// commits to submission_reasons (and the shared context map) on blur only.
function NotesCell({ row, saved, canEdit, onSave }) {
  const [notes, setNotes] = useState(saved.notes || "");
  const [status, setStatus] = useState("idle"); // idle | saving | saved
  const { t } = useLang();

  if (!canEdit) return saved.notes || "—";

  async function commit() {
    if (notes === (saved.notes || "")) return;
    setStatus("saving");
    const ok = await onSave(row, { notes });
    setStatus(ok ? "saved" : "idle");
    if (ok) setTimeout(() => setStatus(s => (s === "saved" ? "idle" : s)), 1500);
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
      <input
        type="text"
        className="notes-cell-input"
        value={notes}
        placeholder={t("projectPerformanceRCA.notesPlaceholder")}
        onChange={e => setNotes(e.target.value)}
        onBlur={commit}
      />
      {status === "saving" && <span className="ink-muted" style={{ fontSize: "0.7rem" }}>{t("common.saving")}</span>}
      {status === "saved" && <span style={{ fontSize: "0.7rem", color: "var(--complete)" }}>✓</span>}
    </div>
  );
}

function ReasonCell({ row, saved, canEdit, onSave }) {
  const { t } = useLang();
  const colorKey = reasonColorKey(saved.reason);
  const style = colorKey ? { backgroundColor: `var(--${colorKey}-bg)`, color: `var(--${colorKey}-ink)` } : undefined;

  if (!canEdit) {
    return saved.reason ? <span className="badge" style={style}>{saved.reason}</span> : "—";
  }
  return (
    <select className="reason-pill-select" style={style} value={saved.reason || ""} onChange={e => onSave(row, { reason: e.target.value })}>
      <option value="">{t("projectPerformanceRCA.selectReason")}</option>
      {SUBMISSION_REASON_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
    </select>
  );
}

// The "RCA / Driver Follow-up" view inside Project Performance — an
// Excel-style operational table of drivers needing follow-up (Start Only /
// End Only / incomplete end-of-shift form / Non Submitted), with an editable
// standardized Reason dropdown + free-text Notes persisted to
// submission_reasons. Its shift_entries are loaded for its OWN from/to (see
// useRcaShifts) rather than taken from the shared filter's allCompareGroups,
// so the picked dates always match the rows shown; row rules live in
// lib/rcaFollowup.js.
//
// `project`/`status`/`from`/`to` are owned by the parent (ProjectPerformance.jsx)
// so clicking a Statistics badge can both switch tabs AND pre-filter this
// table to the exact bucket that was clicked (carrying over Statistics'
// current date range so the count still matches exactly). Opened generically
// (the tab itself, not a badge), it defaults to checking just YESTERDAY —
// independent of whatever broader range the Statistics tab is browsing —
// matching the daily "did anyone miss yesterday's form" follow-up habit.
//
// `lockedProject` (a project-scoped account's own project) hides the project
// picker entirely — RLS is the actual security boundary (drivers/shift_entries
// /submission_reasons are already scoped server-side), this just avoids
// showing a picker that would only ever show zero rows for every other project.
export default function ProjectPerformanceRCA({ project, onProjectChange, status, onStatusChange, from, onFromChange, to, onToChange, lockedProject }) {
  const { allDrivers, submissionReasonByKey, upsertSubmissionReason } = useDashboard();
  const { rows: shiftRows, loading, error } = useRcaShifts(from, to);
  const { canEditShiftEntries, session } = useAuth();
  const { t } = useLang();

  const [reasonFilter, setReasonFilter] = useState("");
  const [search, setSearch] = useState("");

  const driversByIdentity = useMemo(() => {
    const map = {};
    for (const d of allDrivers) map[d.identity_number] = d;
    return map;
  }, [allDrivers]);

  const groups = useMemo(() => {
    const driverProjects = {};
    for (const d of allDrivers) driverProjects[d.identity_number] = d.project;
    return buildDriverComparison(shiftRows, driverProjects);
  }, [shiftRows, allDrivers]);

  const rows = useMemo(() => {
    const base = buildRcaRows({
      groups, drivers: allDrivers, from, to, status, project,
      hasReason: (g) => Boolean(submissionReasonByKey[rowKey(g)]),
    });
    let r = base.map(g => {
      const drv = driversByIdentity[g.identity_number];
      return { ...g, job_id: drv?.job_id || "—", mobile_number: drv?.mobile_number || "—" };
    });

    if (reasonFilter) r = r.filter(g => (submissionReasonByKey[rowKey(g)]?.reason || "") === reasonFilter);
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      r = r.filter(g =>
        (g.full_name || "").toLowerCase().includes(s) ||
        (g.identity_number || "").toLowerCase().includes(s) ||
        (g.job_id || "").toLowerCase().includes(s) ||
        (g.vehicle_plate || "").toLowerCase().includes(s)
      );
    }
    return [...r].sort((a, b) => b.day.localeCompare(a.day) || (a.full_name || "").localeCompare(b.full_name || ""));
  }, [groups, allDrivers, driversByIdentity, project, status, from, to, reasonFilter, search, submissionReasonByKey]);

  const saveReasonNotes = useCallback(async (row, patch) => {
    const saved = submissionReasonByKey[rowKey(row)] || { reason: "", notes: "" };
    const payload = {
      identity_number: row.identity_number,
      shift_date: row.day,
      project: row.project,
      updated_by: session?.user?.email || null,
      reason: patch.reason ?? saved.reason ?? "",
      notes: patch.notes ?? saved.notes ?? "",
    };
    const { error } = await sb.from("submission_reasons").upsert(payload, { onConflict: "identity_number,shift_date" });
    if (error) { window.alert(t("common.saveFailed") + error.message); return false; }
    upsertSubmissionReason(row.identity_number, row.day, { reason: payload.reason, notes: payload.notes });
    return true;
  }, [submissionReasonByKey, session, upsertSubmissionReason, t]);

  const columns = useMemo(() => [
    { accessorKey: "day", header: t("records.colShiftDate") },
    { accessorKey: "job_id", header: t("projectPerformanceRCA.colJobId") },
    { accessorKey: "full_name", header: t("records.colDriver") },
    { accessorKey: "identity_number", header: t("records.colIdNumber") },
    { accessorKey: "mobile_number", header: t("common.mobileNumber") },
    { id: "vehicle_plate", header: t("common.plate"), accessorFn: g => g.vehicle_plate || "—" },
    {
      id: "project", header: t("common.project"), accessorFn: g => g.project || "",
      cell: ({ row }) => row.original.project ? <span className="badge">{row.original.project}</span> : "—",
    },
    {
      id: "responsibleTeam", header: t("projectPerformanceRCA.colResponsibleTeam"),
      accessorFn: g => PROJECT_MANAGERS[g.project] || "—",
    },
    {
      id: "status", header: t("common.status"), enableSorting: false,
      cell: ({ row }) => {
        const g = row.original;
        if (g.formComplete) {
          return g.reviewedComplete
            ? <span className="badge complete">✓ {t("projectPerformanceRCA.reviewedComplete")}</span>
            : <span className="badge complete">{t("common.complete")}</span>;
        }
        if (g.start && g.end) {
          const issues = g.issues.map(i => t(`projectPerformanceRCA.issue_${i}`));
          return <span className="badge partial" title={issues.join("\n")}>{t("projectPerformanceRCA.formIncomplete")}: {issues.join("، ")}</span>;
        }
        const label = g.synthetic ? t("projectPerformance.colNonSubmitted") : (g.start ? t("detailModal.startOnly") : t("detailModal.endOnly"));
        return <span className={"badge " + (g.synthetic ? "critical" : "partial")}>{label}</span>;
      },
    },
    {
      id: "reason", header: t("projectPerformanceRCA.colReason"), enableSorting: false,
      cell: ({ row }) => (
        <ReasonCell row={row.original} saved={submissionReasonByKey[rowKey(row.original)] || {}} canEdit={canEditShiftEntries} onSave={saveReasonNotes} />
      ),
    },
    {
      id: "notes", header: t("projectPerformanceRCA.colNotes"), enableSorting: false,
      cell: ({ row }) => (
        <NotesCell row={row.original} saved={submissionReasonByKey[rowKey(row.original)] || {}} canEdit={canEditShiftEntries} onSave={saveReasonNotes} />
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, canEditShiftEntries, submissionReasonByKey, saveReasonNotes]);

  return (
    <>
      <HeroLocalFilters
        project={project} onProjectChange={onProjectChange} lockedProject={lockedProject}
        status={status} onStatusChange={onStatusChange}
        from={from} onFromChange={onFromChange} to={to} onToChange={onToChange}
        reasonFilter={reasonFilter} onReasonFilterChange={setReasonFilter}
        search={search} onSearchChange={setSearch}
      />
      {error && !loading && (
        <div role="alert" style={{ margin: "0 0 12px", padding: "10px 14px", borderRadius: 10, background: "#fde8e8", color: "#9b1c1c", fontWeight: 600 }}>
          {t("projectPerformanceRCA.loadFailed")}: {error}
        </div>
      )}
      <DataTable columns={columns} data={loading ? [] : rows} emptyMessage={loading ? t("common.loading") : t("driverPerformance.noMatchingDrivers")} pageSize={25} />
    </>
  );
}

function HeroLocalFilters({
  project, onProjectChange, lockedProject, status, onStatusChange,
  from, onFromChange, to, onToChange, reasonFilter, onReasonFilterChange, search, onSearchChange,
}) {
  const { t } = useLang();
  return (
    <div className="local-filters">
      <div className="field">
        <label>{t("globalFilters.fromDate")}</label>
        <input type="date" value={from} onChange={e => onFromChange(e.target.value)} />
      </div>
      <div className="field">
        <label>{t("globalFilters.toDate")}</label>
        <input type="date" value={to} onChange={e => onToChange(e.target.value)} />
      </div>
      <div className="field">
        <label>{t("records.searchLabel")}</label>
        <input type="text" value={search} onChange={e => onSearchChange(e.target.value)} placeholder={t("common.typeHere")} />
      </div>
      <div className="field">
        <label>{t("common.project")}</label>
        {lockedProject
          ? <div className="val"><span className="badge">{lockedProject}</span></div>
          : (
            <select value={project} onChange={e => onProjectChange(e.target.value)}>
              <option value="">{t("common.allProjects")}</option>
              {PROJECT_LIST.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
      </div>
      <div className="field">
        <label>{t("common.status")}</label>
        <select value={status} onChange={e => onStatusChange(e.target.value)}>
          <option value="followup">{t("projectPerformanceRCA.statusFollowup")}</option>
          <option value="start_only">{t("detailModal.startOnly")}</option>
          <option value="end_only">{t("detailModal.endOnly")}</option>
          <option value="missing">{t("projectPerformance.colNonSubmitted")}</option>
          <option value="incomplete_or_missing">{t("records.statusIncompleteOrMissing")}</option>
          <option value="all">{t("projectPerformanceRCA.allStatuses")}</option>
        </select>
      </div>
      <div className="field">
        <label>{t("projectPerformanceRCA.colReason")}</label>
        <select value={reasonFilter} onChange={e => onReasonFilterChange(e.target.value)}>
          <option value="">{t("common.all")}</option>
          {SUBMISSION_REASON_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      </div>
    </div>
  );
}
