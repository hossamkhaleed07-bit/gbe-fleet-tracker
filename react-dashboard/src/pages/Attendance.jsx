import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useDashboard } from "../contexts/DataContext";
import { useAuth } from "../contexts/AuthContext";
import { useLang } from "../contexts/LanguageContext";
import { sb } from "../lib/supabase";
import { PROJECT_LIST } from "../lib/constants";
import { localToday } from "../lib/calc";
import DataTable from "../components/DataTable";
import { ATTENDANCE_CODES, ATTENDANCE_CODE_MAP, LEAVE_CODES, ABSENT_CODES, DEFAULT_ATTENDANCE_CODE, deriveAttendanceStatus } from "../lib/attendanceCodes";

const WEEKDAY = {
  ar: ["أحد", "اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
};

function monthDays(monthStr) {
  const [y, m] = monthStr.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  return Array.from({ length: daysInMonth }, (_, i) => `${monthStr}-${String(i + 1).padStart(2, "0")}`);
}

function addMonths(monthStr, delta) {
  const [y, m] = monthStr.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function Attendance() {
  const { scopedDrivers: allDrivers } = useDashboard();
  const { session } = useAuth();
  const { t, lang } = useLang();
  const [searchParams] = useSearchParams();
  const linkedDate = searchParams.get("date") === "today" || !searchParams.get("date") ? localToday() : searchParams.get("date");
  const [month, setMonth] = useState(() => linkedDate.slice(0, 7));
  const [project, setProject] = useState(() => searchParams.get("project") || "");
  const [bucketFilter, setBucketFilter] = useState(() => searchParams.get("status") || "");
  const [search, setSearch] = useState("");
  const [attendanceMap, setAttendanceMap] = useState({});
  const [shiftDaySet, setShiftDaySet] = useState(() => new Set());
  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState(null);
  const [error, setError] = useState("");

  const days = useMemo(() => monthDays(month), [month]);

  useEffect(() => {
    load(month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  async function load(forMonth) {
    setLoading(true);
    setError("");
    const dayList = monthDays(forMonth);
    const [attRes, shiftRes] = await Promise.all([
      sb.from("driver_attendance").select("identity_number,status,attendance_date")
        .gte("attendance_date", dayList[0]).lte("attendance_date", dayList[dayList.length - 1]),
      sb.from("shift_entries").select("identity_number,shift_date")
        .gte("shift_date", dayList[0]).lte("shift_date", dayList[dayList.length - 1]),
    ]);
    setLoading(false);
    if (attRes.error) { setError(t("attendance.loadFailed") + attRes.error.message); return; }
    const map = {};
    for (const row of attRes.data || []) map[`${row.identity_number}|${row.attendance_date}`] = row.status;
    setAttendanceMap(map);
    setShiftDaySet(new Set((shiftRes.data || []).map(r => `${r.identity_number}|${r.shift_date}`)));
  }

  // A manager only marks exceptions — everything else is derived from
  // whether the driver actually submitted a shift form that day (see
  // deriveAttendanceStatus in lib/attendanceCodes.js).
  function statusOf(identityNumber, day) {
    return deriveAttendanceStatus({
      explicitStatus: attendanceMap[`${identityNumber}|${day}`],
      hasShiftEntry: shiftDaySet.has(`${identityNumber}|${day}`),
      day,
      today: localToday(),
    });
  }

  const rows = useMemo(() => {
    let r = allDrivers.filter(d => d.is_active);
    if (project) r = r.filter(d => d.project === project);
    if (bucketFilter) {
      r = r.filter(d => {
        const st = statusOf(d.identity_number, linkedDate);
        if (bucketFilter === "leave") return LEAVE_CODES.has(st);
        if (bucketFilter === "absent") return ABSENT_CODES.has(st);
        if (bucketFilter === "present") return !LEAVE_CODES.has(st) && !ABSENT_CODES.has(st);
        return true;
      });
    }
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      r = r.filter(d => (d.full_name || "").toLowerCase().includes(s) || (d.identity_number || "").toLowerCase().includes(s));
    }
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDrivers, project, bucketFilter, linkedDate, search, attendanceMap, shiftDaySet]);

  async function setStatus(d, day, status) {
    const key = `${d.identity_number}|${day}`;
    setSavingKey(key);
    const payload = {
      identity_number: d.identity_number,
      project: d.project,
      attendance_date: day,
      status,
      marked_by: session?.user?.email || null,
      updated_at: new Date().toISOString(),
    };
    const { error: err } = await sb.from("driver_attendance").upsert(payload, { onConflict: "identity_number,attendance_date" });
    setSavingKey(null);
    if (err) { window.alert(t("common.saveFailed") + err.message); return; }
    setAttendanceMap(m => ({ ...m, [key]: status }));
  }

  const columns = useMemo(() => {
    const cols = [
      { accessorKey: "identity_number", header: t("drivers.colIdNumber") },
      { accessorKey: "full_name", header: t("common.name") },
      { accessorKey: "project", header: t("common.project"), cell: ({ getValue }) => getValue() || "—" },
    ];
    for (const day of days) {
      const dayNum = Number(day.slice(-2));
      const dow = new Date(day + "T00:00:00Z").getUTCDay();
      cols.push({
        id: "d" + day,
        header: () => (
          <div className="att-day-header">
            <span>{dayNum}</span>
            <span className="dow">{WEEKDAY[lang === "ar" ? "ar" : "en"][dow]}</span>
          </div>
        ),
        enableSorting: false,
        meta: { align: "center", narrow: true },
        cell: ({ row }) => {
          const d = row.original;
          const st = statusOf(d.identity_number, day);
          const code = ATTENDANCE_CODE_MAP[st] || ATTENDANCE_CODE_MAP[DEFAULT_ATTENDANCE_CODE];
          const key = `${d.identity_number}|${day}`;
          return (
            <select
              className="att-cell-select"
              style={{ background: code.bg, color: code.ink }}
              value={st}
              disabled={savingKey === key}
              onChange={e => setStatus(d, day, e.target.value)}
            >
              {ATTENDANCE_CODES.map(c => <option key={c.code} value={c.code}>{c.code}</option>)}
            </select>
          );
        },
      });
    }
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, lang, days, attendanceMap, shiftDaySet, savingKey]);

  return (
    <>
      <div className="content-header">
        <div>
          <div className="breadcrumb">{t("common.dashboard")} &gt; <b>{t("attendance.breadcrumb")}</b></div>
          <h1 className="page-title">{t("attendance.breadcrumb")}</h1>
          <p style={{ color: "var(--ink-muted)", fontSize: "0.85rem", marginTop: "0.2rem" }}>{t("attendance.pageSub")}</p>
        </div>
      </div>

      <div className="att-legend">
        {ATTENDANCE_CODES.map(c => (
          <span key={c.code} className="att-legend-item" style={{ background: c.bg, color: c.ink }}>
            <span className="att-legend-code">{c.code}</span>
            {lang === "ar" ? c.labelAr : c.labelEn}
          </span>
        ))}
      </div>

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
        {bucketFilter && (
          <button className="btn" onClick={() => setBucketFilter("")}>
            {t("common.clearFilters")}
          </button>
        )}
        <div className="att-month-nav">
          <button className="btn" onClick={() => setMonth(m => addMonths(m, -1))}>‹</button>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} />
          <button className="btn" onClick={() => setMonth(m => addMonths(m, 1))}>›</button>
        </div>
      </div>

      {error && <div style={{ color: "var(--critical)", fontSize: "0.85rem", marginBottom: "0.8rem" }}>{error}</div>}
      <div className="cards-count">{loading ? t("common.loading") : t("attendance.driversCount", { n: rows.length })}</div>

      <DataTable columns={columns} data={rows} pageSize={15} emptyMessage={loading ? t("common.loading") : t("attendance.noMatchingDrivers")} />
    </>
  );
}
