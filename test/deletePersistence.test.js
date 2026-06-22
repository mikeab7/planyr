import { describe, it, expect, beforeEach } from "vitest";
import { saveSite, loadSite, deleteSite, clearRecentlyDeleted } from "../src/workspaces/site-planner/lib/storage.js";
import { interpretDelete } from "../src/workspaces/site-planner/lib/cloudSync.js";

// B366 — "a deleted site reappears". Two repro paths, ONE root cause: the site you delete from the
// map is still MOUNTED (hidden) in the planner; deleting it unmounts the planner, whose
// persist-on-leave / beforeunload flush then fires AFTER the delete and re-writes the row. It comes
// back mid-session (path B) and, because pullCloud's heal-the-split re-pushes any local-only site,
// it survives a reload too (path A). Every resurrection funnels through saveSite, so the guard lives
// there. Separately, the cloud delete was fire-and-forget with no error/row-count check, so a real
// failure looked like success — interpretDelete makes that distinguishable + loud.

const bld = (id) => ({ id, type: "building", cx: 0, cy: 0, w: 100, h: 100 });

function mockLocalStorage() {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    key: (i) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length; },
  };
}

describe("interpretDelete — a delete that removed nothing is distinguishable from one that did (B366)", () => {
  it("a real error → ok:false (the caller surfaces it loudly; the row may survive server-side)", () => {
    const r = interpretDelete(null, { message: "permission denied" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/permission denied/);
  });
  it("0 rows removed → ok:true but removed:0 (already gone / ownership mismatch — absence still holds, not an alarm)", () => {
    expect(interpretDelete([], null)).toEqual({ ok: true, removed: 0 });
  });
  it("a removed row → ok:true with the count", () => {
    expect(interpretDelete([{ id: "s1" }], null)).toEqual({ ok: true, removed: 1 });
  });
  it("non-array data (a client that didn't return rows) → removed:0, still ok", () => {
    expect(interpretDelete(null, null)).toEqual({ ok: true, removed: 0 });
  });
});

describe("delete is durable — a late flush can't resurrect a just-deleted site (B366)", () => {
  beforeEach(() => { mockLocalStorage(); clearRecentlyDeleted(); });

  it("saveSite refuses to re-create a site deleted in this tab (the unmount-flush resurrection)", () => {
    saveSite({ id: "s", site: "HOLLISTER", els: [bld("a")] });
    expect(loadSite("s")).toBeTruthy();
    deleteSite("s");                                   // user deletes it
    expect(loadSite("s")).toBeNull();
    // the unmounting planner's persist-on-leave fires AFTER the delete with the stale live state:
    saveSite({ id: "s", site: "HOLLISTER", els: [bld("a")] });
    expect(loadSite("s")).toBeNull();                  // stays deleted — NOT resurrected
  });

  it("does NOT block a normal edit-save of a still-existing site (guard is not over-eager)", () => {
    saveSite({ id: "s", els: [bld("a")] });
    saveSite({ id: "s", els: [bld("a"), bld("b")] }); // ordinary edit
    expect(loadSite("s").els.length).toBe(2);
  });

  it("does NOT block creating a DIFFERENT new site after a delete", () => {
    saveSite({ id: "s", els: [bld("a")] });
    deleteSite("s");
    saveSite({ id: "s2", els: [bld("c")] });          // brand-new, different id
    expect(loadSite("s2")).toBeTruthy();
  });

  it("clearRecentlyDeleted re-allows a deliberate re-create of the same id (re-import)", () => {
    saveSite({ id: "s", els: [bld("a")] });
    deleteSite("s");
    clearRecentlyDeleted("s");
    saveSite({ id: "s", els: [bld("a")] });
    expect(loadSite("s")).toBeTruthy();
  });

  it("deleteSite resolves ok when logged out (nothing to remove server-side)", async () => {
    saveSite({ id: "s", els: [bld("a")] });
    const r = await deleteSite("s");
    expect(r.ok).toBe(true);
  });
});
