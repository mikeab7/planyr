/* B2236000 (round 6) — the fresh-load stall on an owner-sized device: what each change promises, held as a test.
 *   (1) loadSitesList remembers each plan's MODEL until that plan's stored text changes — but still hands every caller a FRESH array of FRESH
 *       top-level objects (refreshSites' identity contract), and the shared models are deep-frozen under test so an in-place mutation throws.
 *   (2) createSiteModel remembers an element list it has proven clean (the passes returned it untouched) — and only that.
 *   (3) a merge with a slim cloud header keeps the local list's identity, so it stays recognisably clean through mergeSiteContent.
 *   (4) planStore.writeMap keeps the shared object of a plan whose text did not change.
 *   (5) the history ring's text is byte-identical to JSON.stringify, and the localStorage cap keeps exactly what the old halving rule kept.
 *   (6) the cross-load proof (elsProof) matches only the same build + the same exact text. */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { saveSite, loadSitesList, historyRingJson, historySeedAddsTo } from "../src/workspaces/site-planner/lib/storage.js";
import { createSiteModel, mergeSiteContent, elsListIsClean } from "../src/workspaces/site-planner/lib/siteModel.js";
import * as planStore from "../src/workspaces/site-planner/lib/planStore.js";
import { textHash, elsProven, recordElsProof, _resetElsProofForTest, ELS_PROOF_KEY } from "../src/workspaces/site-planner/lib/elsProof.js";

let zSeq = 0;
const bld = (id, cx = 0) => ({ id, type: "building", cx, cy: 0, w: 100, h: 100, rot: 0, z: ++zSeq });   // distinct z: a plan's stored z are unique (a duplicate is re-stacked by the read)
let store;
beforeEach(() => {
  store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    key: (i) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length; },
  };
  planStore._resetForTest();
});
function seed(n = 5) { for (let i = 0; i < n; i++) saveSite({ id: `p${i}`, groupId: `g${i % 2}`, site: `Site ${i % 2}`, name: `Plan ${i}`, els: [bld(`b${i}a`), bld(`b${i}b`, 200)] }); }

describe("(1) the list read remembers each plan's model until its stored text changes", () => {
  it("a second read re-uses every model (same nested lists) but returns a fresh array of fresh top-level objects", () => {
    seed();
    const a = loadSitesList(), b = loadSitesList();
    expect(a).not.toBe(b);
    expect(a.map((m) => m.id)).toEqual(b.map((m) => m.id));
    for (let i = 0; i < a.length; i++) { expect(a[i]).not.toBe(b[i]); expect(a[i].els).toBe(b[i].els); expect(a[i]).toEqual(b[i]); }
  });
  it("an edit to ONE plan re-models that plan only", () => {
    seed();
    const a = loadSitesList();
    saveSite({ id: "p2", els: [bld("b2a", 50), bld("b2b", 200)] });
    const b = loadSitesList();
    const byId = (l) => Object.fromEntries(l.map((m) => [m.id, m]));
    const A = byId(a), B = byId(b);
    expect(B.p2.els).not.toBe(A.p2.els);
    expect(B.p2.els.find((e) => e.id === "b2a").cx).toBe(50);
    for (const id of ["p0", "p1", "p3", "p4"]) expect(B[id].els).toBe(A[id].els);
  });
  it("a caller assigning a top-level field does not leak into the next read; mutating a nested list throws (deep-frozen under test)", () => {
    seed(2);
    const a = loadSitesList();
    a[0].site = "scribbled";
    expect(loadSitesList().find((m) => m.id === a[0].id).site).not.toBe("scribbled");
    expect(() => { a[0].els.push(bld("x")); }).toThrow();
  });
});

describe("(2) a proven-clean element list is remembered — and only a proven one", () => {
  it("a clean list comes back as the SAME array and is then recognised", () => {
    const els = [bld("a"), bld("b", 300)];
    const m = createSiteModel({ id: "s", els });
    expect(m.els).toBe(els);
    expect(elsListIsClean(els)).toBe(true);
    expect(createSiteModel({ id: "s2", els }).els).toBe(els);
  });
  it("a list a pass CHANGED is not remembered (here: a null entry the read drops)", () => {
    const raw = [bld("a"), null];
    const m = createSiteModel({ id: "s", els: raw });
    expect(m.els).not.toBe(raw);
    expect(m.els.length).toBe(1);
    expect(elsListIsClean(raw)).toBe(false);
  });
});

describe("(3) a merge with a slim cloud header keeps the local element list", () => {
  it("cloud newer or local newer, no element arrives from the header: merged.els IS the local list", () => {
    const local = createSiteModel({ id: "s", updatedAt: 1000, els: [bld("a"), bld("b", 300)], deletedIds: ["gone"] });
    for (const at of [500, 5000]) {
      const slim = { id: "s", updatedAt: at, elementsInRows: true, els: [], deletedIds: [] };
      const merged = mergeSiteContent(local, slim);
      expect(merged.els).toBe(local.els);
    }
  });
  it("a header that DOES carry an element still unions (new list)", () => {
    const local = createSiteModel({ id: "s", updatedAt: 1000, els: [bld("a")] });
    const merged = mergeSiteContent(local, { id: "s", updatedAt: 2000, els: [bld("c", 500)] });
    expect(merged.els.map((e) => e.id).sort()).toEqual(["a", "c"]);
  });
});

