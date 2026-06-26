import { describe, it, expect, beforeEach, vi } from "vitest";

// B480 — "Take over editing here" reconciles a cloud conflict IN PLACE instead of reloading (the reload
// bounced to the map AND re-entered the version race → the pointless take-over loop the owner hit). The
// load-bearing piece is fetchSiteForReconcile REFRESHING the per-tab optimistic-version token: a stale
// token is exactly what makes the next push a false "changed in another session" conflict, so refreshing
// it (then pushing the union) is what actually breaks the loop. Mock the supabase client so it runs
// without a network/config. (Hoisted holder — a vi.mock factory can't close over a normal top-level var.)
const h = vi.hoisted(() => ({ row: null }));
vi.mock("../src/workspaces/site-planner/lib/supabase.js", () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => h.row }) }) }) },
}));

import { fetchSiteForReconcile, _siteVersions } from "../src/workspaces/site-planner/lib/cloudSync.js";

describe("B480 — fetchSiteForReconcile refreshes the CAS version token (breaks the take-over loop)", () => {
  beforeEach(() => { for (const k of Object.keys(_siteVersions)) delete _siteVersions[k]; });

  it("sets siteVersions[id] to the cloud's CURRENT version and returns the stored model", async () => {
    h.row = { data: { data: { id: "s1", els: [{ id: "a", type: "building" }] }, version: 7 }, error: null };
    const model = await fetchSiteForReconcile("u1", "s1");
    expect(_siteVersions.s1).toBe(7);     // the stale token is refreshed → the very next push lands instead of false-conflicting
    expect(model.id).toBe("s1");
    expect(model.els.length).toBe(1);     // the cloud copy is returned so the caller can UNION it into the canvas
  });

  it("leaves the token untouched and returns null on a missing/absent row", async () => {
    _siteVersions.s2 = 3;
    h.row = { data: null, error: null };
    const model = await fetchSiteForReconcile("u1", "s2");
    expect(model).toBe(null);
    expect(_siteVersions.s2).toBe(3);     // unchanged — nothing to reconcile against
  });

  it("no-ops (null) without a uid or id (logged-out / no project)", async () => {
    h.row = { data: { data: { id: "x" }, version: 1 }, error: null };
    expect(await fetchSiteForReconcile(null, "s1")).toBe(null);
    expect(await fetchSiteForReconcile("u1", null)).toBe(null);
    expect(_siteVersions.s1).toBeUndefined();
  });
});
