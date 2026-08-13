/* B326416 / B326418 — the default-team-sharing resolution rule.
 *
 * The property under test is not "does it share" but "can it EVER share when it should not".
 * Every branch that cannot name exactly one team must return null, because the failure this
 * feature could cause — exposing plans someone believed were private — is far worse than the
 * feature not firing. So most of what follows asserts a REFUSAL.
 *
 * (The database half of the same guarantee is tested directly against RLS in
 * src/workspaces/site-planner/db/test/team_share_scope.test.sql, which is where the real
 * enforcement lives; this file covers only the client-side resolution.)
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  DEFAULT_SHARE_PREF, SHARE_REASONS, normalizeSharePref,
  resolveNewProjectTeam, resolveNewPlanTeam,
  primeShareContext, defaultShareTeam, resetShareContext,
} from "../src/workspaces/site-planner/lib/newProjectSharing.js";

const TEAM_A = { id: "team-a", name: "Alpha" };
const TEAM_B = { id: "team-b", name: "Beta" };

describe("normalizeSharePref", () => {
  it("defaults to ON when the key has never been written", () => {
    expect(normalizeSharePref(undefined)).toEqual({ enabled: true, teamId: null });
    expect(normalizeSharePref({})).toEqual({ enabled: true, teamId: null });
  });
  it("only an explicit false turns it off — malformed values can't silently disable it", () => {
    expect(normalizeSharePref({ enabled: false }).enabled).toBe(false);
    for (const junk of [null, 0, "", "no", NaN, undefined])
      expect(normalizeSharePref({ enabled: junk }).enabled).toBe(true);
  });
  it("rejects a non-string / empty teamId rather than carrying it", () => {
    for (const junk of [123, {}, [], "", null, true])
      expect(normalizeSharePref({ teamId: junk }).teamId).toBe(null);
    expect(normalizeSharePref({ teamId: "team-a" }).teamId).toBe("team-a");
  });
  it("DEFAULT_SHARE_PREF is itself normal", () => {
    expect(normalizeSharePref(DEFAULT_SHARE_PREF)).toEqual(DEFAULT_SHARE_PREF);
  });
});

describe("resolveNewProjectTeam — the solo user is untouched", () => {
  // Michael is often working solo. Nothing about his experience may change.
  it("returns null for a user on no team, whatever the preference says", () => {
    for (const pref of [undefined, {}, { enabled: true }, { enabled: true, teamId: "team-a" }, { enabled: false }]) {
      const r = resolveNewProjectTeam({ pref, teams: [] });
      expect(r.teamId).toBe(null);
      expect(r.reason).toBe(SHARE_REASONS.NO_TEAMS);
    }
  });
  it("treats a missing / malformed team list as no teams", () => {
    for (const teams of [undefined, null, "nope", [null], [{}], [{ id: "" }], [{ id: 7 }]])
      expect(resolveNewProjectTeam({ pref: {}, teams }).teamId).toBe(null);
  });
});

describe("resolveNewProjectTeam — the feature itself", () => {
  it("shares with the single team by default (nothing to choose)", () => {
    const r = resolveNewProjectTeam({ pref: {}, teams: [TEAM_A] });
    expect(r).toEqual({ teamId: "team-a", reason: SHARE_REASONS.ONE_TEAM, teamName: "Alpha" });
  });
  it("honours the chosen team when there are several", () => {
    const r = resolveNewProjectTeam({ pref: { teamId: "team-b" }, teams: [TEAM_A, TEAM_B] });
    expect(r).toEqual({ teamId: "team-b", reason: SHARE_REASONS.CHOSEN, teamName: "Beta" });
  });
});

describe("resolveNewProjectTeam — every ambiguity DENIES", () => {
  it("refuses when the switch is off", () => {
    const r = resolveNewProjectTeam({ pref: { enabled: false }, teams: [TEAM_A] });
    expect(r.teamId).toBe(null);
    expect(r.reason).toBe(SHARE_REASONS.DISABLED);
  });
  it("refuses when several teams exist and none was chosen — never picks one", () => {
    const r = resolveNewProjectTeam({ pref: {}, teams: [TEAM_A, TEAM_B] });
    expect(r.teamId).toBe(null);
    expect(r.reason).toBe(SHARE_REASONS.AMBIGUOUS);
  });
  it("refuses when the chosen team is no longer one of yours — and does NOT fall back to another", () => {
    // The dangerous shape: you were removed from Beta, so a fallback would publish the project to
    // Alpha, a set of people you never chose.
    const r = resolveNewProjectTeam({ pref: { teamId: "team-b" }, teams: [TEAM_A] });
    expect(r.teamId).toBe(null);
    expect(r.reason).toBe(SHARE_REASONS.CHOSEN_GONE);
  });
  it("the disabled switch beats a chosen team", () => {
    expect(resolveNewProjectTeam({ pref: { enabled: false, teamId: "team-a" }, teams: [TEAM_A] }).teamId).toBe(null);
  });
  it("never returns a team id that is not in the caller's own list", () => {
    const cases = [
      { pref: { teamId: "team-x" }, teams: [TEAM_A, TEAM_B] },
      { pref: { teamId: "team-x" }, teams: [TEAM_A] },
      { pref: {}, teams: [TEAM_A, TEAM_B] },
      { pref: { enabled: false }, teams: [TEAM_A] },
    ];
    for (const c of cases) {
      const { teamId } = resolveNewProjectTeam(c);
      if (teamId !== null) expect(c.teams.map((t) => t.id)).toContain(teamId);
    }
  });
  it("always names a reason — a bare null is never an acceptable answer (LOUD-FAILURE)", () => {
    const all = [
      { pref: {}, teams: [] }, { pref: { enabled: false }, teams: [TEAM_A] },
      { pref: {}, teams: [TEAM_A, TEAM_B] }, { pref: { teamId: "gone" }, teams: [TEAM_A] },
      { pref: {}, teams: [TEAM_A] }, { pref: { teamId: "team-b" }, teams: [TEAM_A, TEAM_B] },
    ];
    for (const c of all) expect(typeof resolveNewProjectTeam(c).reason).toBe("string");
    expect(typeof resolveNewProjectTeam().reason).toBe("string"); // called with nothing at all
  });
});

describe("resolveNewPlanTeam — a plan inherits its PROJECT, never the account default", () => {
  it("inherits a shared project's team", () => {
    expect(resolveNewPlanTeam([{ teamId: "team-a" }, { teamId: "team-a" }]))
      .toEqual({ teamId: "team-a", reason: "inherited" });
  });
  it("stays private inside a private project — the back door that would share an OLD project", () => {
    // This is the case that keeps "new projects only" honest from the other direction: adding a
    // plan to a pre-existing private project must never consult the default-on preference.
    expect(resolveNewPlanTeam([{ teamId: null }, {}]).teamId).toBe(null);
  });
  it("denies when the project's plans disagree — never guesses which was right", () => {
    const r = resolveNewPlanTeam([{ teamId: "team-a" }, { teamId: "team-b" }]);
    expect(r.teamId).toBe(null);
    expect(r.reason).toBe("group-disagrees");
  });
  it("denies when a shared plan sits beside an unshared one", () => {
    expect(resolveNewPlanTeam([{ teamId: "team-a" }, { teamId: null }]).teamId).toBe(null);
  });
  it("handles an empty / malformed sibling list", () => {
    for (const v of [[], undefined, null, "nope", [null]])
      expect(resolveNewPlanTeam(v).teamId).toBe(null);
  });
});

describe("defaultShareTeam — the cached runtime half fails CLOSED", () => {
  beforeEach(() => resetShareContext());

  const loaders = (prefs, teams) => ({
    loadPrefs: async () => ({ prefs: { newProjectSharing: prefs } }),
    listTeams: async () => teams,
  });

  it("resolves from the primed context", async () => {
    await primeShareContext("u1", loaders({ enabled: true }, [TEAM_A]));
    expect((await defaultShareTeam("u1")).teamId).toBe("team-a");
  });

  it("returns private when there is no signed-in user", async () => {
    expect((await defaultShareTeam(null)).teamId).toBe(null);
  });

  it("returns private when the preference lookup THROWS — an unreadable pref is not consent", async () => {
    await primeShareContext("u1", {
      loadPrefs: async () => { throw new Error("offline"); },
      listTeams: async () => [TEAM_A],
    });
    const r = await defaultShareTeam("u1", { loadPrefs: async () => { throw new Error("offline"); }, listTeams: async () => [TEAM_A] });
    expect(r.teamId).toBe(null);
  });

  it("returns private when the TEAM lookup throws", async () => {
    const bad = { loadPrefs: async () => ({ prefs: {} }), listTeams: async () => { throw new Error("offline"); } };
    await primeShareContext("u1", bad);
    expect((await defaultShareTeam("u1", bad)).teamId).toBe(null);
  });

  it("never serves one user's context to another — a stale team must not follow a sign-out", async () => {
    await primeShareContext("u1", loaders({ enabled: true }, [TEAM_A]));
    expect((await defaultShareTeam("u1")).teamId).toBe("team-a");
    // u2 arrives with their own (empty) team list; u1's answer must not leak across.
    const r = await defaultShareTeam("u2", loaders({ enabled: true }, []));
    expect(r.teamId).toBe(null);
  });

  it("re-reads the preference each time, so turning the switch off takes effect immediately", async () => {
    let enabled = true;
    const dyn = { loadPrefs: async () => ({ prefs: { newProjectSharing: { enabled } } }), listTeams: async () => [TEAM_A] };
    await primeShareContext("u1", dyn);
    expect((await defaultShareTeam("u1", dyn)).teamId).toBe("team-a");
    enabled = false;
    resetShareContext();                       // what the Team panel does on save
    await primeShareContext("u1", dyn);
    expect((await defaultShareTeam("u1", dyn)).teamId).toBe(null);
  });
});
