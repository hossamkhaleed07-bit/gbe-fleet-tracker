import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { sb } from "../lib/supabase";
import { useLang } from "../contexts/LanguageContext";
import { formatLocalDateTime } from "../lib/calc";
import { useAuth } from "../contexts/AuthContext";

const STORAGE_KEY = "gbe-notifications-v1";
const MAX_STORED = 50;

function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    [880, 660].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = now + i * 0.14;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.18);
    });
  } catch { /* audio unavailable (autoplay-blocked or unsupported) — notification still shows visually */ }
}

function loadStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveStored(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_STORED)));
  } catch { /* storage unavailable, notifications just won't persist */ }
}

export default function NotificationCenter() {
  const { t } = useLang();
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [notifications, setNotifications] = useState(loadStored);
  // Unread admin notifications kept in the database (a fleet manager deactivated /
  // reactivated a driver or vehicle). Only admins can read them; marking one read
  // goes through mark_admin_notifications_read.
  const [dbNotes, setDbNotes] = useState([]);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [headerEl, setHeaderEl] = useState(null);
  const rootRef = useRef(null);

  useEffect(() => {
    // Prefer the bell slot in the Layout hero nav; fall back to the page header.
    setHeaderEl(document.getElementById("fx-bell-slot") || document.querySelector(".content-header"));
  }, [location.pathname]);

  useEffect(() => {
    saveStored(notifications);
  }, [notifications]);

  function addNotification(entry) {
    const full = { id: `${Date.now()}-${Math.random()}`, read: false, time: new Date().toISOString(), ...entry };
    setNotifications(list => [full, ...list].slice(0, MAX_STORED));
    setToast(full);
    playNotificationSound();
  }

  useEffect(() => {
    const channel = sb
      .channel("notifications_reinforcement_requests")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "reinforcement_requests" }, payload => {
        const r = payload.new;
        addNotification({
          type: "fuel",
          title: t("notifications.fuelTitle"),
          subtitle: t("notifications.fuelSubtitle", { name: r.full_name, amount: r.amount ?? "—" }),
          path: "/fuel-approver",
        });
      })
      .subscribe();
    return () => { sb.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const channel = sb
      .channel("notifications_shift_entries")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "shift_entries" }, payload => {
        const r = payload.new;
        const typeLabel = r.shift_type === "start" ? t("records.typeStart") : t("records.typeEnd");
        addNotification({
          type: "shift",
          title: t("notifications.shiftTitle", { type: typeLabel }),
          subtitle: t("notifications.shiftSubtitle", { name: r.full_name, plate: r.vehicle_plate || "—" }),
          path: "/form-response",
        });
      })
      .subscribe();
    return () => { sb.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function dbNoteToItem(r) {
    const typeLabel = t(r.target_type === "vehicle" ? "notifications.typeVehicle" : "notifications.typeDriver");
    const name = r.target_label || r.target_key;
    const by = r.acted_by_email || "—";
    return {
      id: `db-${r.id}`,
      dbId: r.id,
      type: "active",
      read: !!r.is_read,
      time: r.created_at,
      title: t(r.kind === "deactivate" ? "notifications.activeDeactivated" : "notifications.activeReactivated", { type: typeLabel }),
      subtitle: r.reason
        ? t("notifications.activeSubtitleReason", { name, by, reason: r.reason })
        : t("notifications.activeSubtitle", { name, by }),
      path: r.target_type === "vehicle" ? "/fleet" : "/drivers",
    };
  }

  async function fetchDbNotes() {
    const { data } = await sb.from("admin_notifications")
      .select("id,kind,target_type,target_key,target_label,reason,acted_by_email,created_at,is_read")
      .eq("is_read", false)
      .order("created_at", { ascending: false })
      .limit(MAX_STORED);
    if (data) setDbNotes(data);
  }

  useEffect(() => {
    if (!isAdmin) { setDbNotes([]); return undefined; }
    fetchDbNotes();
    const channel = sb
      .channel("notifications_admin_active_status")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "admin_notifications" }, payload => {
        const r = payload.new;
        setDbNotes(list => (list.some(x => x.id === r.id) ? list : [r, ...list].slice(0, MAX_STORED)));
        setToast(dbNoteToItem(r));
        playNotificationSound();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "admin_notifications" }, payload => {
        const r = payload.new;
        setDbNotes(list => (r.is_read ? list.filter(x => x.id !== r.id) : list.map(x => (x.id === r.id ? { ...x, ...r } : x))));
      })
      .subscribe();
    return () => { sb.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  // Database-backed notes (admins) first, then the local live-event ones, newest first.
  const items = [...dbNotes.map(dbNoteToItem), ...notifications]
    .sort((a, b) => new Date(b.time) - new Date(a.time))
    .slice(0, MAX_STORED);
  const unreadCount = items.filter(n => !n.read).length;

  async function markDbRead(ids) {
    setDbNotes(list => (ids ? list.filter(x => !ids.includes(x.id)) : []));
    const { error } = await sb.rpc("mark_admin_notifications_read", { p_ids: ids });
    if (error) fetchDbNotes(); // could not save: show what is really still unread
  }

  function markAllRead() {
    setNotifications(list => list.map(n => ({ ...n, read: true })));
    if (isAdmin && dbNotes.length) markDbRead(null);
  }

  function handleItemClick(n) {
    if (n.dbId) markDbRead([n.dbId]);
    else setNotifications(list => list.map(x => (x.id === n.id ? { ...x, read: true } : x)));
    setOpen(false);
    navigate(n.path);
  }

  const bell = (
    <div className="notif-bell-wrap" ref={rootRef}>
      <button className="notif-bell-btn" onClick={() => setOpen(o => !o)} aria-label={t("notifications.title")}>
        🔔
        {unreadCount > 0 && <span className="notif-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
      </button>
      {open && (
        <div className="notif-panel">
          <div className="notif-panel-header">
            <span>{t("notifications.title")}</span>
            {unreadCount > 0 && <button className="notif-mark-all" onClick={markAllRead}>{t("notifications.markAllRead")}</button>}
          </div>
          <div className="notif-list">
            {!items.length ? (
              <div className="notif-empty">{t("notifications.empty")}</div>
            ) : items.map(n => (
              <button key={n.id} className={"notif-item" + (n.read ? "" : " unread")} onClick={() => handleItemClick(n)}>
                <span className="notif-item-icon">{n.type === "fuel" ? "⛽" : n.type === "active" ? "🔄" : "📝"}</span>
                <span className="notif-item-body">
                  <span className="notif-item-title">{n.title}</span>
                  <span className="notif-item-subtitle">{n.subtitle}</span>
                  <span className="notif-item-time">{formatLocalDateTime(n.time)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <>
      {headerEl && createPortal(bell, headerEl)}
      {toast && createPortal(
        <div className="reinforcement-toast">
          <span className="reinforcement-toast-icon">{toast.type === "fuel" ? "⛽" : toast.type === "active" ? "🔄" : "📝"}</span>
          <span>{toast.title}: {toast.subtitle}</span>
          <button className="btn btn-primary" onClick={() => { navigate(toast.path); setToast(null); }}>{t("fuel.openRequest")}</button>
          <button className="btn" onClick={() => setToast(null)}>{t("common.close")}</button>
        </div>,
        document.body
      )}
    </>
  );
}
