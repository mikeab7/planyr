import { describe, it, expect } from "vitest";
import { createGisCache, formatAge, isStale, purgeLegacyLocalStorage, NS, IDB_NS, IDB_INDEX_KEY } from "../src/workspaces/site-planner/lib/gisCache.js";

// A localStorage-like fake — kept ONLY to prove the legacy namespace is purged and that this
// cache never writes there again (NEW-1). The persistent tier is the async `disk` below.
function makeStore() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.delete(k); map.set(k, v); },
    removeItem: (k) => map.delete(k),
    get length() { return map.size; },
    key: (i) => Array.from(map.keys())[i] ?? null,
    _map: map,
  };
}
// An async key/value fake standing in for IndexedDB: resolves, never rejects, and can be told to
// refuse writes (the "the store said no" path) exactly like localDb.js's idbPut returning false.
function makeDisk({ refuse = () => false } = {}) {
  const map = new Map();
  return {
    get: async (k) => (map.has(k) ? map.get(k) : null),
    put: async (k, v) => { if (refuse(k, v)) return false; map.delete(k); map.set(k, v); return true; },
    delete: async (k) => { map.delete(k); return true; },
    _map: map,
    entryKeys: () => [...map.keys()].filter((k) => k !== IDB_INDEX_KEY),
  };
}
function makeClock(start = 1_000_000) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  now.set = (ms) => { t = ms; };
  return now;
}
// Let every fire-and-forget disk write settle.
const settle = async (n = 60) => { for (let i = 0; i < n; i++) await Promise.resolve(); };

describe("gisCache — formatAge (coarse age buckets)", () => {
  it("buckets seconds→days and rejects junk", () => {
    expect(formatAge(0)).toBe("just now");
    expect(formatAge(10_000)).toBe("just now");      // < 45s
    expect(formatAge(50_000)).toBe("50s ago");        // 45–59s
    expect(formatAge(90_000)).toBe("1m ago");
    expect(formatAge(3_600_000)).toBe("1h ago");
    expect(formatAge(26 * 3_600_000)).toBe("1d ago");
    expect(formatAge(-5)).toBe("");
    expect(formatAge(null)).toBe("");
    expect(formatAge(Infinity)).toBe("");
  });
});

describe("gisCache — isStale", () => {
  it("missing ⇒ stale; ttl 0 ⇒ always; else compares age to ttl", () => {
    expect(isStale(null, 1000, 0)).toBe(true);
    expect(isStale({ ts: 100 }, 0, 200)).toBe(true);     // ttl 0 ⇒ always refresh
    expect(isStale({ ts: 100 }, 1000, 500)).toBe(false); // age 400 < 1000
    expect(isStale({ ts: 100 }, 1000, 2000)).toBe(true); // age 1900 > 1000
  });
});

describe("gisCache — read/write + persistence", () => {
  it("write→read round-trips synchronously from L1 and reports age from the clock", () => {
    const clock = makeClock();
    const c = createGisCache({ disk: makeDisk(), store: null, now: clock });
    c.write("k", { hello: "world" });
    clock.advance(5000);
    const e = c.read("k");
    expect(e.data).toEqual({ hello: "world" });
    expect(e.ageMs).toBe(5000);
  });

  it("persists across instances over the same disk (survives a reload)", async () => {
    const disk = makeDisk();
    const clock = makeClock();
    createGisCache({ disk, store: null, now: clock }).write("boundaries", [1, 2, 3]);
    await settle();
    const reopened = createGisCache({ disk, store: null, now: clock }); // fresh L1, same store
    expect(await reopened.readAsync("boundaries")).toMatchObject({ data: [1, 2, 3] });
  });

  it("hydration warms the newest entries back into L1, so a reload paints synchronously", async () => {
    const disk = makeDisk();
    const clock = makeClock();
    const a = createGisCache({ disk, store: null, now: clock });
    clock.set(1000); a.write("old", [1]);
    clock.set(2000); a.write("new", [2]);
    await settle();
    const reopened = createGisCache({ disk, store: null, now: clock, warmEntries: 1 });
    await reopened.ready();
    expect(reopened.read("new").data).toEqual([2]);  // newest warmed
    expect(reopened.read("old")).toBe(null);          // beyond the warm bound — still on disk
    expect(await reopened.readAsync("old")).toMatchObject({ data: [1] });
  });

  it("tolerates a corrupt stored entry (treated as a miss) and self-heals the index row", async () => {
    const disk = makeDisk();
    const clock = makeClock();
    const c = createGisCache({ disk, store: null, now: clock });
    c.write("k", [1]);
    await settle();
    disk._map.set(IDB_NS + "k", "{not json");
    const reopened = createGisCache({ disk, store: null, now: clock });
    expect(await reopened.readAsync("k")).toBe(null);
    expect(reopened.stats().entries).toBe(0);
  });

  it("works with no disk (L1 only) and never throws", async () => {
    const c = createGisCache({ disk: null, store: null, now: makeClock() });
    c.write("k", [1]);
    expect(c.read("k").data).toEqual([1]);
    const { cached, fresh } = c.swr("k", async () => [2], { ttl: 1000 });
    expect(cached.data).toEqual([1]);
    expect((await fresh).updated).toBe(false); // age 0 < ttl ⇒ no fetch
  });

  it("a refused disk write is not claimed by the index (never report storage we don't have)", async () => {
    const disk = makeDisk({ refuse: (k) => k.startsWith(IDB_NS) });
    const c = createGisCache({ disk, store: null, now: makeClock() });
    c.write("k", [1]);
    await settle();
    expect(c.read("k").data).toEqual([1]); // L1 still serves the session
    expect(c.stats().entries).toBe(0);      // …but nothing claims to be stored
    expect(c.totalBytes()).toBe(0);
  });
});

