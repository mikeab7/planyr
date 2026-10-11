/* NEW-1 (B217540 ×3 / B1317824 ×3) — the per-edit whole-store work is gone, and the shared-read contract that makes that safe is held.
 *   (1) saveSite/loadSite read SHARED plan objects, so NOTHING may mutate a stored record in place: the whole store is deep-frozen
 *       and every shared reader is run against it (a mutation throws in strict mode — loud, never a silent cache corruption).
 *   (2) the incremental serialiser is BYTE-IDENTICAL to JSON.stringify of the same map.
 *   (3) a save no longer parses the store, a second save no longer stringifies the unchanged plans, and the settle tick can tell
 *       the mirror's write is already there — but only while the bytes are untouched.
 *   (4) the light project-summary read parses once per distinct store string. */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { saveSite, loadSite, siteExistsLocally, readBackSite, sitesWriteStamp, sitesWriteStillCurrent } from "../src/workspaces/site-planner/lib/storage.js";
import { loadSiteSummaries } from "../src/workspaces/site-planner/lib/siteListLight.js";

const KEY = "planarfit:sites:v1";
const bld = (id, cx = 0) => ({ id, type: "building", cx, cy: 0, w: 100, h: 100, rot: 0 });
const deep = (o) => { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deep(o[k]); } return o; };

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

function seed(n = 6) {
  for (let i = 0; i < n; i++) saveSite({ id: `p${i}`, groupId: `g${i % 2}`, site: `Site ${i % 2}`, name: `Plan ${i}`, els: [bld(`b${i}a`), bld(`b${i}b`, 200)] });
}

describe("shared reads are read-only — proven against a deep-frozen store", () => {
  it("saveSite, loadSite, siteExistsLocally and readBackSite do not mutate what they read", () => {
    seed();
    // Reach the very objects the cache holds: a read right after a write returns the cached map; freeze THROUGH it.
    const stored = JSON.parse(localStorage.getItem(KEY));
    // Re-seat the store so the next shared read is a PARSE (the object graph the cache will hold), then freeze that graph via the reader itself.
    localStorage.setItem(KEY, JSON.stringify(stored));
    expect(siteExistsLocally("p1")).toBe(true);                       // parses + remembers
    const w = sitesWriteStamp();
    expect(w).toBeTruthy();
    deep(w.obj);                                                      // every plan object the cache will now hand out is frozen
    // none of these may throw (strict-mode ESM: a write to a frozen object throws)
    expect(() => loadSite("p1")).not.toThrow();
    expect(() => readBackSite("p2")).not.toThrow();
    expect(() => saveSite({ id: "p1", els: [bld("b1a"), bld("b1b", 200), bld("new", 400)] })).not.toThrow();
    expect(loadSite("p1").els.map((e) => e.id)).toEqual(["b1a", "b1b", "new"]);
    expect(() => saveSite({ id: "p9", groupId: "g1", site: "Site 1", name: "Plan 9", els: [bld("z")] })).not.toThrow();   // a brand-new plan beside frozen ones
    expect(JSON.parse(localStorage.getItem(KEY)).p0.els.length).toBe(2);   // the untouched plans are intact
  });
  it("loadSite hands back a PRIVATE copy — mutating it cannot reach the store or the next read", () => {
    seed();
    const a = loadSite("p0");
    a.els.push(bld("rogue")); a.name = "mutated";
    const b = loadSite("p0");
    expect(b.els.map((e) => e.id)).toEqual(["b0a", "b0b"]);
    expect(b.name).toBe("Plan 0");
    expect(JSON.parse(localStorage.getItem(KEY)).p0.name).toBe("Plan 0");
  });
});

describe("the incremental serialiser is byte-identical to JSON.stringify", () => {
  it("the string written to the device is exactly JSON.stringify of the stored map, across edits to one plan", () => {
    seed(8);
    for (let k = 0; k < 4; k++) {
      saveSite({ id: "p3", els: [bld("b3a", k * 30), bld("b3b", 200), ...(k % 2 ? [bld("x")] : [])] });
      const s = localStorage.getItem(KEY);
      expect(s).toBe(JSON.stringify(JSON.parse(s)));
    }
  });
});

