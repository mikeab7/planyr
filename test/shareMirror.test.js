/* NEW-1 / NEW-2 / NEW-3 — the sharing workflow: the pointer must SURVIVE, the outcome must be
 * NAMED, and the group key must be the one the rest of the app uses.
 *
 * Owner report (2026-08-11): "It's not very clear when a site is shared… when I tried to share
 * 8 South it gave me this pop up… which is obviously not true because it's been in cloud for weeks…
 * And when I do click, it isn't clear that it has been shared, and options still pop up to share
 * it." Production ground truth at the time: exactly 2 of 34 projects carried a team_id (8 South
 * smqiljx5fngg at version 587, and RICHEY smraxmrwiyzk), both to team 454aa114.
 *
 * The three defects, each pinned below with a MUTATION CHECK that replays the pre-fix rule, because
 * every one of them is invisible to a test that only asserts the happy path:
 *   NEW-2  the local model's `teamId` was outvoted by `updatedAt` on every pull, so all three
 *          sharing indicators went blank at once even though the database was correct.
 *   NEW-1  "0 rows changed" was read as "0 rows exist".
 *   NEW-3  both share RPCs grouped by the `group_id` COLUMN — the drifting mirror the rename fix
 *          exists to avoid.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mergePulledSites, saveSite, loadSite } from "../src/workspaces/site-planner/lib/storage.js";
import { mergeSiteContent, createSiteModel, shareMirrorOf, withShareMirror, SHARE_MIRROR_FIELDS } from "../src/workspaces/site-planner/lib/siteModel.js";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(resolve(here, p), "utf8");
/* ⛔ Every source guard below reads CODE ONLY. A guard that a COMMENT can satisfy — or trip — is
 * worthless: these files document the defect they fixed by quoting the old line verbatim, so an
 * un-stripped read finds `r.sites === 0` in prose and reports the bug as still present (it did,
 * on the first run of this suite). Strip block and line comments first, always. */
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const TEAM = "454aa114-1318-462d-8f78-ffad6ac01cac";   // the owner's real team (HIP Houston)
const OWNER = "owner-uid";

// A local cache record and a cloud row, as `mergePulledSites` sees them. The cloud row carries the
// `shareMirror` that `cloudSync.cloudList` stamps from the real columns.
const local = (over = {}) => ({ id: "smqiljx5fngg", groupId: "smqiljx5fngg", site: "8 South", name: "Concept A", updatedAt: 5000, els: [], ...over });
const cloudRow = (over = {}) => {
  const { mirror, ...rest } = { mirror: { teamId: TEAM, ownerId: OWNER, shareLocked: false }, ...over };
  return { id: "smqiljx5fngg", groupId: "smqiljx5fngg", site: "8 South", name: "Concept A", updatedAt: 1000, els: [], ...rest,
    ...(mirror ? { shareMirror: mirror } : {}) };
};

// The suite runs in the `node` environment (vitest.config.js), so localStorage is installed the way
// every other storage suite here installs it — a plain in-memory shim, fresh per test.
beforeEach(() => {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    key: (i) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length; },
  };
});

/* ─────────────────────────── NEW-2 · the mirror survives ─────────────────────────── */

