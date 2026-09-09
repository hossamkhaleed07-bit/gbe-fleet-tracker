import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { sb } from "../lib/supabase";
import { useLang } from "../contexts/LanguageContext";
import { formatLocalDateTime } from "../lib/calc";

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
  const navigate = useNavigate();
  const location = useLocation();
  const [notifications, setNotifications] = useState(loadStored);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [headerEl, setHeaderEl] = useState(null);
  const rootRef = useRef(null);

  useEffect(() => {
    setHeaderEl(document.querySelector(".content-header"));
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

  const unreadCount = notifications.filter(n => !n.read).length;

  function markAllRead() {
    setNotifications(list => list.map(n => ({ ...n, read: true })));
  }

  function handleItemClick(n) {
    setNotifications(list => list.map(x => (x.id === n.id ? { ...x, read: true } : x)));
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
            {!notifications.length ? (
              <div className="notif-empty">{t("notifications.empty")}</div>
            ) : notifications.map(n => (
              <button key={n.id} className={"notif-item" + (n.read ? "" : " unread")} onClick={() => handleItemClick(n)}>
                <span className="notif-item-icon">{n.type === "fuel" ? "⛽" : "📝"}</span>
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
          <span className="reinforcement-toast-icon">{toast.type === "fuel" ? "⛽" : "📝"}</span>
          <span>{toast.title}: {toast.subtitle}</span>
          <button className="btn btn-primary" onClick={() => { navigate(toast.path); setToast(null); }}>{t("fuel.openRequest")}</button>
          <button className="btn" onClick={() => setToast(null)}>{t("common.close")}</button>
        </div>,
        document.body
      )}
    </>
  );
}
