// DataProvider must not restart the dashboard load on auth events that don't
// change who is signed in (see sessionLoadKey.js).
import { describe, expect, it } from "vitest";
import { sessionLoadKey } from "./sessionLoadKey";

const session = (overrides = {}) => ({
  access_token: "t1",
  expires_at: 1000,
  user: { id: "u1", app_metadata: { role: "admin", project: null } },
  ...overrides,
});

describe("sessionLoadKey", () => {
  it("is null without a signed-in user", () => {
    expect(sessionLoadKey(null)).toBeNull();
    expect(sessionLoadKey(undefined)).toBeNull();
    expect(sessionLoadKey({ user: null })).toBeNull();
  });

  it("stays the same across token refreshes and tab-focus SIGNED_IN events", () => {
    const first = session();
    // A fresh object with a new token, as supabase-js emits on TOKEN_REFRESHED
    // or on SIGNED_IN after the tab becomes visible again.
    const refreshed = session({ access_token: "t2", expires_at: 2000, user: { ...first.user } });
    expect(refreshed).not.toBe(first);
    expect(sessionLoadKey(refreshed)).toBe(sessionLoadKey(first));
  });

  it("changes when a different user signs in", () => {
    const other = session({ user: { id: "u2", app_metadata: { role: "admin" } } });
    expect(sessionLoadKey(other)).not.toBe(sessionLoadKey(session()));
  });

  it("changes when the role or project changes (what the server lets them read)", () => {
    const base = sessionLoadKey(session());
    const withRole = session({ user: { id: "u1", app_metadata: { role: "viewer" } } });
    const withProject = session({ user: { id: "u1", app_metadata: { role: "admin", project: "P1" } } });
    expect(sessionLoadKey(withRole)).not.toBe(base);
    expect(sessionLoadKey(withProject)).not.toBe(base);
    // A session refreshed only to pick up a missing role (AuthContext does this once).
    const noRole = session({ user: { id: "u1", app_metadata: {} } });
    expect(sessionLoadKey(noRole)).not.toBe(base);
  });
});
