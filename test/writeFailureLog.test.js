import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  recordCloudWriteFailure, readCloudWriteFailures, clearCloudWriteFailure, clearAllCloudWriteFailures,
  replayCloudWriteFailures, retryCloudWriteFailures, inferEntryKind, PRE_FIX_RETRY, WHAT_RENAME, WHAT_STATUS, WHAT_DATES,
} from "../src/shared/cloud/writeFailureLog.js";
import { saveSite, loadSite, loadPlansOfGroup, renameSiteGroup } from "../src/workspaces/site-planner/lib/storage.js";

function fakeWindow() {
  const store = {};
  return {
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
  };
}

describe("writeFailureLog — durable record round trip", () => {
  it("records, reads back, and clears one failure", () => {
    const win = fakeWindow();
    expect(readCloudWriteFailures(win)).toEqual([]);
    const entry = recordCloudWriteFailure({ what: "The project rename", groupId: "g1", error: "boom" }, win);
    expect(entry.what).toBe("The project rename");
    expect(readCloudWriteFailures(win)).toHaveLength(1);
    clearCloudWriteFailure(entry.id, win);
    expect(readCloudWriteFailures(win)).toEqual([]);
  });

  it("clearAllCloudWriteFailures empties the whole log", () => {
    const win = fakeWindow();
    recordCloudWriteFailure({ what: "a", siteId: "s1" }, win);
    recordCloudWriteFailure({ what: "b", siteId: "s2" }, win);
    clearAllCloudWriteFailures(win);
    expect(readCloudWriteFailures(win)).toEqual([]);
  });
});

/* B1048400 (NEW-1) — production repro: a tab left open across a deploy fails a project rename,
 * showing the write-failure banner with "Retry now"; clicking it wrote exactly ONE row in
 * `public.sites` (the group's own id) while every other live plan in the group kept the old
 * name — and the banner, triangle and Cloud-sync badge ALL cleared as though the whole group had
 * synced. Root cause: the durable-failure queue (`writeFailureLog.js`) is GENERIC over every kind
 * of background push failure `SitePlannerApp.jsx` can queue (rename/status/new-site), and its
 * drain-on-boot replay treated a GROUP-scoped entry (a rename or a status change, recorded with
 * `groupId`) exactly like a single-row entry (`siteId`) — pushing just the group id's own row.
 *
 * This is the regression proof: it fails red against the pre-fix shape
 * (`if (e.groupId) pushLoud(e.groupId, e.what)`, one push, addressed at the group id) and green
 * against the fix (one push per LIVE plan `loadPlansOfGroup` currently returns for that group). */
describe("PRE_FIX_RETRY — restores the ORIGINAL scope of a queued failure (B1048400/NEW-1)", () => {
  it("expands a groupId entry to EVERY live plan in the group — never just the group's own row", () => {
    const pushed = [];
    const pushLoud = (id, what) => pushed.push({ id, what });
    const loadPlansOfGroup = (groupId) => {
      expect(groupId).toBe("g1");
      return [{ id: "g1" }, { id: "p2" }, { id: "p3" }];
    };
    PRE_FIX_RETRY([{ groupId: "g1", what: "The project rename" }], { loadPlansOfGroup, pushLoud });
    expect(pushed).toEqual([
      { id: "g1", what: "The project rename" },
      { id: "p2", what: "The project rename" },
      { id: "p3", what: "The project rename" },
    ]);
  });

  it("does NOT degrade to a single push for a groupId entry — the exact pre-B1048400 shape", () => {
    const pushed = [];
    const pushLoud = (id, what) => pushed.push({ id, what });
    const loadPlansOfGroup = () => [{ id: "g1" }, { id: "p2" }, { id: "p3" }];
    PRE_FIX_RETRY([{ groupId: "g1", what: "The project rename" }], { loadPlansOfGroup, pushLoud });
    expect(pushed.length).toBe(3);
    expect(pushed.length).not.toBe(1); // 1 is what the pre-B1048400 `pushLoud(e.groupId, e.what)` produced
  });

  it("replays a siteId entry (a genuinely single-row action) against just that row", () => {
    const pushed = [];
    const pushLoud = (id, what) => pushed.push({ id, what });
    const loadPlansOfGroup = () => { throw new Error("must not be called for a single-row entry"); };
    PRE_FIX_RETRY([{ siteId: "s1", what: "The new site" }], { loadPlansOfGroup, pushLoud });
    expect(pushed).toEqual([{ id: "s1", what: "The new site" }]);
  });

  it("replays every queued entry, mixed group-scoped and single-row", () => {
    const pushed = [];
    const pushLoud = (id, what) => pushed.push({ id, what });
    const loadPlansOfGroup = (g) => (g === "g1" ? [{ id: "g1" }, { id: "p2" }] : []);
    PRE_FIX_RETRY(
      [{ groupId: "g1", what: "The project rename" }, { siteId: "s9", what: "The new plan" }],
      { loadPlansOfGroup, pushLoud },
    );
    expect(pushed).toEqual([
      { id: "g1", what: "The project rename" },
      { id: "p2", what: "The project rename" },
      { id: "s9", what: "The new plan" },
    ]);
  });

  it("is a no-op on an empty or missing queue", () => {
    const pushLoud = vi.fn();
    const loadPlansOfGroup = vi.fn();
    PRE_FIX_RETRY([], { loadPlansOfGroup, pushLoud });
    PRE_FIX_RETRY(undefined, { loadPlansOfGroup, pushLoud });
    expect(pushLoud).not.toHaveBeenCalled();
    expect(loadPlansOfGroup).not.toHaveBeenCalled();
  });
});

