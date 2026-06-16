import { describe, it, expect } from "vitest";
import { createGisCache, formatAge, isStale, NS } from "../src/workspaces/site-planner/lib/gisCache.js";

// A localStorage-like fake (insertion-ordered, optional byte capacity to simulate
// QuotaExceeded) and a controllable clock — so the SWR cache tests are deterministic
// with no DOM and no network.
function makeStore({ capacity = Infinity } = {}) {
  const map = new Map();
  const bytes = () => { let n = 0; for (const v of map.values()) n += v.length; return n; };
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      const prev = map.has(k) ? map.get(k).length : 0;
      if (bytes() - prev + v.length > capacity) { const e = new Error("QuotaExceededError"); e.name = "QuotaExceededError"; throw e; }
      map.delete(k); map.set(k, v);
    },
    removeItem: (k) => map.delete(k),
    get length() { return map.size; },
    key: (i) => Array.from(map.keys())[i] ?? null,
  };
}
function makeClock(start = 1_000_000) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  now.set = (ms) => { t = ms; };
  return now;
}

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
  it("write→read round-trips and reports age from the clock", () => {
    const clock = makeClock();
    const c = createGisCache({ store: makeStore(), now: clock });
    c.write("k", { hello: "world" });
    clock.advance(5000);
    const e = c.read("k");
    expect(e.data).toEqual({ hello: "world" });
    expect(e.ageMs).toBe(5000);
  });

  it("persists across instances over the same store (survives a reload)", () => {
    const store = makeStore();
    const clock = makeClock();
    createGisCache({ store, now: clock }).write("boundaries", [1, 2, 3]);
    const reopened = createGisCache({ store, now: clock }); // fresh L1, same storage
    expect(reopened.read("boundaries").data).toEqual([1, 2, 3]);
  });

  it("tolerates a corrupt stored entry (treated as a miss)", () => {
    const store = makeStore();
    store.setItem(NS + "k", "{not json");
    expect(createGisCache({ store, now: makeClock() }).read("k")).toBe(null);
  });

  it("works with no store (L1 only) and never throws", async () => {
    const c = createGisCache({ store: null, now: makeClock() });
    c.write("k", [1]);
    expect(c.read("k").data).toEqual([1]);
    const { cached, fresh } = c.swr("k", async () => [2], { ttl: 1000 });
    expect(cached.data).toEqual([1]);
    expect((await fresh).updated).toBe(false); // age 0 < ttl ⇒ no fetch
  });
});

describe("gisCache — stale-while-revalidate", () => {
  it("cold cache fetches, persists, and returns fresh (updated)", async () => {
    const c = createGisCache({ store: makeStore(), now: makeClock() });
    let calls = 0;
    const { cached, stale, fresh } = c.swr("k", async () => { calls++; return [42]; }, { ttl: 1000 });
    expect(cached).toBe(null);
    expect(stale).toBe(true);
    const r = await fresh;
    expect(r).toMatchObject({ updated: true, data: [42] });
    expect(calls).toBe(1);
    expect(c.read("k").data).toEqual([42]); // persisted
  });

  it("warm + fresh returns the cached copy WITHOUT fetching", async () => {
    const clock = makeClock();
    const c = createGisCache({ store: makeStore(), now: clock });
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
    const c = createGisCache({ store: makeStore(), now: clock });
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
    const c = createGisCache({ store: makeStore(), now: clock });
    c.write("k", [1]);
    clock.advance(5000);
    const { cached, fresh } = c.swr("k", async () => { throw new Error("offline"); }, { ttl: 1000 });
    expect(cached.data).toEqual([1]);
    const r = await fresh;
    expect(r.updated).toBe(false);
    expect(r.error).toBeInstanceOf(Error);
    expect(r.data).toEqual([1]);            // still last-known-good
    expect(c.read("k").data).toEqual([1]);  // unchanged on disk
  });

  it("cold cache + failed fetch yields null data with the error attached", async () => {
    const c = createGisCache({ store: makeStore(), now: makeClock() });
    const { cached, fresh } = c.swr("k", async () => { throw new Error("nope"); }, { ttl: 1000 });
    expect(cached).toBe(null);
    const r = await fresh;
    expect(r.data).toBe(null);
    expect(r.error).toBeInstanceOf(Error);
  });
});

describe("gisCache — eviction + namespace isolation", () => {
  it("evicts the oldest entry under quota pressure, keeping newer ones", () => {
    const clock = makeClock();
    const store = makeStore({ capacity: 260 }); // ~2 entries of ~121 bytes
    const c = createGisCache({ store, now: clock, maxTotalBytes: Infinity });
    clock.set(1000); c.write("a", "x".repeat(100));
    clock.set(2000); c.write("b", "x".repeat(100));
    clock.set(3000); c.write("c", "x".repeat(100)); // quota → evict oldest ("a")
    const persisted = c.ourKeys().map((k) => k.slice(NS.length));
    expect(persisted).toContain("c");
    expect(persisted).not.toContain("a");
    expect(c.read("a")).toBe(null); // dropped from L1 too
  });

  it("trims oldest to stay under the total byte budget", () => {
    const clock = makeClock();
    const c = createGisCache({ store: makeStore(), now: clock, maxTotalBytes: 300, maxEntryBytes: 1000 });
    clock.set(1000); c.write("a", "z".repeat(100));
    clock.set(2000); c.write("b", "z".repeat(100));
    clock.set(3000); c.write("c", "z".repeat(100)); // total ~363 > 300 → drop "a"
    const persisted = c.ourKeys().map((k) => k.slice(NS.length));
    expect(persisted).not.toContain("a");
    expect(persisted).toContain("c");
  });

  it("an oversize entry is served from L1 but never persisted", () => {
    const store = makeStore();
    const c = createGisCache({ store, now: makeClock(), maxEntryBytes: 50 });
    c.write("big", "y".repeat(500));
    expect(c.read("big").data).toBe("y".repeat(500)); // L1 hit
    expect(store.getItem(NS + "big")).toBe(null);     // not on disk
  });

  it("clear() only removes our namespace; foreign keys survive", () => {
    const store = makeStore();
    store.setItem("planarfit:sites:v1", "SITE"); // a Site Planner key — must not be touched
    const c = createGisCache({ store, now: makeClock() });
    c.write("k", [1]);
    c.clear();
    expect(c.read("k")).toBe(null);
    expect(store.getItem("planarfit:sites:v1")).toBe("SITE");
  });
});