describe("NEW-2 — the sharing pointer is a server-owned mirror, never resolved by updatedAt", () => {
  it("MUTATION CHECK: mergeSiteContent alone LOSES the cloud's teamId when local is newer — the defect", () => {
    // This is the pre-fix behaviour, asserted so it can never come back silently. `mergeSiteContent`
    // takes scalars from the newer copy by design (correct for content), and B458's mirror write
    // makes the LOCAL copy newer on any project edited since its last push.
    const merged = mergeSiteContent(createSiteModel(local({ teamId: null, updatedAt: 5000 })),
                                    createSiteModel({ ...cloudRow(), teamId: TEAM, updatedAt: 1000 }));
    expect(merged.teamId).toBeNull();   // ← the bug, in one line
  });

  it("mergePulledSites re-stamps the cloud column over a NEWER local copy (the fix)", () => {
    const { map } = mergePulledSites({ smqiljx5fngg: local({ teamId: null, updatedAt: 5000 }) },
      [cloudRow({ updatedAt: 1000, teamId: TEAM, ownerId: OWNER })], OWNER, {});
    expect(map.smqiljx5fngg.teamId).toBe(TEAM);
    expect(map.smqiljx5fngg.ownerId).toBe(OWNER);
  });

  it("carries ownerId and shareLocked too — all three are columns, not content", () => {
    const { map } = mergePulledSites({ smqiljx5fngg: local({ teamId: null, shareLocked: false, updatedAt: 9000 }) },
      [cloudRow({ mirror: { teamId: TEAM, ownerId: "someone-else", shareLocked: true } })], OWNER, {});
    expect(map.smqiljx5fngg.teamId).toBe(TEAM);
    expect(map.smqiljx5fngg.ownerId).toBe("someone-else");
    expect(map.smqiljx5fngg.shareLocked).toBe(true);
  });

  it("an UNSHARE performed on another device propagates: mirror says private → local clears", () => {
    const { map } = mergePulledSites({ smqiljx5fngg: local({ teamId: TEAM, updatedAt: 9000 }) },
      [cloudRow({ mirror: { teamId: null, ownerId: OWNER, shareLocked: false } })], OWNER, {});
    expect(map.smqiljx5fngg.teamId).toBeNull();
  });

  it("⛔ a PRE-MIGRATION database reports NO mirror, which must leave the local value alone", () => {
    // The load-bearing distinction: "the cloud did not say" is not "the cloud says private".
    // Conflating them would unshare every project on any database predating db/team_sharing.sql.
    const { map } = mergePulledSites({ smqiljx5fngg: local({ teamId: TEAM, updatedAt: 9000 }) },
      [cloudRow({ mirror: null })], OWNER, {});
    expect(map.smqiljx5fngg.teamId).toBe(TEAM);
  });

  it("shareMirrorOf reads only an explicit stamp; withShareMirror is identity-preserving on a no-op", () => {
    expect(shareMirrorOf({})).toBeNull();
    expect(shareMirrorOf({ shareMirror: { teamId: TEAM } })).toEqual({ teamId: TEAM, ownerId: null, shareLocked: false });
    const m = createSiteModel(local({ teamId: TEAM, ownerId: OWNER }));
    expect(withShareMirror(m, { teamId: TEAM, ownerId: OWNER, shareLocked: false })).toBe(m); // same object
    expect(withShareMirror(m, null)).toBe(m);
    expect(withShareMirror(m, { teamId: null, ownerId: OWNER, shareLocked: false })).not.toBe(m);
  });

  it("the mirror is NOT a Site Model field, so it can never be persisted as a second copy", () => {
    expect("shareMirror" in createSiteModel({ id: "x", shareMirror: { teamId: TEAM } })).toBe(false);
  });
});

describe("NEW-2 — saveSite: a CONTENT save may not move the sharing pointer (B714, local half)", () => {
  it("a stale in-memory model carrying teamId:null does NOT blank a shared record", () => {
    // The second hole. The planner holds a model loaded BEFORE the share; its partial carries an
    // EXPLICIT teamId:null, and an explicit key wins a spread — so an ordinary autosave blanked the
    // mirror seconds after the pull stamped it, putting the indicator straight back to private.
    saveSite(local({ teamId: TEAM, ownerId: OWNER }));
    expect(loadSite("smqiljx5fngg").teamId).toBe(TEAM);
    saveSite({ id: "smqiljx5fngg", groupId: "smqiljx5fngg", site: "8 South", name: "Concept A",
      teamId: null, ownerId: null, shareLocked: false, els: [{ id: "e1", type: "building", cx: 0, cy: 0, w: 10, h: 10 }] });
    const after = loadSite("smqiljx5fngg");
    expect(after.teamId).toBe(TEAM);          // sharing survived the content save
    expect(after.ownerId).toBe(OWNER);
    expect(after.els.length).toBe(1);         // ...and the content still landed
  });

  it("a BRAND-NEW record keeps its birth teamId — the one legitimate local writer (B326416)", () => {
    saveSite({ id: "fresh", groupId: "fresh", site: "New", name: "Concept A", teamId: TEAM, els: [] });
    expect(loadSite("fresh").teamId).toBe(TEAM);
  });

  it("SHARE_MIRROR_FIELDS is the single list both seams read", () => {
    expect(SHARE_MIRROR_FIELDS).toEqual(["teamId", "ownerId", "shareLocked"]);
  });
});

