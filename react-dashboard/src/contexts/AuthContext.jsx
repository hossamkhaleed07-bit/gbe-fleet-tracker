import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { sb } from "../lib/supabase";
import { cacheClearAll } from "../lib/fuelInvoiceCache";

const AuthContext = createContext(null);

// Roles live in app_metadata (role: "admin" | "project_supervisor" |
// "fleet_manager", project: <project name> | null). app_metadata can only be
// written server-side (SQL editor / service role) — unlike user_metadata, which
// the signed-in user can edit themselves, so it must never be used for access.
// Nothing here falls back to user_metadata. No session, or a session without a
// recognised role, gets no privileges at all.
const NO_ACCESS = { isAdmin: false, isFleetManager: false, currentUserProject: null, canEditShiftEntries: false };

function scopeFromSession(sess) {
  const meta = sess?.user?.app_metadata;
  if (!meta) return NO_ACCESS;
  const role = meta.role;
  const isAdmin = role === "admin";
  const isFleetManager = role === "fleet_manager";
  const isProjectSupervisor = role === "project_supervisor";
  if (!isAdmin && !isFleetManager && !isProjectSupervisor) return NO_ACCESS;
  const currentUserProject = meta.project || null;
  // Project-scoped accounts (e.g. fdp.manager@gbe.sa) can edit/delete shift_entries
  // for their own project's drivers (see migration 032) — anyone with a project
  // claim, not just fleet managers.
  const canEditShiftEntries = isAdmin || !!currentUserProject;
  return { isAdmin, isFleetManager, currentUserProject, canEditShiftEntries };
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
