import { describe, it, expect, beforeEach, vi } from "vitest";
import { mergeSiteContent, createSiteModel } from "../src/workspaces/site-planner/lib/siteModel.js";
import { mergeHeader, headerSlice, applyLeafPatches } from "../src/workspaces/site-planner/lib/headerMerge.js";

/* B1953797 (H1) — the SAME two-writer loss, one layer down: two tabs of ONE browser share the local
 * mirror (localStorage), and `saveSite`'s cross-tab fold called `mergeSiteContent`, which took the
 * ENTIRE `settings` object from whichever copy had the newer `updatedAt`. RED on the untouched tree:
 * tab B's later save of an unrelated setting reverted tab A's earlier one. */

const hdr = () => ({
  id: "p1", name: "Plan", updatedAt: 1000, els: [], markups: [], measures: [], callouts: [], parcels: [],
  settings: { setback: 25, floodMitigation: { jurKey: "harris", mode: "auto" }, printPreparedBy: "MB" },
  origin: { lat: 29.7, lon: -95.4 },
});

describe("mergeSiteContent — header keys merge per leaf when the writer's BASE is known", () => {
  it("keeps this writer's edit AND adopts the other copy's (was: newest whole `settings` wins)", () => {
    const base = headerSlice(createSiteModel(hdr()));
    const mine = createSiteModel({ ...hdr(), updatedAt: 3000, settings: { ...hdr().settings, setback: 30 } });        // B: newer, older jurisdiction
    const theirs = createSiteModel({ ...hdr(), updatedAt: 2000, settings: { ...hdr().settings, floodMitigation: { jurKey: "waller", mode: "auto" } } }); // A
    const m = mergeSiteContent(mine, theirs, { headerBase: base });
    expect(m.settings.setback).toBe(30);
    expect(m.settings.floodMitigation.jurKey).toBe("waller");
    expect(m.settings.printPreparedBy).toBe("MB");
  });

  it("without a base the old rule stands (nothing can be attributed) — behaviour unchanged for every other caller", () => {
    const mine = createSiteModel({ ...hdr(), updatedAt: 3000, settings: { ...hdr().settings, setback: 30 } });
    const theirs = createSiteModel({ ...hdr(), updatedAt: 2000, settings: { ...hdr().settings, floodMitigation: { jurKey: "waller", mode: "auto" } } });
    expect(mergeSiteContent(mine, theirs).settings.floodMitigation.jurKey).toBe("harris");
  });

  it("a deleted leaf on the other side is adopted, not resurrected", () => {
    const base = headerSlice(createSiteModel(hdr()));
    const { printPreparedBy: _gone, ...noPrep } = hdr().settings;
    const mine = createSiteModel({ ...hdr(), updatedAt: 3000, settings: { ...hdr().settings, setback: 30 } });
    const theirs = createSiteModel({ ...hdr(), updatedAt: 2000, settings: noPrep });
    const m = mergeSiteContent(mine, theirs, { headerBase: base });
    expect("printPreparedBy" in m.settings).toBe(false);
    expect(m.settings.setback).toBe(30);
  });
});

// Node has no localStorage: install ONE shared Map-backed shim so two module instances (= two tabs)
// genuinely share a mirror, the way two tabs of one browser do.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); }, clear: () => store.clear(), key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};

describe("saveSite cross-tab fold (two tabs, one local mirror)", () => {
  beforeEach(() => { store.clear(); });

  const tab = async () => { vi.resetModules(); return import("../src/workspaces/site-planner/lib/storage.js"); };

  it("tab B's later save of another setting does NOT revert tab A's earlier jurisdiction change", async () => {
    const A = await tab();
    A.saveSite(hdr());
    const B = await tab();
    B.loadSite("p1", { persistHeal: true });           // B opens the plan: this is B's base
    A.saveSite({ id: "p1", settings: { ...hdr().settings, floodMitigation: { jurKey: "waller", mode: "auto" } } });
    B.saveSite({ id: "p1", settings: { ...hdr().settings, setback: 30 } }); // B's stale canvas state + its own edit
    const fin = B.loadSite("p1");
    expect(fin.settings.setback).toBe(30);
    expect(fin.settings.floodMitigation.jurKey).toBe("waller");
  });
});

describe("mergeHeader — the pure rule", () => {
  const S = (o) => ({ settings: o });
  it("adopt / keep / clash / atoms", () => {
    const base = S({ a: 1, b: 1, c: 1, list: [1] });
    const mine = S({ a: 2, b: 1, c: 5, list: [1] });
    const theirs = S({ a: 1, b: 9, c: 6, list: [1, 2] });
    const r = mergeHeader(base, mine, theirs);
    expect(r.merged.settings).toEqual({ a: 2, b: 9, c: 5, list: [1, 2] });
    expect(r.conflicts.map((p) => p.join("."))).toEqual(["settings.c"]);
    expect(r.keptMine.map((p) => p.join(".")).sort()).toEqual(["settings.a", "settings.c"]);
  });
  it("no base ⇒ degenerates to mine and says so", () => {
    const r = mergeHeader(null, S({ a: 1 }), S({ a: 2 }));
    expect(r.noBase).toBe(true);
    expect(r.merged.settings.a).toBe(1);
    expect(r.adopted).toEqual([]);
  });
  it("identical copies ⇒ no adoption, no dirt", () => {
    const b = S({ a: 1, n: { x: 1 } });
    const r = mergeHeader(b, b, b);
    expect(r.changedFromMine).toBe(false);
    expect(r.keptMine).toEqual([]);
  });
  it("applyLeafPatches touches only the adopted leaves (immutably)", () => {
    const before = { settings: { a: 1, n: { x: 1, y: 2 } } };
    const out = applyLeafPatches(before, [{ path: ["settings", "n", "x"], value: 9 }, { path: ["settings", "gone"], value: undefined }]);
    expect(out.settings).toEqual({ a: 1, n: { x: 9, y: 2 } });
    expect(before.settings.n.x).toBe(1);
  });
});