/* ─────────────────────────── NEW-1 · the outcome is named ─────────────────────────── */

describe("NEW-1 — the share result names its outcome; no caller reads a row count as existence", () => {
  const finder = code("../src/workspaces/site-planner/MapFinder.jsx");
  const sharing = code("../src/workspaces/site-planner/lib/sharing.js");

  it("MUTATION CHECK: the pre-fix conflation `r.sites === 0` is GONE from doShare", () => {
    // The exact line that produced the false popup on an already-shared project.
    expect(finder).not.toMatch(/r\.sites\s*===\s*0/);
  });

  it('the false message is now reachable ONLY from the named not-found outcome', () => {
    const msg = finder.indexOf("isn't in the cloud yet");
    expect(msg).toBeGreaterThan(-1);
    // The nearest preceding condition must be the outcome test, not a count test.
    const before = finder.slice(Math.max(0, msg - 400), msg);
    expect(before).toMatch(/outcome\s*===\s*"not-found"/);
  });

  it("sharing.js returns an `outcome` from every tier, and 'already' is a SUCCESS", () => {
    for (const o of ["not-found", "changed", "already"]) expect(sharing).toContain(`"${o}"`);
    // The older integer RPC raises for the absent case, so a 0 from it can only mean "already" —
    // never not-found. Pin that reasoning so a later edit can't re-introduce the conflation.
    expect(sharing).toMatch(/outcome:\s*n\s*>\s*0\s*\?\s*"changed"\s*:\s*"already"/);
  });

  it("NEW-3 · a half-landed share is reported loudly rather than patched quietly", () => {
    expect(sharing).toContain("mismatched");
    expect(finder).toMatch(/mismatched\s*>\s*0/);
    expect(finder).toMatch(/STILL shared/);   // the dangerous direction is named, not softened
  });
});

/* ─────────────────────────── NEW-3 · the group key ─────────────────────────── */

describe("NEW-3 — sharing groups by the same key as the rename and the client's groupOf()", () => {
  const sql = read("../src/workspaces/site-planner/db/team_share_state.sql");
  const sqlCode = code("../src/workspaces/site-planner/db/team_share_state.sql");

  it("both RPCs key on data->>'groupId', never on the drifting group_id COLUMN", () => {
    // db/rename_site_group.sql exists BECAUSE that column drifts from the jsonb, and drift is real
    // in production today (row 'e2e-fixture-testfit': group_id 'e2e-fixture' vs jsonb
    // 'e2e-fixture-testfit'). A share keyed on the column selects the wrong set of plans — missing
    // one leaves a project partly shared, or on unshare leaves a collaborator with access.
    const bodies = sql.split(/create or replace function/).slice(1);
    expect(bodies.length).toBe(2);                       // set_project_team + set_project_team_state
    for (const b of bodies) {
      expect(b).toMatch(/coalesce\(data->>'groupId', id\)/);
      expect(b).not.toMatch(/coalesce\(group_id, id\)/); // the mutation this guards against
    }
  });

  it("the state RPC re-counts the group AFTER writing, so completeness is proven not assumed", () => {
    expect(sql).toMatch(/v_left/);
    expect(sql).toMatch(/'mismatched'/);
  });

  it("it still refuses to publish to a team you are not in (SECURITY DEFINER re-checks)", () => {
    expect(sql).toMatch(/is_team_member\(p_team_id\)/);
    expect(sql).toMatch(/security definer/);
  });

  it("and it never widens the write path: the intent flag is still transaction-local", () => {
    expect(sql).toMatch(/set_config\('planyr\.share_intent', '1', true\)/);
  });
});