/* B1048400 (NEW-1) — the same proof, end to end against the REAL local store (storage.js), not a
 * mock: queue a failed group rename the way the production repro actually produced one, retry it,
 * and assert EVERY live row in the group carries the new name and the SAME stamp. A retry test
 * that only checks the active row is precisely the test that would have missed this. */
describe("PRE_FIX_RETRY — end to end against the real local store (B1048400/NEW-1)", () => {
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

  it("a queued group-rename failure replays against every live plan, matching name AND stamp", async () => {
    // Three plans in one project — the exact shape of the production repro (smtjb0lrexb3 /
    // smtjb115rzjl / smtjb1gkb1fr). The local (device) half of a rename always lands regardless
    // of the cloud outcome, so all three already carry the new name+stamp before the queued
    // failure is ever replayed — that's what the replay is supposed to fan back out to the cloud.
    saveSite({ id: "g1", groupId: "g1", site: "Old" });
    saveSite({ id: "p2", groupId: "g1", site: "Old" });
    saveSite({ id: "p3", groupId: "g1", site: "Old" });
    await renameSiteGroup("g1", "ZZ-RENAME-TEST-E"); // logged out here — cloud.skipped, local lands
    const stamp = loadSite("g1").siteRenamedAt;
    expect(loadSite("p2").siteRenamedAt).toBe(stamp);
    expect(loadSite("p3").siteRenamedAt).toBe(stamp);

    // The production failure: the cloud push for this rename failed and was queued durably.
    recordCloudWriteFailure({ what: "The project rename", groupId: "g1", error: "chunk load failed" }, globalThis);
    const pending = readCloudWriteFailures(globalThis);
    expect(pending).toHaveLength(1);

    // The retry — a fake "cloud" standing in for pushSiteToCloud, keyed by plan id.
    const cloud = {};
    const pushLoud = (id) => { const s = loadSite(id); cloud[id] = { site: s.site, siteRenamedAt: s.siteRenamedAt }; };
    clearAllCloudWriteFailures(globalThis);
    PRE_FIX_RETRY(pending, { loadPlansOfGroup, pushLoud });

    // EVERY live row in the group carries the new name and the SAME stamp — not just the one
    // the pre-fix bug happened to address (the group's own anchor id).
    for (const id of ["g1", "p2", "p3"]) {
      expect(cloud[id]).toBeTruthy();
      expect(cloud[id].site).toBe("ZZ-RENAME-TEST-E");
      expect(cloud[id].siteRenamedAt).toBe(stamp);
    }
  });
});

/* NEW-1 (B1204736) — the retry path was itself weaker than the rename path it exists to recover:
 * a "Retry now" replayed a queued group rename as N separate cloud writes (the exact shape
 * PRE_FIX_RETRY below still is) instead of the ONE atomic `rename_site_group` statement the live
 * rename path uses, and the durable log was cleared BEFORE a single row landed. Everything below
 * proves the fix: kind inference, atomic-first replay with an honest per-kind fallback, and a log
 * that outlives the write. */