describe("gisCache — the persistent tier is NOT localStorage (NEW-1)", () => {
  it("never writes to localStorage, however much it caches", async () => {
    const store = makeStore();
    const c = createGisCache({ disk: makeDisk(), store, now: makeClock() });
    for (let i = 0; i < 20; i++) c.write(`terrain:dem:L16:${i}`, "x".repeat(2000));
    await settle();
    expect([...store._map.keys()]).toEqual([]);
  });

  it("purges the legacy localStorage namespace on first run and leaves user work alone", async () => {
    const store = makeStore();
    store.setItem(NS + "terrain:dem:L16:-4364,1421", "x".repeat(400_000)); // the measured 400 KB tile
    store.setItem("planarfit:sites:cloud:u1", "PLANS");                    // the owner's saved work
    store.setItem("planarfit:sites:history:v1", "HISTORY");
    const c = createGisCache({ disk: makeDisk(), store, now: makeClock() });
    await c.ready();
    expect(store.getItem(NS + "terrain:dem:L16:-4364,1421")).toBe(null);
    expect(store.getItem("planarfit:sites:cloud:u1")).toBe("PLANS");
    expect(store.getItem("planarfit:sites:history:v1")).toBe("HISTORY");
  });

  it("purgeLegacyLocalStorage reports the bytes it freed and touches nothing else", () => {
    const store = makeStore();
    store.setItem(NS + "a", "x".repeat(1000));
    store.setItem(NS + "b", "x".repeat(500));
    store.setItem("planarfit:sites:v1", "SITE");
    const freed = purgeLegacyLocalStorage(store);
    expect(freed).toBeGreaterThanOrEqual(1500);
    expect(store.getItem("planarfit:sites:v1")).toBe("SITE");
    expect(store.length).toBe(1);
  });
});

describe("gisCache — stale-while-revalidate", () => {
  it("cold cache fetches, persists, and returns fresh (updated)", async () => {
    const c = createGisCache({ disk: makeDisk(), store: null, now: makeClock() });
    let calls = 0;
    const { cached, stale, fresh } = c.swr("k", async () => { calls++; return [42]; }, { ttl: 1000 });
    expect(cached).toBe(null);
    expect(stale).toBe(true);
    const r = await fresh;
    expect(r).toMatchObject({ updated: true, data: [42] });
    expect(calls).toBe(1);
    expect(c.read("k").data).toEqual([42]); // persisted
  });

  it("a copy on DISK but not in L1 (the post-reload case) is served with NO fetch", async () => {
    const disk = makeDisk();
    const clock = makeClock();
    createGisCache({ disk, store: null, now: clock }).write("k", [7]);
    await settle();
    const reopened = createGisCache({ disk, store: null, now: clock, warmEntries: 0 });
    clock.advance(100); // age 100 < ttl 1000 ⇒ the stored copy is still good
    let calls = 0;
    const { cached, fresh } = reopened.swr("k", async () => { calls++; return [8]; }, { ttl: 1000 });
    expect(cached).toBe(null);                                // async tier: not resident yet
    expect(await fresh).toMatchObject({ updated: false, data: [7] });
    expect(calls).toBe(0);                                    // …and no network was touched
  });

  it("a STALE copy on disk still triggers the refresh and keeps the old copy on failure", async () => {
    const disk = makeDisk();
    const clock = makeClock();
    createGisCache({ disk, store: null, now: clock }).write("k", [7]);
    await settle();
    const reopened = createGisCache({ disk, store: null, now: clock, warmEntries: 0 });
    clock.advance(5000); // > ttl
    const { fresh } = reopened.swr("k", async () => { throw new Error("offline"); }, { ttl: 1000 });
    const r = await fresh;
    expect(r.error).toBeInstanceOf(Error);
    expect(r.data).toEqual([7]); // last-known-good from the persistent tier
  });

  it("warm + fresh returns the cached copy WITHOUT fetching", async () => {
    const clock = makeClock();
    const c = createGisCache({ disk: makeDisk(), store: null, now: clock });
    c.write("k", [1]);
    clock.advance(100); // age 100 < ttl 1000
    let calls = 0;
    const { cached, stale, fresh } = c.swr("k", async () => { calls++; return [2]; }, { ttl: 1000 });
    expect(cached.data).toEqual([1]);
    expect(stale).toBe(false);
    expect(await fresh).toMatchObject({ updated: false, data: [1] });
    expect(calls).toBe(0);
  });

  it("warm + stale paints the cached copy NOW and revalidates in the background", async () => {
    const clock = makeClock();
    const c = createGisCache({ disk: makeDisk(), store: null, now: clock });
    c.write("k", [1]);
    clock.advance(5000); // age 5000 > ttl 1000 ⇒ stale
    let calls = 0; const seen = [];
    const { cached, stale, fresh } = c.swr("k", async () => { calls++; return [9]; }, { ttl: 1000, onFresh: (r) => seen.push(r) });
    expect(cached).toMatchObject({ data: [1], ageMs: 5000 }); // instant last-known-good
    expect(stale).toBe(true);
    const r = await fresh;
    expect(calls).toBe(1);
    expect(r).toMatchObject({ updated: true, data: [9] });
    expect(seen).toHaveLength(1);
    expect(c.read("k").data).toEqual([9]); // swapped in
  });

  it("a failed refresh KEEPS the cached copy and surfaces the error (never throws)", async () => {
    const clock = makeClock();
    const c = createGisCache({ disk: makeDisk(), store: null, now: clock });
    c.write("k", [1]);
    clock.advance(5000);
    const { cached, fresh } = c.swr("k", async () => { throw new Error("offline"); }, { ttl: 1000 });
    expect(cached.data).toEqual([1]);
    const r = await fresh;
    expect(r.updated).toBe(false);
    expect(r.error).toBeInstanceOf(Error);
    expect(r.data).toEqual([1]);            // still last-known-good
    expect(c.read("k").data).toEqual([1]);  // unchanged in the cache
  });

  it("cold cache + failed fetch yields null data with the error attached", async () => {
    const c = createGisCache({ disk: makeDisk(), store: null, now: makeClock() });
    const { cached, fresh } = c.swr("k", async () => { throw new Error("nope"); }, { ttl: 1000 });
    expect(cached).toBe(null);
    const r = await fresh;
    expect(r.data).toBe(null);
    expect(r.error).toBeInstanceOf(Error);
  });
});

