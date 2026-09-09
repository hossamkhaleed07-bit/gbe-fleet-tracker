import { createContext, useContext, useEffect, useState } from "react";
import { sb } from "../lib/supabase";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = loading, null = logged out
  const [scope, setScope] = useState({ isAdmin: true, isFleetManager: false, currentUserProject: null, canEditShiftEntries: true });

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => {
      setSession(data.session || null);
      applyScope(data.session);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      applyScope(sess);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  function applyScope(sess) {
    const meta = sess?.user?.user_metadata || {};
    const currentUserProject = meta.project || null;
    const isFleetManager = meta.role === "fleet_manager";
    const isAdmin = !currentUserProject && !isFleetManager;
    // Project-scoped accounts (e.g. fdp.manager@gbe.sa) can edit/delete shift_entries
    // for their own project's drivers (see migration 032) — anyone with a project
    // claim, not just fleet managers.
    const canEditShiftEntries = isAdmin || !!currentUserProject;
    setScope({ isAdmin, isFleetManager, currentUserProject, canEditShiftEntries });
  }

  async function login(email, password) {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    return error;
  }

  async function logout() {
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
