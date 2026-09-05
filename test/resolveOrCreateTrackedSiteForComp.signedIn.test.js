import { describe, it, expect, beforeEach, vi } from "vitest";

/* B1165441-HARDENING (NEW-3, adversarial review of PR 1431) — the SIGNED-IN half of
 * resolveOrCreateTrackedSiteForComp, which test/storage.test.js's own describe block for this
 * function deliberately runs SIGNED OUT (so the cloud push is trivially skipped and never
 * exercises this bug).
 *
 * NEW-3 — a failed background push used to be swallowed, and the function still handed back a
 * project_id for a site that only exists in this browser's localStorage. comps.project_id has a
 * NOT DEFERRABLE foreign key, so that id fails the comp insert at the database with a raw
 * constraint error. Proven here: a push failure now returns `groupId: null` (never a phantom id)
 * while still keeping the local tracked-site row (nothing already-typed is lost).
 *
 * A companion "reconcile the local cache against the cloud before matching" fix was proposed
 * (NEW-4) and REJECTED after re-measurement — the premise (5 of 63 cloud sites "missing" from the
 * cache) was an un-scoped count against the whole `public.sites` table that included OTHER
 * accounts' rows; the owner's own account cache genuinely held everything it should. See
 * resolveOrCreateTrackedSiteForComp's own header in storage.js for the record. No test for it here
 * on purpose — there is nothing to prove.
 *
 * Mocks cloudSync.js directly (the module boundary storage.js actually calls through) rather than
 * supabase.js — storage.js's other signed-in write paths (pushSiteToCloud → cloudUpsert,
 * binOrphanedTrackedSite → cloudDelete) go through the same seam, so one mock covers all of it
 * without needing a full chainable Supabase query-builder stub.
 */
const h = vi.hoisted(() => ({
  cloudListResult: [],
  cloudDeletedRowsResult: { ok: true, supported: true, rows: [] },
  cloudUpsertResult: { ok: true },
  cloudDeleteResult: { ok: true, removed: 1 },
}));
vi.mock("../src/workspaces/site-planner/lib/cloudSync.js", () => ({
  cloudList: vi.fn(async () => h.cloudListResult),
  cloudDeletedRows: vi.fn(async () => h.cloudDeletedRowsResult),
  cloudUpsert: vi.fn(async () => h.cloudUpsertResult),
  cloudDelete: vi.fn(async () => h.cloudDeleteResult),
  cloudHardDelete: vi.fn(async () => ({ ok: true, removed: 1 })),
  cloudRestore: vi.fn(async () => ({ ok: true, restored: 1 })),
  cloudCheckDeleted: vi.fn(async () => ({ ok: true, exists: false, deleted: false })),
  clearSiteVersions: vi.fn(),
  keepaliveCloudPush: vi.fn(),
  fetchSiteForReconcile: vi.fn(async () => null),
}));
vi.mock("../src/shared/telemetry/clientErrors.js", () => ({ reportClientEvent: vi.fn() }));

import { resolveOrCreateTrackedSiteForComp, binOrphanedTrackedSite, loadSite, loadSitesList, setActiveUser } from "../src/workspaces/site-planner/lib/storage.js";
import { cloudUpsert, cloudDelete } from "../src/workspaces/site-planner/lib/cloudSync.js";

describe("resolveOrCreateTrackedSiteForComp — signed in (NEW-3)", () => {
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
    h.cloudListResult = [];
    h.cloudDeletedRowsResult = { ok: true, supported: true, rows: [] };
    h.cloudUpsertResult = { ok: true };
    h.cloudDeleteResult = { ok: true, removed: 1 };
    vi.clearAllMocks();
    setActiveUser("u-throwaway");
  });

  it("NEW-3: a tracked site that fails to reach the cloud is never handed back as a project_id (the comp saves unattached, not against a phantom id)", async () => {
    h.cloudUpsertResult = { ok: false, error: "network down" };
    const r = await resolveOrCreateTrackedSiteForComp({ title: "Unreachable Property", lat: 33, lon: -97 });
    expect(r.groupId).toBeNull();
    expect(r.created).toBe(false);
    expect(typeof r.error).toBe("string");
    expect(cloudUpsert).toHaveBeenCalled(); // the push really was attempted
    // The local write is NOT lost — it still mirrors on the next edit/reload, same as any other
    // site write; only the comp's LINK to it is withheld until it's provably real.
    const local = loadSitesList().find((s) => s.site === "Unreachable Property");
    expect(local).toBeTruthy();
    expect(local.role).toBe("tracked");
  });

  it("NEW-3: a tracked site whose cloud push succeeds is returned normally", async () => {
    const r = await resolveOrCreateTrackedSiteForComp({ title: "Reachable Property", lat: 34, lon: -98 });
    expect(r.groupId).toMatch(/^trk/);
    expect(r.created).toBe(true);
    expect(loadSite(r.groupId).site).toBe("Reachable Property");
  });
});

describe("binOrphanedTrackedSite — NEW-5 (adversarial review of PR 1431)", () => {
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
    h.cloudListResult = [];
    h.cloudDeletedRowsResult = { ok: true, supported: true, rows: [] };
    h.cloudUpsertResult = { ok: true };
    h.cloudDeleteResult = { ok: true, removed: 1 };
    vi.clearAllMocks();
    setActiveUser("u-throwaway");
  });

  it("bins a genuinely empty 'tracked' site", async () => {
    const r = await resolveOrCreateTrackedSiteForComp({ title: "Orphaned Property", lat: 1, lon: 1 });
    const out = await binOrphanedTrackedSite(r.groupId);
    expect(out.skipped).toBeFalsy();
    expect(cloudDelete).toHaveBeenCalledWith("u-throwaway", r.groupId);
  });

  it("refuses a site whose role is no longer 'tracked' — an owner who flipped it to pursuit opted out", async () => {
    const r = await resolveOrCreateTrackedSiteForComp({ title: "Now Pursuing", lat: 2, lon: 2 });
    const { setSiteGroupRole } = await import("../src/workspaces/site-planner/lib/storage.js");
    await setSiteGroupRole(r.groupId, "pursuit");
    const out = await binOrphanedTrackedSite(r.groupId);
    expect(out.skipped).toBe(true);
    expect(cloudDelete).not.toHaveBeenCalled();
  });

  it("refuses a site that isn't genuinely empty — real content is never binned out from under someone", async () => {
    const r = await resolveOrCreateTrackedSiteForComp({ title: "Grew Into A Plan", lat: 3, lon: 3 });
    const { saveSite } = await import("../src/workspaces/site-planner/lib/storage.js");
    saveSite({ id: r.groupId, els: [{ id: "b1", type: "building", cx: 0, cy: 0, w: 100, h: 100 }] });
    const out = await binOrphanedTrackedSite(r.groupId);
    expect(out.skipped).toBe(true);
    expect(cloudDelete).not.toHaveBeenCalled();
  });

  it("no-ops for an id this device never hydrated locally, rather than reaching for a network read", async () => {
    const out = await binOrphanedTrackedSite("trk-never-seen-here");
    expect(out.skipped).toBe(true);
    expect(cloudDelete).not.toHaveBeenCalled();
  });
});
