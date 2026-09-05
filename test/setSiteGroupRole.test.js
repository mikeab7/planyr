import { describe, it, expect, beforeEach } from "vitest";
import { saveSite, loadSite, setSiteGroupRole } from "../src/workspaces/site-planner/lib/storage.js";

// B843792 (NEW-1) — "a site can be flipped from tracked to pursuit later without re-entering
// anything" is a required NEW-1 outcome, not a nice-to-have. setSiteGroupRole is the mechanism
// that makes it real, mirroring renameSiteGroup's own proven shape (same tests as
// test/storage.test.js's "renameSiteGroup" describe block, applied to role instead of name).
describe("setSiteGroupRole — flips role for the WHOLE site by group id OR any plan id", () => {
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

  it("flips role on every plan when given the group (anchor) id", async () => {
    saveSite({ id: "g1", groupId: "g1", site: "Old", name: "Concept A" }); // defaults to pursuit
    saveSite({ id: "p2", groupId: "g1", site: "Old", name: "Concept B" });
    const res = await setSiteGroupRole("g1", "tracked");
    expect(res.ok).toBe(true);
    expect(loadSite("g1").role).toBe("tracked");
    expect(loadSite("p2").role).toBe("tracked");
  });

  it("flips the WHOLE site when given a non-anchor plan id", async () => {
    saveSite({ id: "g1", groupId: "g1", site: "Old" });
    saveSite({ id: "p2", groupId: "g1", site: "Old" });
    await setSiteGroupRole("p2", "tracked");
    expect(loadSite("g1").role).toBe("tracked");
    expect(loadSite("p2").role).toBe("tracked");
  });

  it("flips back tracked → pursuit with no re-entry of any other field", async () => {
    saveSite({ id: "g1", groupId: "g1", site: "Keep", county: "harris", role: "tracked" });
    const before = loadSite("g1");
    await setSiteGroupRole("g1", "pursuit");
    const after = loadSite("g1");
    expect(after.role).toBe("pursuit");
    expect(after.site).toBe(before.site);
    expect(after.county).toBe(before.county);
  });

  it("is a harmless no-op (never throws) on an unknown id — mirrors renameSiteGroup's own precedent", async () => {
    await expect(setSiteGroupRole("ghost", "tracked")).resolves.toMatchObject({ ok: true, plans: 0 });
    expect(loadSite("ghost")).toBeNull();
  });

  it("refuses a bogus role without touching the site", async () => {
    saveSite({ id: "g1", groupId: "g1", site: "Keep", role: "pursuit" });
    const res = await setSiteGroupRole("g1", "nonsense");
    expect(res.ok).toBe(false);
    expect(loadSite("g1").role).toBe("pursuit");
  });

  it("never leaks a role flip across projects", async () => {
    saveSite({ id: "g1", groupId: "g1", site: "Alpha" });
    saveSite({ id: "g2", groupId: "g2", site: "Beta" });
    await setSiteGroupRole("g1", "tracked");
    expect(loadSite("g2").role).toBe("pursuit");
  });
});