describe("inferEntryKind — recovers a write's shape, never by guessing (B1204736/NEW-1)", () => {
  it("an explicit kind on the entry wins outright, whatever its shape or label say", () => {
    expect(inferEntryKind({ kind: "rename", groupId: "g1", what: WHAT_STATUS })).toBe("rename");
    expect(inferEntryKind({ kind: "status", siteId: "s1", what: WHAT_RENAME })).toBe("status");
    expect(inferEntryKind({ kind: "row", groupId: "g1", what: WHAT_RENAME })).toBe("row");
  });

  it("a legacy (no-kind) groupId entry infers from an EXACT what match — and refuses to guess on anything else", () => {
    expect(inferEntryKind({ groupId: "g1", what: WHAT_RENAME })).toBe("rename");
    expect(inferEntryKind({ groupId: "g1", what: WHAT_STATUS })).toBe("status");
    expect(inferEntryKind({ groupId: "g1", what: WHAT_DATES })).toBe("dates"); // B1161793 (NEW-2)
    // Never fuzzy: an unrecognized label on a group-scoped entry falls to the generic fan-out
    // rather than being guessed as a rename or a status change.
    expect(inferEntryKind({ groupId: "g1", what: "Some other group write" })).toBe("row");
    expect(inferEntryKind({ groupId: "g1", what: "The project rename " })).toBe("row"); // not an exact match
  });

  it("a siteId entry is always a genuinely single-row action, even if its label matches a group constant", () => {
    expect(inferEntryKind({ siteId: "s1", what: WHAT_RENAME })).toBe("row");
    expect(inferEntryKind({ siteId: "s1", what: WHAT_STATUS })).toBe("row");
  });
});

describe("replayCloudWriteFailures — atomic-first with an honest per-kind fallback (B1204736/NEW-1)", () => {
  it("a rename entry with an atomic groupWrite adapter never touches the generic fan-out", async () => {
    const loadPlansOfGroup = vi.fn();
    const pushLoud = vi.fn();
    const groupWrite = vi.fn(async (_e, kind) => (kind === "rename" ? { handled: true, ok: true } : { handled: false }));
    const results = await replayCloudWriteFailures(
      [{ id: "e1", kind: "rename", groupId: "g1", what: WHAT_RENAME }],
      { loadPlansOfGroup, pushLoud, groupWrite },
    );
    expect(results).toEqual([{ entry: { id: "e1", kind: "rename", groupId: "g1", what: WHAT_RENAME }, ok: true }]);
    expect(loadPlansOfGroup).not.toHaveBeenCalled();
    expect(pushLoud).not.toHaveBeenCalled();
  });

  it("an atomic groupWrite failure OWNS the outcome — it is never retried through the non-atomic fan-out", async () => {
    const loadPlansOfGroup = vi.fn(() => [{ id: "g1" }, { id: "p2" }]);
    const pushLoud = vi.fn(async () => true);
    const groupWrite = vi.fn(async () => ({ handled: true, ok: false }));
    const results = await replayCloudWriteFailures(
      [{ id: "e1", kind: "rename", groupId: "g1", what: WHAT_RENAME }],
      { loadPlansOfGroup, pushLoud, groupWrite },
    );
    expect(results[0].ok).toBe(false);
    expect(loadPlansOfGroup).not.toHaveBeenCalled();
    expect(pushLoud).not.toHaveBeenCalled();
  });

  it("a status entry's honest { handled:false } falls through to the fan-out and succeeds only when EVERY plan confirms", async () => {
    const loadPlansOfGroup = vi.fn(() => [{ id: "g1" }, { id: "p2" }, { id: "p3" }]);
    const pushLoud = vi.fn(async () => true);
    const groupWrite = vi.fn(async () => ({ handled: false })); // no group RPC exists for a status change
    const results = await replayCloudWriteFailures(
      [{ id: "e1", kind: "status", groupId: "g1", what: WHAT_STATUS }],
      { loadPlansOfGroup, pushLoud, groupWrite },
    );
    expect(results[0].ok).toBe(true);
    expect(pushLoud).toHaveBeenCalledTimes(3);
  });

  it("the fan-out reports ok:false when even ONE plan in the group fails to confirm — never a false success", async () => {
    const loadPlansOfGroup = () => [{ id: "g1" }, { id: "p2" }, { id: "p3" }];
    const pushLoud = vi.fn(async (id) => id !== "p3"); // p3 never confirms
    const results = await replayCloudWriteFailures(
      [{ id: "e1", kind: "status", groupId: "g1", what: WHAT_STATUS }],
      { loadPlansOfGroup, pushLoud },
    );
    expect(results[0].ok).toBe(false);
  });

  it("a groupId entry with no live plans is refused, never reported as a vacuous success", async () => {
    const loadPlansOfGroup = () => [];
    const pushLoud = vi.fn();
    const results = await replayCloudWriteFailures([{ id: "e1", groupId: "ghost", what: WHAT_STATUS }], { loadPlansOfGroup, pushLoud });
    expect(results[0].ok).toBe(false);
    expect(pushLoud).not.toHaveBeenCalled();
  });

  it("a bare siteId entry (a genuinely single-row action) makes exactly one pushLoud call and mirrors its outcome", async () => {
    const okPush = vi.fn(async () => true);
    const okResults = await replayCloudWriteFailures([{ id: "e1", siteId: "s1", what: "The new site" }], { pushLoud: okPush });
    expect(okResults[0].ok).toBe(true);
    expect(okPush).toHaveBeenCalledTimes(1);
    expect(okPush).toHaveBeenCalledWith("s1", "The new site");

    const failPush = vi.fn(async () => false);
    const failResults = await replayCloudWriteFailures([{ id: "e2", siteId: "s2", what: "The new site" }], { pushLoud: failPush });
    expect(failResults[0].ok).toBe(false);
  });
});