describe("what one edit costs the store", () => {
  it("a save parses the store AT MOST once cold and NEVER when it is untouched since the last write", () => {
    seed(8);
    saveSite({ id: "p2", els: [bld("b2a", 5)] });
    const parse = vi.spyOn(JSON, "parse");
    for (let i = 0; i < 5; i++) saveSite({ id: "p2", els: [bld("b2a", 10 + i)] });
    const big = parse.mock.calls.filter((c) => typeof c[0] === "string" && c[0].length > 2000);
    parse.mockRestore();
    expect(big.length).toBe(0);
  });
  it("an edit serialises about ONE plan's worth of text — and the amount does NOT grow with the library (B2165120)", () => {
    globalThis.__PLANYR_LEGACY_MIRROR = "idle";   // production policy: the legacy-copy refresh is NOT on the edit path
    const cost = (n) => {
      localStorage.clear();
      seed(n);
      saveSite({ id: "p2", els: [bld("b2a", 5)] });
      const stringify = vi.spyOn(JSON, "stringify");
      saveSite({ id: "p2", els: [bld("b2a", 99)] });
      const chars = stringify.mock.results.reduce((s, r) => s + (typeof r.value === "string" ? r.value.length : 0), 0);
      stringify.mockRestore();
      return chars;
    };
    const small = cost(8), big = cost(80);
    delete globalThis.__PLANYR_LEGACY_MIRROR;
    // the ledger's id list and the history ring are the only things that can scale, and neither is the library's text
    expect(big).toBeLessThan(small * 1.6);
  });
  it("sitesWriteStillCurrent is true right after a write and false the moment anyone else touches the key", () => {
    seed(3);
    expect(saveSite({ id: "p1", els: [bld("q")] })).toBe(true);
    const stamp = sitesWriteStamp();
    expect(sitesWriteStillCurrent(stamp)).toBe(true);
    expect(sitesWriteStillCurrent(null)).toBe(false);
    localStorage.setItem("planarfit:sites:v1:idx", JSON.stringify({ v: 1, ok: true, gen: "someone-else", stale: true }));   // another tab wrote a plan: it bumps the index
    expect(sitesWriteStillCurrent(stamp)).toBe(false);
    saveSite({ id: "p1", els: [bld("q2")] });                          // our next write makes a NEW stamp
    expect(sitesWriteStillCurrent(stamp)).toBe(false);
    expect(sitesWriteStillCurrent(sitesWriteStamp())).toBe(true);
  });
  it("a foreign writer's change is SEEN by the next save, never overwritten from a stale cache (B127 cross-tab union)", () => {
    seed(3);
    saveSite({ id: "p1", els: [bld("mine")] });
    const stored = JSON.parse(localStorage.getItem(KEY));
    stored.p0.name = "renamed elsewhere";
    stored.p0.updatedAt = Date.now() + 5000;
    localStorage.setItem(KEY, JSON.stringify(stored));
    saveSite({ id: "p1", els: [bld("mine2")] });
    expect(JSON.parse(localStorage.getItem(KEY)).p0.name).toBe("renamed elsewhere");
  });
});

describe("the light summary read is memoised on the store's exact bytes", () => {
  it("parses once for a given store string, again the moment it changes, and hands out private copies", () => {
    seed(6);
    loadSiteSummaries();
    const parse = vi.spyOn(JSON, "parse");
    const a = loadSiteSummaries(); const b = loadSiteSummaries();
    expect(parse.mock.calls.filter((c) => typeof c[0] === "string" && c[0].length > 2000).length).toBe(0);
    a[0].name = "scribbled on";
    expect(loadSiteSummaries()[0].name).not.toBe("scribbled on");
    expect(b.length).toBe(6);
    parse.mockRestore();
    saveSite({ id: "p0", name: "Renamed" });                      // a real change bumps the index → the memo misses and the read is redone
    const c = loadSiteSummaries();
    expect(c.find((m) => m.id === "p0").name).toBe("Renamed");
  });
  it("right after THIS tab saved a plan, it takes the parse storage.js already holds — zero store parses — and still equals a real read", () => {
    seed(6);
    loadSiteSummaries();
    saveSite({ id: "p3", name: "Plan 3 renamed", els: [bld("changed")] });         // the bytes changed: the memo misses
    const parse = vi.spyOn(JSON, "parse");
    const got = loadSiteSummaries();
    const bigParses = parse.mock.calls.filter((c) => typeof c[0] === "string" && c[0].length > 2000).length;
    parse.mockRestore();
    expect(bigParses).toBe(0);
    const truth = JSON.parse(localStorage.getItem(KEY));                           // what a from-scratch read would have seen
    expect(got.length).toBe(Object.keys(truth).length);
    for (const m of got) {
      expect(m.name).toBe(truth[m.id].name);
      expect(m.updatedAt).toBe(truth[m.id].updatedAt || 0);
      expect(m.groupId).toBe(truth[m.id].groupId || m.id);
    }
    expect(got[0].id).toBe("p3");                                                  // newest first, as before
  });
  it("agrees with the unmemoised read on a store another writer replaced wholesale", () => {
    seed(4);
    loadSiteSummaries();
    localStorage.setItem(KEY, JSON.stringify({ solo: { id: "solo", groupId: "solo", site: "Only", name: "One", updatedAt: 5 } }));
    const got = loadSiteSummaries();   // an older build rewrote the legacy entry whole: the plans it no longer holds were deleted there, "solo" was created there
    expect(got.map((m) => m.id)).toEqual(["solo"]);
  });
});

describe("wiring", () => {
  it("the autosave settle tick skips a write the mirror already made, and still writes when it cannot prove that", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const src = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");
    expect(src).toContain("mirrorStamp = ok ? sitesWriteStamp() : null;");
    // B2233521 — the same skip, with the verdict named so the duplicate-flush skip (lib/saveDedupe.js) can record the write it made
    expect(src).toContain("const mirrorHeld = !!(mirrorStamp && sitesWriteStillCurrent(mirrorStamp));");
    expect(src).toContain("const okSave = mirrorHeld ? true : saveSite(payload, { skipHistory: true });");
  });
});
