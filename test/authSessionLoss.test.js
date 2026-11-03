/* NEW-1 points 4–6 (follow-up to B2619760) — a session that is not known yet, a session that died, a Sign out that was
 * asked for, and the e-mail link read before the router erases it. The behaviour is driven for real in
 * e2e/auth-dead-ends.spec.js; these pin the decisions and the seams so they cannot quietly come back. */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { userLeftOnSignOut } from "../src/workspaces/site-planner/lib/bootResume.js";
import { hasStoredSessionKey, markDeliberateSignOut, clearSignOutIntent, signOutWasDeliberate, authEventMeta, SIGNED_OUT_NOTICE } from "../src/shared/auth/sessionIntent.js";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const memStore = (entries = {}) => { const m = { ...entries }; return { get length() { return Object.keys(m).length; }, key: (i) => Object.keys(m)[i] ?? null, getItem: (k) => (k in m ? m[k] : null) }; };

describe("a session that died keeps the route; a deliberate sign-out leaves", () => {
  it("userLeftOnSignOut", () => {
    expect(userLeftOnSignOut({ lost: true })).toBe(false);      // the plan stays in the URL → signing in returns to it
    expect(userLeftOnSignOut({ lost: false, deliberate: true })).toBe(true);
    expect(userLeftOnSignOut(undefined)).toBe(true);            // no information = the pre-fix behaviour
  });
});

describe("hasStoredSessionKey", () => {
  it("true only for a Supabase session key with a value", () => {
    expect(hasStoredSessionKey(memStore({ "sb-abc-auth-token": "{\"a\":1}" }))).toBe(true);
    expect(hasStoredSessionKey(memStore({ "sb-abc-auth-token": "" }))).toBe(false);
    expect(hasStoredSessionKey(memStore({ "planarfit:sites:v1": "x" }))).toBe(false);
    expect(hasStoredSessionKey(memStore())).toBe(false);
    expect(hasStoredSessionKey({ get length() { throw new Error("blocked"); } })).toBe(false);   // never throws
  });
});

describe("deliberate sign-out intent", () => {
  beforeEach(() => clearSignOutIntent());
  it("is set by the auth wrappers and ended by the next sign-in", () => {
    expect(signOutWasDeliberate()).toBe(false);
    markDeliberateSignOut();
    expect(signOutWasDeliberate()).toBe(true);
    expect(authEventMeta("SIGNED_OUT", null, { deliberate: signOutWasDeliberate() }).lost).toBe(false);
    clearSignOutIntent();
    expect(authEventMeta("SIGNED_OUT", null, { deliberate: signOutWasDeliberate() }).lost).toBe(true);
  });
  it("the words", () => expect(SIGNED_OUT_NOTICE).toBe("You were signed out. Sign in to continue."));
});

describe("seams", () => {
  const planner = read("../src/workspaces/site-planner/SitePlannerApp.jsx");
  const shell = read("../src/app/Shell.jsx");
  const auth = read("../src/workspaces/site-planner/lib/auth.js");
  const main = read("../src/main.jsx");
  it("TOKEN_REFRESHED reaches applyUser (its same-user check de-dupes); only recovery and profile edits are skipped", () => {
    expect(planner).toMatch(/if \(event === "PASSWORD_RECOVERY" \|\| event === "USER_UPDATED"\) return;/);
    expect(planner).not.toMatch(/event === "TOKEN_REFRESHED"\) return;/);
    expect(planner).toContain("if (uid && uid === prevUid.current && event !== \"SIGNED_OUT\") return;");
  });
  it("a lost session does not mark the project as left, and does not raise the 'project missing' banner", () => {
    expect(planner).toMatch(/if \(userLeftOnSignOut\(meta\)\) userLeftProjectRef\.current = true;/);
    expect(planner).toMatch(/if \(sessionLostRef\.current\) \{ setActiveSiteId\(null\); setMode\("map"\); \}/);
  });
  it("the Shell stays neutral while a stored session is pending, shows the notice for a lost one, and reads the link at load", () => {
    expect(shell).toMatch(/if \(meta && meta\.pending\) \{ setAuthPending\(true\); return; \}/);
    expect(shell).toMatch(/else if \(meta && meta\.lost\) setSignedOutNotice\(true\)/);
    expect(shell).toContain("useState(() => authReturn())");
    expect(shell).toMatch(/useState\(\(\) => !!linkReturn\.recovery\)/);
  });
  it("the sign-out wrappers say it was deliberate BEFORE they talk to Supabase; every event carries meta", () => {
    expect(auth).toMatch(/markDeliberateSignOut\(\);[^\n]*\n\s*try \{ await supabase\.auth\.signOut\(\); \}/);
    expect(auth).toMatch(/markDeliberateSignOut\(\);\s*\n\s*try \{\s*\n\s*const \{ error \} = await supabase\.auth\.signOut\(\{ scope: "global" \}\)/);
    expect(auth).toContain("currentAuthEventMeta(event, user)");
  });
  it("the URL is read before anything else runs", () => {
    expect(main.indexOf('import "./shared/auth/authReturn.js"')).toBeGreaterThanOrEqual(0);
    expect(main.indexOf('import "./shared/auth/authReturn.js"')).toBeLessThan(main.indexOf('import React'));
  });
});