describe("(4) writeMap keeps the shared object of an unchanged plan", () => {
  it("re-writing identical content does not replace what the store hands out", () => {
    seed(3);
    const base = "planarfit:sites:v1";
    const before = planStore.readShared(base);
    const copy = Object.fromEntries(Object.entries(before).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]));
    planStore.writeMap(base, copy);
    const after = planStore.readShared(base);
    for (const id of Object.keys(before)) expect(after[id]).toBe(before[id]);
    planStore._resetForTest();                                     // a fresh page: the store parses each entry and remembers its exact text
    const fresh = planStore.readShared(base);
    expect(planStore.textOf(fresh.p0)).toBe(store[`${base}:p:p0`]);
  });
});

describe("(5) the history ring's text", () => {
  const snap = (id, at, n) => ({ at, sig: `${n}/0/0/0/0/0/0`, buildings: n, name: "P", site: "S", model: { id, els: Array.from({ length: n }, (_, i) => bld(`${id}-${i}`)) } });
  it("is byte-identical to JSON.stringify, whole and cut to any keep count", () => {
    const h = { a: [snap("a", 3, 2), snap("a", 2, 1)], b: [snap("b", 9, 3)], c: [], d: undefined };
    expect(historyRingJson(h)).toBe(JSON.stringify(h));
    for (const keep of [1, 2, 7]) {
      const cut = {}; for (const [k, l] of Object.entries(h)) if (l !== undefined) cut[k] = l.slice(0, keep);
      expect(historyRingJson(h, keep)).toBe(JSON.stringify(cut));
    }
  });
  it("historySeedAddsTo: true only when the localStorage seed holds a snapshot IndexedDB lacks", () => {
    const idb = { a: [{ at: 1 }, { at: 2 }], b: [{ at: 5 }] };
    expect(historySeedAddsTo({ a: [{ at: 2 }], b: [{ at: 5 }] }, idb)).toBe(false);
    expect(historySeedAddsTo({}, idb)).toBe(false);
    expect(historySeedAddsTo({ a: [{ at: 3 }] }, idb)).toBe(true);
    expect(historySeedAddsTo({ c: [{ at: 1 }] }, idb)).toBe(true);
  });
});

describe("(6) the cross-load clean proof", () => {
  beforeEach(() => { globalThis.__PLANYR_ELS_PROOF = true; _resetElsProofForTest(); });
  afterEach(() => { delete globalThis.__PLANYR_ELS_PROOF; _resetElsProofForTest(); });
  it("matches only the same id + the exact same text, and survives a 'reload' (re-read from storage)", async () => {
    const t = JSON.stringify({ id: "p", els: [bld("a")] });
    expect(elsProven("p", t)).toBe(false);
    recordElsProof("p", t);
    expect(elsProven("p", t)).toBe(true);
    expect(elsProven("p", t + " ")).toBe(false);
    expect(elsProven("q", t)).toBe(false);
    await new Promise((r) => setTimeout(r, 5));
    expect(store[ELS_PROOF_KEY]).toBeTruthy();
    _resetElsProofForTest();                     // a fresh page: only storage remains
    expect(elsProven("p", t)).toBe(true);
  });
  it("a proof written by another build is ignored", () => {
    const t = "{}";
    store[ELS_PROOF_KEY] = JSON.stringify({ b: "some-other-build", h: { p: textHash(t) } });
    _resetElsProofForTest();
    expect(elsProven("p", t)).toBe(false);
  });
  it("is OFF where the build has no stable id unless a test opts in", () => {
    delete globalThis.__PLANYR_ELS_PROOF; _resetElsProofForTest();
    recordElsProof("p", "{}");
    expect(elsProven("p", "{}")).toBe(false);
  });
  it("textHash separates near-identical texts", () => {
    const seen = new Set();
    for (let i = 0; i < 2000; i++) seen.add(textHash(`{"x":${i}}`));
    expect(seen.size).toBe(2000);
  });
});

describe("(7) B2236000 round 6b — the whole-library layout (a device that could not be split)", () => {
  const blobMode = () => { localStorage.setItem("planarfit:planStore:layout", "blob"); planStore._resetForTest(); };
  it("a write of unchanged content keeps every shared object and does not rewrite the library", () => {
    blobMode(); seed(4);
    const base = "planarfit:sites:v1";
    const before = planStore.readShared(base);
    let sets = 0; const real = localStorage.setItem; localStorage.setItem = (k, v) => { if (k === base) sets++; real(k, v); };
    try { planStore.writeMap(base, Object.fromEntries(Object.entries(before).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]))); } finally { localStorage.setItem = real; }
    expect(sets).toBe(0);
    const after = planStore.readShared(base);
    for (const id of Object.keys(before)) expect(after[id]).toBe(before[id]);
  });
  it("a write that changes ONE plan keeps the others' objects and writes the new library", () => {
    blobMode(); seed(4);
    const base = "planarfit:sites:v1";
    const before = planStore.readShared(base);
    const next = { ...before, p1: { ...JSON.parse(JSON.stringify(before.p1)), name: "renamed" } };
    planStore.writeMap(base, next);
    const after = planStore.readShared(base);
    expect(after.p1.name).toBe("renamed");
    for (const id of ["p0", "p2", "p3"]) expect(after[id]).toBe(before[id]);
    expect(JSON.parse(store[base]).p1.name).toBe("renamed");
  });
  it("the cross-load proof keys on the plan's own JSON there (there is no per-plan entry text)", async () => {
    globalThis.__PLANYR_ELS_PROOF = true; _resetElsProofForTest();
    try {
      blobMode(); seed(2);
      loadSitesList();
      await new Promise((r) => setTimeout(r, 5));
      expect(JSON.parse(store[ELS_PROOF_KEY]).h.p0).toBeTruthy();
    } finally { delete globalThis.__PLANYR_ELS_PROOF; _resetElsProofForTest(); }
  });
});
