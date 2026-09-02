import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  recordCloudWriteFailure, readCloudWriteFailures, clearCloudWriteFailure, clearAllCloudWriteFailures,
  replayCloudWriteFailures,
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
describe("replayCloudWriteFailures — restores the ORIGINAL scope of a queued failure (B1048400/NEW-1)", () => {
  it("expands a groupId entry to EVERY live plan in the group — never just the group's own row", () => {
    const pushed = [];
    const pushLoud = (id, what) => pushed.push({ id, what });
    const loadPlansOfGroup = (groupId) => {
      expect(groupId).toBe("g1");
      return [{ id: "g1" }, { id: "p2" }, { id: "p3" }];
    };
    replayCloudWriteFailures([{ groupId: "g1", what: "The project rename" }], { loadPlansOfGroup, pushLoud });
    expect(pushed).toEqual([
      { id: "g1", what: "The project rename" },
      { id: "p2", what: "The project rename" },
      { id: "p3", what: "The project rename" },
    ]);
  });

  it("does NOT degrade to a single push for a groupId entry — the exact pre-fix shape", () => {
    const pushed = [];
    const pushLoud = (id, what) => pushed.push({ id, what });
    const loadPlansOfGroup = () => [{ id: "g1" }, { id: "p2" }, { id: "p3" }];
    replayCloudWriteFailures([{ groupId: "g1", what: "The project rename" }], { loadPlansOfGroup, pushLoud });
    expect(pushed.length).toBe(3);
    expect(pushed.length).not.toBe(1); // 1 is what the pre-fix `pushLoud(e.groupId, e.what)` produced
  });

  it("replays a siteId entry (a genuinely single-row action) against just that row", () => {
    const pushed = [];
    const pushLoud = (id, what) => pushed.push({ id, what });
    const loadPlansOfGroup = () => { throw new Error("must not be called for a single-row entry"); };
    replayCloudWriteFailures([{ siteId: "s1", what: "The new site" }], { loadPlansOfGroup, pushLoud });
    expect(pushed).toEqual([{ id: "s1", what: "The new site" }]);
  });

  it("replays every queued entry, mixed group-scoped and single-row", () => {
    const pushed = [];
    const pushLoud = (id, what) => pushed.push({ id, what });
    const loadPlansOfGroup = (g) => (g === "g1" ? [{ id: "g1" }, { id: "p2" }] : []);
    replayCloudWriteFailures(
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
    replayCloudWriteFailures([], { loadPlansOfGroup, pushLoud });
    replayCloudWriteFailures(undefined, { loadPlansOfGroup, pushLoud });
    expect(pushLoud).not.toHaveBeenCalled();
    expect(loadPlansOfGroup).not.toHaveBeenCalled();
  });
});

/* B1048400 (NEW-1) — the same proof, end to end against the REAL local store (storage.js), not a
 * mock: queue a failed group rename the way the production repro actually produced one, retry it,
 * and assert EVERY live row in the group carries the new name and the SAME stamp. A retry test
 * that only checks the active row is precisely the test that would have missed this. */
describe("replayCloudWriteFailures — end to end against the real local store (B1048400/NEW-1)", () => {
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
    replayCloudWriteFailures(pending, { loadPlansOfGroup, pushLoud });

    // EVERY live row in the group carries the new name and the SAME stamp — not just the one
    // the pre-fix bug happened to address (the group's own anchor id).
    for (const id of ["g1", "p2", "p3"]) {
      expect(cloud[id]).toBeTruthy();
      expect(cloud[id].site).toBe("ZZ-RENAME-TEST-E");
      expect(cloud[id].siteRenamedAt).toBe(stamp);
    }
  });
});
