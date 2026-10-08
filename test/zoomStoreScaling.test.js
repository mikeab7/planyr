// NEW-1 (Silvestri zoom freeze) — three leaves that scaled with the size of the on-device plan store inside a
// planner zoom step. Each is now cached/gated; these pin that the cache is correct (never stale) and effective.
import { describe, it, expect } from "vitest";
import { skipWhileHidden } from "../src/workspaces/site-planner/lib/hiddenRenderGate.js";
import { siteAcres } from "../src/workspaces/site-planner/lib/siteBoundary.js";
import * as polyClip from "../src/workspaces/site-planner/lib/polyClip.js";

const sq = (x, y, s) => [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }];

describe("hiddenRenderGate.skipWhileHidden", () => {
  it("skips only when hidden before AND now, isActive unchanged", () => {
    expect(skipWhileHidden({ visible: false, isActive: true }, { visible: false, isActive: true, other: 1 })).toBe(true);
  });
  it("renders when it becomes visible, is visible, or isActive flips", () => {
    expect(skipWhileHidden({ visible: false, isActive: true }, { visible: true, isActive: true })).toBe(false);
    expect(skipWhileHidden({ visible: true, isActive: true }, { visible: false, isActive: true })).toBe(false);
    expect(skipWhileHidden({ visible: true, isActive: true }, { visible: true, isActive: true })).toBe(false);
    expect(skipWhileHidden({ visible: false, isActive: true }, { visible: false, isActive: false })).toBe(false);
  });
});

describe("siteAcres cache", () => {
  const site = (parcels) => ({ parcels });
  it("equals the uncached dissolved area on first and repeat calls (effectiveness is measured by the harness)", () => {
    const parcels = [{ id: "a", points: sq(0, 0, 208.71) }, { id: "b", points: sq(100, 0, 208.71) }]; // overlapping
    const want = polyClip.dissolvedParcelSqft(parcels) / 43560;
    expect(siteAcres(site(parcels))).toBeCloseTo(want, 10);
    expect(siteAcres(site(parcels.map((p) => ({ ...p })))))   .toBeCloseTo(want, 10); // new objects, same geometry
  });
  it("is a MISS for every input the area reads — never a stale acreage", () => {
    const base = [{ id: "a", points: sq(0, 0, 300) }];
    const a0 = siteAcres(site(base));
    expect(siteAcres(site([{ id: "a", points: sq(0, 0, 301) }]))).not.toBeCloseTo(a0, 6);                 // vertex moved
    expect(siteAcres(site([{ id: "a", points: sq(0, 0, 300), active: false }]))).toBe(0);                 // inactive
    expect(siteAcres(site([{ id: "a", points: sq(0, 0, 300), exceptions: [{ pts: sq(10, 10, 50) }] }]))).toBeLessThan(a0); // save-and-except
    expect(siteAcres(site([]))).toBe(0);
  });
});

describe("names.js summaries cache (planNameOf)", () => {
  it("serves repeat reads from one parse, and is never stale after a write + the list-moved signal OR a raw change", async () => {
    const store = new Map();
    let reads = 0;
    globalThis.localStorage = { getItem: (k) => { reads++; return store.has(k) ? store.get(k) : null; }, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
    const key = "planarfit:sites:v1";
    const rec = (name) => JSON.stringify({ s1: { id: "s1", groupId: "g1", site: "Proj", name, updatedAt: 1 } });
    store.set(key, rec("Concept A"));
    const names = await import("../src/shared/names/names.js");
    names.invalidateNameIndex();
    expect(names.planNameOf("s1")).toBe("Concept A");
    const parsesBefore = reads;
    for (let i = 0; i < 50; i++) names.planNameOf("s1");
    expect(reads).toBe(parsesBefore);                         // 50 snapshot reads, zero extra store reads
    store.set(key, rec("Concept B"));                          // a writer that fires the signal
    names.invalidateNameIndex();
    expect(names.planNameOf("s1")).toBe("Concept B");
    store.set(key, rec("Concept C"));                          // a writer that never fires it: TTL backstop catches it by raw text
    const realNow = Date.now; Date.now = () => realNow() + 5000;
    try { expect(names.planNameOf("s1")).toBe("Concept C"); } finally { Date.now = realNow; }
    delete globalThis.localStorage;
  });
});
