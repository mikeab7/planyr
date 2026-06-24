import { describe, it, expect } from "vitest";
import {
  createImageCache,
  planEviction,
  blobBytes,
  formatAge,
} from "../src/workspaces/site-planner/lib/gisImageCache.js";

// An in-memory async blob store (the same shape the IndexedDB adapter exposes) + a
// controllable clock, so the imagery SWR cache tests are deterministic with no IndexedDB
// and no network. "Blobs" here are plain { size } stand-ins — the cache only reads .size.
function makeStore() {
  const map = new Map();
  return {
    _map: map,
    get: async (k) => (map.has(k) ? map.get(k) : null),
    set: async (k, v) => { map.set(k, v); },
    delete: async (k) => { map.delete(k); },
    entries: async () => Array.from(map.entries()).map(([key, v]) => ({ key, ts: v.ts, bytes: v.bytes })),
  };
}
const blob = (size) => ({ size });

describe("blobBytes", () => {
  it("reads Blob.size and ArrayBuffer.byteLength, 0 otherwise", () => {
    expect(blobBytes({ size: 1234 })).toBe(1234);
    expect(blobBytes({ byteLength: 99 })).toBe(99);
    expect(blobBytes(null)).toBe(0);
    expect(blobBytes({})).toBe(0);
  });
});

describe("planEviction", () => {
  it("returns nothing when under budget", () => {
    const e = [{ key: "a", ts: 1, bytes: 10 }, { key: "b", ts: 2, bytes: 10 }];
    expect(planEviction(e, 100)).toEqual([]);
  });
  it("drops oldest-first until under budget", () => {
    const e = [
      { key: "new", ts: 300, bytes: 40 },
      { key: "old", ts: 100, bytes: 40 },
      { key: "mid", ts: 200, bytes: 40 },
    ];
    // total 120 > 100 → drop oldest (old, 40) → 80 ≤ 100, stop
    expect(planEviction(e, 100)).toEqual(["old"]);
  });
  it("can drop several when far over budget", () => {
    const e = [
      { key: "a", ts: 1, bytes: 50 },
      { key: "b", ts: 2, bytes: 50 },
      { key: "c", ts: 3, bytes: 50 },
    ];
    expect(planEviction(e, 50)).toEqual(["a", "b"]); // 150 → drop a (100) → drop b (50) ≤ 50
  });
});

describe("createImageCache", () => {
  it("writes then reads a blob with an age", async () => {
    let t = 1000;
    const cache = createImageCache({ store: makeStore(), now: () => t });
    await cache.write("k", blob(200));
    t = 6000;
    const got = await cache.read("k");
    expect(got.blob.size).toBe(200);
    expect(got.ts).toBe(1000);
    expect(got.ageMs).toBe(5000);
  });

  it("skips a single oversize image (keeps live-only)", async () => {
    const cache = createImageCache({ store: makeStore(), now: () => 1, maxEntryBytes: 100 });
    const w = await cache.write("big", blob(500));
    expect(w.stored).toBe(false);
    expect(await cache.read("big")).toBe(null);
  });

  it("enforces the total byte budget oldest-first on write", async () => {
    const store = makeStore();
    let t = 0;
    const cache = createImageCache({ store, now: () => t, maxTotalBytes: 100, maxEntryBytes: 1000 });
    t = 1; await cache.write("a", blob(60));
    t = 2; await cache.write("b", blob(60)); // total 120 > 100 → evict oldest (a)
    expect(await cache.read("a")).toBe(null);
    expect((await cache.read("b")).blob.size).toBe(60);
    expect(await cache.totalBytes()).toBe(60);
  });

  it("swr: serves nothing then fetches+stores when empty", async () => {
    const cache = createImageCache({ store: makeStore(), now: () => 10 });
    const { cached, stale, fresh } = await cache.swr("k", async () => blob(300), { ttl: 1000 });
    expect(cached).toBe(null);
    expect(stale).toBe(true);
    const r = await fresh;
    expect(r.updated).toBe(true);
    expect(r.blob.size).toBe(300);
    expect((await cache.read("k")).blob.size).toBe(300);
  });

  it("swr: serves a fresh cached blob WITHOUT refetching", async () => {
    let t = 0;
    const cache = createImageCache({ store: makeStore(), now: () => t });
    t = 100; await cache.write("k", blob(50));
    t = 200; // age 100 < ttl 5000 ⇒ fresh
    let fetched = false;
    const { cached, stale, fresh } = await cache.swr("k", async () => { fetched = true; return blob(99); }, { ttl: 5000 });
    expect(cached.blob.size).toBe(50);
    expect(stale).toBe(false);
    const r = await fresh;
    expect(r.updated).toBe(false);
    expect(fetched).toBe(false);
  });

  it("swr: a failed refresh keeps the cached copy and surfaces the error", async () => {
    let t = 0;
    const cache = createImageCache({ store: makeStore(), now: () => t });
    t = 100; await cache.write("k", blob(50));
    t = 99999; // now stale
    const { cached, stale, fresh } = await cache.swr("k", async () => { throw new Error("server down"); }, { ttl: 1000 });
    expect(cached.blob.size).toBe(50);
    expect(stale).toBe(true);
    const r = await fresh;
    expect(r.updated).toBe(false);
    expect(r.error).toBeInstanceOf(Error);
    expect(r.blob.size).toBe(50); // last-good retained
  });

  it("degrades to live-only with no store (null store)", async () => {
    const cache = createImageCache({ store: null, now: () => 1 });
    expect(await cache.read("k")).toBe(null);
    const w = await cache.write("k", blob(10));
    expect(w.stored).toBe(false);
    const { cached, fresh } = await cache.swr("k", async () => blob(10), { ttl: 1000 });
    expect(cached).toBe(null);
    expect((await fresh).updated).toBe(true); // still fetches, just doesn't persist
  });

  it("reuses gisCache formatAge for the age label", () => {
    expect(formatAge(5000)).toBe("just now");
    expect(formatAge(120000)).toBe("2m ago");
  });
});
