// What DataProvider reloads the dashboard on: WHO is signed in and what the
// server lets them read (row-level security keys on role/project in
// app_metadata), not the session object itself.
//
// supabase-js hands out a NEW session object on every auth event — including a
// SIGNED_IN every time the tab goes hidden -> visible, and TOKEN_REFRESHED. The
// effect used to depend on [session], so each tab switch restarted the whole
// load; loadData's request-id guard then dropped the in-flight response, and
// with the full-range load taking 15+ s the page could sit on "Loading..."
// indefinitely while every request returned 200.
export function sessionLoadKey(session) {
  const user = session?.user;
  if (!user?.id) return null;
  const meta = user.app_metadata || {};
  return `${user.id}|${meta.role || ""}|${meta.project || ""}`;
}
