import { describe, it, expect, beforeEach } from "vitest";
import {
  saveSite, loadSitesList, loadPlansOfGroup,
  renameSiteGroup, deleteSiteGroup,
} from "../src/workspaces/site-planner/lib/storage.js";

// B439 — the breadcrumb's per-project Rename/Delete acts on a whole site GROUP (a project = a
// Site Planner site group, possibly several plans). These lock the store layer behind it:
// renameSiteGroup relabels every plan; deleteSiteGroup removes every plan + reports an honest
// aggregate result. Logged out (no activeUser) the cloud step is a skipped no-op success.
//
// NOTE: storage.js keeps a module-level delete tombstone (B372 resurrection guard) that blocks
// re-saving a just-deleted id. That's correct app behavior, so each test uses UNIQUE ids to stay
// isolated rather than reusing the same id across deletes.
describe("site-group rename / delete (B439/B440)", () => {
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

  it("renameSiteGroup relabels EVERY plan in the group, leaving other groups untouched", () => {
    saveSite({ id: "r-p1", groupId: "r-g1", site: "Schiel Road", name: "Plan 1" });
    saveSite({ id: "r-p2", groupId: "r-g1", site: "Schiel Road", name: "Plan 2" });
    saveSite({ id: "r-p3", groupId: "r-g2", site: "JFK", name: "Plan 1" });

    renameSiteGroup("r-g1", "Schiel Road West");
    const g1 = loadPlansOfGroup("r-g1");
    expect(g1).toHaveLength(2);
    expect(g1.every((s) => s.site === "Schiel Road West")).toBe(true);
    expect(loadPlansOfGroup("r-g2")[0].site).toBe("JFK"); // other group unaffected
  });

  it("deleteSiteGroup removes every plan in the group and only that group", async () => {
    saveSite({ id: "d-p1", groupId: "d-g1", site: "Schiel Road", name: "Plan 1" });
    saveSite({ id: "d-p2", groupId: "d-g1", site: "Schiel Road", name: "Plan 2" });
    saveSite({ id: "d-p3", groupId: "d-g2", site: "JFK", name: "Plan 1" });

    const res = await deleteSiteGroup("d-g1");
    expect(res.ok).toBe(true);
    expect(res.removed).toBe(2);
    expect(loadPlansOfGroup("d-g1")).toHaveLength(0);
    expect(loadSitesList().map((s) => s.id)).toEqual(["d-p3"]); // the other project survives
  });

  it("deleting an unknown group is a clean no-op success (never a false failure)", async () => {
    saveSite({ id: "u-p1", groupId: "u-g1", site: "Schiel Road", name: "Plan 1" });

    const res = await deleteSiteGroup("nope-not-a-group");
    expect(res).toEqual({ ok: true, removed: 0 });
    expect(loadSitesList()).toHaveLength(1); // nothing touched
  });

  it("a single-plan group deletes cleanly too (the common case)", async () => {
    saveSite({ id: "s-p1", groupId: "s-g1", site: "Schiel Road", name: "Plan 1" });
    saveSite({ id: "s-p3", groupId: "s-g2", site: "JFK", name: "Plan 1" });

    const res = await deleteSiteGroup("s-g2");
    expect(res.ok).toBe(true);
    expect(res.removed).toBe(1);
    expect(loadPlansOfGroup("s-g2")).toHaveLength(0);
    expect(loadSitesList().map((s) => s.id)).toEqual(["s-p1"]);
  });
});