describe("retryCloudWriteFailures — the log outlives the write (B1204736/NEW-1)", () => {
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

  it("clears only the CONFIRMED entries and returns the rest as remaining", async () => {
    const confirmed = recordCloudWriteFailure({ what: WHAT_RENAME, kind: "rename", groupId: "g1" }, globalThis);
    const stuck = recordCloudWriteFailure({ what: WHAT_STATUS, kind: "status", groupId: "g2" }, globalThis);
    const pending = readCloudWriteFailures(globalThis);
    const groupWrite = async (_e, kind) => (kind === "rename" ? { handled: true, ok: true } : { handled: false });
    const loadPlansOfGroup = () => [{ id: "g2" }];
    const pushLoud = async () => false; // the status entry's one plan never confirms
    const { cleared, remaining } = await retryCloudWriteFailures(pending, { loadPlansOfGroup, pushLoud, groupWrite }, globalThis);
    expect(cleared).toBe(1);
    expect(remaining.map((e) => e.id)).toEqual([stuck.id]);
    const left = readCloudWriteFailures(globalThis);
    expect(left).toHaveLength(1);
    expect(left[0].id).toBe(stuck.id);
    expect(left.some((e) => e.id === confirmed.id)).toBe(false);
  });

  it("a retry that confirms NOTHING leaves the durable log completely UNTOUCHED — the direct fix for clearing before a row lands", async () => {
    recordCloudWriteFailure({ what: WHAT_RENAME, kind: "rename", groupId: "g1" }, globalThis);
    const before = readCloudWriteFailures(globalThis);
    const groupWrite = async () => ({ handled: true, ok: false }); // the atomic write itself failed
    const { cleared, remaining } = await retryCloudWriteFailures(before, { loadPlansOfGroup, pushLoud: () => false, groupWrite }, globalThis);
    expect(cleared).toBe(0);
    expect(remaining).toHaveLength(1);
    const after = readCloudWriteFailures(globalThis);
    expect(after).toEqual(before); // nothing was forgotten
  });
});

/* B1204736 (NEW-1) — the core case: a fake `public.sites` table + a fake ONE-STATEMENT group RPC
 * (atomic by construction — it applies every matching row in a single pass) + a killable per-row
 * transport standing in for the OLD retry's fan-out. Interrupting the row transport after its
 * first write proves the atomic path never touches it at all, and that every row in the group
 * ends up sharing one name AND one `updated_at` — never a partial rename. */