describe("gisCache — eviction + namespace isolation", () => {
  it("trims oldest to stay under the total byte budget", async () => {
    const clock = makeClock();
    const c = createGisCache({ disk: makeDisk(), store: null, now: clock, maxTotalBytes: 300, maxEntryBytes: 1000 });
    clock.set(1000); c.write("a", "z".repeat(100));
    clock.set(2000); c.write("b", "z".repeat(100));
    clock.set(3000); c.write("c", "z".repeat(100)); // total ~363 > 300 → drop "a"
    const persisted = c.ourKeys().map((k) => k.slice(IDB_NS.length));
    expect(persisted).not.toContain("a");
    expect(persisted).toContain("c");
    expect(c.read("a")).toBe(null); // dropped from L1 too
    expect(c.totalBytes()).toBeLessThanOrEqual(300);
  });

  it("evictOldest drops exactly one, oldest first, and reports honestly when empty", () => {
    const clock = makeClock();
    const c = createGisCache({ disk: makeDisk(), store: null, now: clock });
    clock.set(1000); c.write("a", [1]);
    clock.set(2000); c.write("b", [2]);
    expect(c.evictOldest()).toBe(true);
    expect(c.ourKeys().map((k) => k.slice(IDB_NS.length))).toEqual(["b"]);
    expect(c.evictOldest()).toBe(true);
    expect(c.evictOldest()).toBe(false);
  });

  it("the budget is unchanged from B1162 — 512 KB per entry, 3 MB total", () => {
    const c = createGisCache({ disk: makeDisk(), store: null, now: makeClock() });
    expect(c.stats().budgetBytes).toBe(3 * 1024 * 1024);
    c.write("big", "y".repeat(600 * 1024));
    expect(c.read("big").data.length).toBe(600 * 1024); // L1 hit
    expect(c.stats().entries).toBe(0);                   // …never stored: over maxEntryBytes
  });

  it("an oversize entry is served from L1 but never persisted", async () => {
    const disk = makeDisk();
    const c = createGisCache({ disk, store: null, now: makeClock(), maxEntryBytes: 50 });
    c.write("big", "y".repeat(500));
    await settle();
    expect(c.read("big").data).toBe("y".repeat(500)); // L1 hit
    expect(disk.entryKeys()).toEqual([]);              // not stored
  });

  it("clear() only removes our namespace; foreign records survive", async () => {
    const disk = makeDisk();
    disk._map.set("raster:site1:underlay", "IMAGE"); // a Site Planner raster — must not be touched
    const c = createGisCache({ disk, store: null, now: makeClock() });
    c.write("k", [1]);
    await settle();
    const freed = c.clear();
    await settle();
    expect(freed).toBeGreaterThan(0);
    expect(c.read("k")).toBe(null);
    expect(disk._map.get("raster:site1:underlay")).toBe("IMAGE");
  });
});
