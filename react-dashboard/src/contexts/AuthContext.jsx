import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { sb } from "../lib/supabase";
import { cacheClearAll } from "../lib/fuelInvoiceCache";

const AuthContext = createContext(null);

// Roles live in app_metadata (role: "admin" | "project_supervisor" |
// "fleet_manager" | "viewer", project: <project name> | null). app_metadata can only be
// written server-side (SQL editor / service role) — unlike user_metadata, which
// the signed-in user can edit themselves, so it must never be used for access.
// Nothing here falls back to user_metadata. No session, or a session without a
// recognised role, gets no privileges at all.
const NO_ACCESS = {
  isAdmin: false, isFleetManager: false, isProjectSupervisor: false, isViewer: false, currentUserProject: null,
  canEditShiftEntries: false, canEditAttendance: false, canSetActiveStatus: false,
};

function scopeFromSession(sess) {
  const meta = sess?.user?.app_metadata;
  if (!meta) return NO_ACCESS;
  const role = meta.role;
  const isAdmin = role === "admin";
  const isFleetManager = role === "fleet_manager";
  const isProjectSupervisor = role === "project_supervisor";
  // viewer: read-only, all projects, a fixed list of pages (see lib/viewerAccess.js).
  // Never has a project of its own, and can write nothing (migration 056).
  const isViewer = role === "viewer";
  if (!isAdmin && !isFleetManager && !isProjectSupervisor && !isViewer) return NO_ACCESS;
  const currentUserProject = isViewer ? null : (meta.project || null);
  // Write access to shift entries / attendance / submission reasons: admins, and
  // project supervisors for their own project's drivers (migration 053). A fleet
  // manager is read-only there, whatever project value they carry.
  const canWriteOps = isAdmin || (isProjectSupervisor && !!currentUserProject);
  // Deactivating / reactivating drivers and vehicles (through set_active_status):
  // admins and fleet managers only.
  const canSetActiveStatus = isAdmin || isFleetManager;
  return {
    isAdmin, isFleetManager, isProjectSupervisor, isViewer, currentUserProject,
    canEditShiftEntries: canWriteOps, canEditAttendance: canWriteOps, canSetActiveStatus,
  };
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = loading, null = logged out
  const roleRefreshTriedRef = useRef(false);
  // Derived from the session on every change, so it can't lag behind it (and is
  // "no access" until the session is known).
  const scope = useMemo(() => scopeFromSession(session), [session]);

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => {
      setSession(data.session || null);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // A session created before the roles were copied into app_metadata still
  // carries the old user object. Refresh it once so those users get their role
  // without having to log out and back in (guarded: never loops).
  useEffect(() => {
    if (!session) { roleRefreshTriedRef.current = false; return; }
    if (session.user?.app_metadata?.role || roleRefreshTriedRef.current) return;
    roleRefreshTriedRef.current = true;
    sb.auth.refreshSession().catch(() => {});
  }, [session]);

  async function login(email, password) {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    return error;
  }

  async function logout() {
    await cacheClearAll();
    await sb.auth.signOut();
  }

  return (
    <AuthContext.Provider value={{ session, ...scope, login, logout, loading: session === undefined }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