function makeFakeSites() {
  return {
    g1: { id: "g1", groupId: "g1", name: "Old", updated_at: 0 },
    p2: { id: "p2", groupId: "g1", name: "Old", updated_at: 0 },
    p3: { id: "p3", groupId: "g1", name: "Old", updated_at: 0 },
  };
}
// The real `rename_site_group` RPC (db/rename_site_group.sql) is one `update … where` statement —
// Postgres applies it atomically, so this fake mirrors that as a single, uninterruptible pass.
function makeFakeGroupRenameRpc(sites) {
  return async (groupId, name, at) => {
    for (const row of Object.values(sites)) if (row.groupId === groupId) { row.name = name; row.updated_at = at; }
    return { ok: true };
  };
}
// Stands in for the OLD fan-out's per-row cloud push (SitePlannerApp's `pushLoud`): the Nth+1 call
// never lands — modeling a chunk failure / tab reload cutting the fan-out off mid-flight.
function makeKillableRowTransport(sites, killAfter) {
  let calls = 0;
  const fn = async (id, name, at) => {
    calls += 1;
    if (calls > killAfter) return false;
    if (sites[id]) { sites[id].name = name; sites[id].updated_at = at; }
    return true;
  };
  return { fn, callCount: () => calls };
}

describe("retryCloudWriteFailures — the core case: atomic replay never falls back to a killable row transport (B1204736/NEW-1)", () => {
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

  it("every row lands the SAME name and the SAME updated_at, and the killable transport is never called", async () => {
    const sites = makeFakeSites();
    const rpc = makeFakeGroupRenameRpc(sites);
    const { fn: pushLoud, callCount } = makeKillableRowTransport(sites, 1); // would kill any 2nd+ row write
    const entry = recordCloudWriteFailure({ what: WHAT_RENAME, kind: "rename", groupId: "g1" }, globalThis);
    const groupWrite = async (e, kind) => {
      if (kind !== "rename") return { handled: false };
      const res = await rpc(e.groupId, "NewName", 12345);
      return { handled: true, ok: !!res.ok };
    };
    const { cleared, remaining } = await retryCloudWriteFailures(
      readCloudWriteFailures(globalThis), { loadPlansOfGroup: () => Object.values(sites), pushLoud, groupWrite }, globalThis,
    );
    expect(cleared).toBe(1);
    expect(remaining).toHaveLength(0);
    expect(callCount()).toBe(0); // the row transport was never touched — the atomic path handled it whole
    const names = Object.values(sites).map((s) => s.name);
    const stamps = Object.values(sites).map((s) => s.updated_at);
    expect(new Set(names)).toEqual(new Set(["NewName"]));
    expect(new Set(stamps)).toEqual(new Set([12345]));
    expect(readCloudWriteFailures(globalThis)).toHaveLength(0);
    expect(entry.id).toBeTruthy();
  });
});

/* PRE_FIX_RETRY — the shipped B1048400 fan-out, kept verbatim so the regression it left behind
 * stays provable forever. These two control tests demonstrate the shape the fix above replaces;
 * they are proof of the BUG, not of the fix, and PRE_FIX_RETRY must never be called from the app. */
describe("PRE_FIX_RETRY — the shipped pre-fix body, kept as a live regression control (B1204736/NEW-1)", () => {
  it("an interrupted fan-out leaves the group PARTLY renamed — the exact production recurrence", async () => {
    const sites = makeFakeSites();
    const { fn: pushLoud, callCount } = makeKillableRowTransport(sites, 1); // only the 1st write lands
    PRE_FIX_RETRY([{ groupId: "g1", what: WHAT_RENAME }], { loadPlansOfGroup: () => Object.values(sites), pushLoud });
    // PRE_FIX_RETRY fires every push without awaiting any of them — flush the microtask queue so
    // those in-flight (fire-and-forget) promises get a chance to settle before asserting on them.
    await new Promise((r) => setTimeout(r, 0));
    expect(callCount()).toBe(3); // it DID fire all three — it just never checked or waited for the outcome
    const names = new Set(Object.values(sites).map((s) => s.name));
    expect(names.size).toBeGreaterThan(1); // NOT every row agrees — a partial rename, proven
  });

  it("PRE_FIX_RETRY returns before any write is confirmed — the reason clearing the log first was unsafe", () => {
    const sites = makeFakeSites();
    const pushLoud = () => new Promise(() => {}); // never settles in this test
    const ret = PRE_FIX_RETRY([{ groupId: "g1", what: WHAT_RENAME }], { loadPlansOfGroup: () => Object.values(sites), pushLoud });
    expect(ret).toBeUndefined(); // nothing to await — the old caller had no way to know it wasn't done
    expect(Object.values(sites).every((s) => s.name === "Old")).toBe(true); // no write has landed yet
  });
});
