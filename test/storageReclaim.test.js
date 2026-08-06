/* The storage census + reclaim tier (NEW-1/NEW-2/NEW-3, B1427–B1429).
 *
 * The load-bearing test in this file is the LAST describe block: no eviction may ever cost the
 * owner data that cannot be rebuilt. B474 recorded that hazard exactly — "a raster whose src had
 * been dropped (idbKey set) was then unrecoverable" — so a raster with NO cloud copy is the
 * subject of its own case, and it must survive every reclaim path at any pressure.
 */
import { describe, it, expect } from "vitest";
import {
  LOCAL_CLASSES, IDB_CLASSES, REBUILD, LOCAL_CAP_BYTES,
  classifyLocalKey, classifyIdbKey, censusLocalStorage, censusIndexedDb,
  estimateQuota, storageSnapshot, telemetryFacts, formatBytes,
} from "../src/shared/storage/storageCensus.js";
import {
  reclaimableClasses, unprovenReclaimables, reclaimLocalStorage,
  reclaimRefetchable, reclaimThenRetry, reclaimMessage, CACHE_IDB_PREFIX,
} from "../src/shared/storage/storageReclaim.js";
import { IDB_NS, NS } from "../src/workspaces/site-planner/lib/gisCache.js";

function makeStore(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.delete(k); m.set(k, v); },
    removeItem: (k) => m.delete(k),
    _map: m,
  };
}
// A stand-in for localDb's idbForEachByPrefix over a plain Map.
const walkerFor = (map) => async (prefix, fn) => {
  let n = 0;
  for (const [k, v] of map) { if (!prefix || String(k).indexOf(prefix) === 0) { n++; fn(k, v); } }
  return n;
};

describe("storageCensus — classification", () => {
  it("puts the version ring in its own class, not with the plans (order matters)", () => {
    expect(classifyLocalKey("planarfit:sites:history:v1").id).toBe("history");
    expect(classifyLocalKey("planarfit:sites:v1").id).toBe("plans");
    expect(classifyLocalKey("planarfit:sites:cloud:u1").id).toBe("plans");
    expect(classifyLocalKey("planarfit:autosave:v1").id).toBe("plans");
  });

  it("classifies the re-fetchable map caches and nothing else as map data", () => {
    expect(classifyLocalKey("planyr:giscache:v1:terrain:dem:L16:-4364,1421").id).toBe("mapdata");
    expect(classifyLocalKey("planarfit:layerExtent:v1").id).toBe("mapdata");
    expect(classifyLocalKey("planarfit:roadWidth").id).toBe("settings");
    expect(classifyLocalKey("something-else").id).toBe("other");
  });

  it("classifies the IndexedDB namespaces", () => {
    expect(classifyIdbKey("giscache:v1:terrain:x").id).toBe("mapdata");
    expect(classifyIdbKey("raster:site1:underlay").id).toBe("rasters");
    expect(classifyIdbKey("planarfit:sites:history:v1").id).toBe("history");
  });
});

describe("storageCensus — localStorage byte census", () => {
  it("totals by class, counts keys, and names the largest keys", () => {
    const store = makeStore({
      "planarfit:sites:cloud:u1": "p".repeat(2000),
      "planarfit:sites:history:v1": "h".repeat(1000),
      "planyr:giscache:v1:terrain:a": "t".repeat(500),
      "planyr:giscache:v1:terrain:b": "t".repeat(300),
      "planarfit:roadWidth": "60",
    });
    const c = censusLocalStorage(store);
    expect(c.keyCount).toBe(5);
    expect(c.capBytes).toBe(LOCAL_CAP_BYTES);
    const byId = Object.fromEntries(c.classes.map((x) => [x.id, x.bytes]));
    expect(byId.plans).toBeGreaterThan(2000);
    expect(byId.history).toBeGreaterThan(1000);
    expect(byId.mapdata).toBeGreaterThan(800);
    expect(c.classes[0].id).toBe("plans");           // sorted biggest-first
    expect(c.largest[0].key).toBe("planarfit:sites:cloud:u1");
    expect(c.totalBytes).toBe(c.classes.reduce((n, x) => n + x.bytes, 0));
  });

  it("reports an honest empty census with no store, and never throws", () => {
    const c = censusLocalStorage(null);
    expect(c).toMatchObject({ supported: false, totalBytes: 0, keyCount: 0 });
    expect(c.classes).toEqual([]);
  });
});

describe("storageCensus — the two tiers are reported SEPARATELY and never summed", () => {
  it("storageSnapshot keeps local and idb as distinct objects with distinct ceilings", async () => {
    const store = makeStore({ "planarfit:sites:v1": "p".repeat(1000) });
    const idb = new Map([["giscache:v1:a", "x".repeat(2000)], ["raster:s1:underlay", "y".repeat(9000)]]);
    const nav = { storage: { estimate: async () => ({ usage: 37_000_000, quota: 10_775_000_000 }), persisted: async () => true } };
    const snap = await storageSnapshot({ store, walk: walkerFor(idb), nav });
    expect(snap.local.totalBytes).toBeGreaterThan(1000);
    expect(snap.local.capBytes).toBe(LOCAL_CAP_BYTES);
    expect(snap.idb.usageBytes).toBe(37_000_000);
    expect(snap.idb.quotaBytes).toBe(10_775_000_000);
    expect(snap.idb.persisted).toBe(true);
    // The invariant, stated directly: there is no combined total anywhere in the shape.
    expect(Object.keys(snap)).toEqual(["local", "idb"]);
    expect(snap.total).toBeUndefined();
    expect(snap.usageBytes).toBeUndefined();
  });

  it("telemetryFacts labels every number with its tier and reports both percentages", async () => {
    const store = makeStore({ "planarfit:sites:v1": "p".repeat(1024 * 1024) }); // ~1 MB of plans
    const idb = new Map([["giscache:v1:a", "x".repeat(2000)]]);
    const nav = { storage: { estimate: async () => ({ usage: 35_900_000, quota: 10_275_900_000 }), persisted: async () => true } };
    const f = telemetryFacts(await storageSnapshot({ store, walk: walkerFor(idb), nav }));
    expect(f.local_pct).toBeGreaterThan(15);
    expect(f.idb_pct).toBe(0);           // the measured reality: 0.3% rounds to 0
    expect(f.local_plans).toBeGreaterThan(1_000_000);
    expect(f.idb_mapdata).toBeGreaterThan(2000);
    expect(f.idb_persisted).toBe(true);
    // Tier-labelled: no bare key could be mistaken for a combined figure.
    for (const k of Object.keys(f)) expect(k.startsWith("local_") || k.startsWith("idb_")).toBe(true);
  });

  it("estimateQuota degrades honestly when the browser doesn't support it", async () => {
    expect(await estimateQuota({})).toMatchObject({ supported: false, usageBytes: null, quotaBytes: null });
    expect(await estimateQuota({ storage: { estimate: async () => { throw new Error("no"); } } })).toMatchObject({ supported: false });
  });

  it("censusIndexedDb measures per class through one cursor pass", async () => {
    const idb = new Map([
      ["giscache:v1:a", "x".repeat(1000)],
      ["giscache:v1:b", "x".repeat(500)],
      ["raster:s1:underlay", "y".repeat(9000)],
      ["planarfit:sites:history:v1", "h".repeat(400)],
    ]);
    const c = await censusIndexedDb(walkerFor(idb));
    const byId = Object.fromEntries(c.classes.map((x) => [x.id, x.bytes]));
    expect(byId.rasters).toBeGreaterThan(9000);
    expect(byId.mapdata).toBeGreaterThan(1500);
    expect(byId.history).toBeGreaterThan(400);
    expect(c.keyCount).toBe(4);
  });
});

describe("storageReclaim — only provably rebuildable data is ever removed", () => {
  it("every reclaimable class declares a rehydration source", () => {
    expect(unprovenReclaimables(LOCAL_CLASSES)).toEqual([]);
    expect(unprovenReclaimables(IDB_CLASSES)).toEqual([]);
    expect(reclaimableClasses(LOCAL_CLASSES).map((c) => c.id)).toEqual(["mapdata"]);
    expect(reclaimableClasses(IDB_CLASSES).map((c) => c.id)).toEqual(["mapdata"]);
    for (const c of reclaimableClasses([...LOCAL_CLASSES, ...IDB_CLASSES])) expect(c.rebuild).toBe(REBUILD.GIS);
  });

  /* The shared reclaim path cannot import gisCache (that hoists the whole cache into a chunk every
   * route downloads — three budget breaches, measured), so it names the cache's namespaces by
   * literal. These assertions are what stop a rename silently orphaning the reclaim. */
  it("the duplicated namespace literals still agree with the cache's own", () => {
    expect(IDB_NS.startsWith(CACHE_IDB_PREFIX)).toBe(true);
    expect(classifyIdbKey(IDB_NS + "terrain:a").id).toBe("mapdata");
    expect(classifyLocalKey(NS + "terrain:a").id).toBe("mapdata");
  });

  it("clears the cache's IndexedDB namespace by prefix when no live cache is handed in", async () => {
    const seen = [];
    const r = await reclaimRefetchable({
      store: makeStore({ "planarfit:sites:v1": "PLANS" }),
      deletePrefix: async (p) => { seen.push(p); return { bytes: 12_345, keys: 3 }; },
    });
    expect(seen).toEqual([CACHE_IDB_PREFIX]);   // ONE prefix, and only the re-fetchable one
    expect(r.freedCacheBytes).toBe(12_345);
  });

  it("frees the map cache and leaves plans, history and settings untouched", () => {
    const store = makeStore({
      "planarfit:sites:cloud:u1": "PLANS",
      "planarfit:sites:history:v1": "HISTORY",
      "planarfit:roadWidth": "60",
      "planyr:giscache:v1:terrain:a": JSON.stringify({ data: "a", ts: 1000 }),
      "planarfit:layerExtent:v1": "EXTENTS",
    });
    const r = reclaimLocalStorage(store);
    expect(r.removedKeys).toBe(2);
    expect(r.byClass.mapdata).toBeGreaterThan(0);
    expect(store.getItem("planarfit:sites:cloud:u1")).toBe("PLANS");
    expect(store.getItem("planarfit:sites:history:v1")).toBe("HISTORY");
    expect(store.getItem("planarfit:roadWidth")).toBe("60");
    expect(store.getItem("planyr:giscache:v1:terrain:a")).toBe(null);
  });

  it("evicts OLDEST first and stops once enough has been freed", () => {
    const store = makeStore({
      "planyr:giscache:v1:new": JSON.stringify({ data: "n".repeat(100), ts: 9000 }),
      "planyr:giscache:v1:old": JSON.stringify({ data: "o".repeat(100), ts: 1000 }),
      "planyr:giscache:v1:mid": JSON.stringify({ data: "m".repeat(100), ts: 5000 }),
    });
    const r = reclaimLocalStorage(store, { limitBytes: 1 }); // one key is enough
    expect(r.removedKeys).toBe(1);
    expect(store.getItem("planyr:giscache:v1:old")).toBe(null);  // the oldest went
    expect(store.getItem("planyr:giscache:v1:new")).not.toBe(null);
    expect(store.getItem("planyr:giscache:v1:mid")).not.toBe(null);
  });

  it("reclaimRefetchable clears both the small store and the cache tier, reporting each", async () => {
    const store = makeStore({ "planyr:giscache:v1:a": JSON.stringify({ data: "x".repeat(400), ts: 1 }), "planarfit:sites:v1": "PLANS" });
    const cache = { clear: () => 2_000_000, ready: async () => {} };
    const r = await reclaimRefetchable({ store, cache });
    expect(r.ok).toBe(true);
    expect(r.freedLocalBytes).toBeGreaterThan(400);
    expect(r.freedCacheBytes).toBe(2_000_000);
    expect(store.getItem("planarfit:sites:v1")).toBe("PLANS");
  });
});

describe("storageReclaim — reclaimThenRetry: the button can now actually succeed (NEW-2)", () => {
  const cacheOf = (bytes) => ({ clear: () => bytes, ready: async () => {} });

  it("frees room, retries, and reports 'saved' with what it freed", async () => {
    const store = makeStore({ "planyr:giscache:v1:a": JSON.stringify({ data: "x".repeat(3000), ts: 1 }) });
    let attempts = 0;
    const save = () => { attempts++; return store.getItem("planyr:giscache:v1:a") == null; }; // fits once the cache is gone
    const r = await reclaimThenRetry({ store, cache: cacheOf(0), save });
    expect(attempts).toBe(1);
    expect(r.outcome).toBe("saved");
    expect(r.saved).toBe(true);
    expect(r.freedLocalBytes).toBeGreaterThan(3000);
    expect(r.localAfter).toBeLessThan(r.localBefore);
    expect(reclaimMessage(r, formatBytes)).toMatch(/Saved on this device/);
  });

  it("says STILL FULL rather than failing silently back into the same banner", async () => {
    const store = makeStore({ "planyr:giscache:v1:a": JSON.stringify({ data: "x".repeat(3000), ts: 1 }) });
    const r = await reclaimThenRetry({ store, cache: cacheOf(1000), save: () => false });
    expect(r.outcome).toBe("still-full");
    expect(r.saved).toBe(false);
    expect(r.freedLocalBytes + r.freedCacheBytes).toBeGreaterThan(3000);
    expect(reclaimMessage(r, formatBytes)).toMatch(/still won't fit/);
    expect(reclaimMessage(r, formatBytes)).toMatch(/safe in your account/);
  });

  it("distinguishes 'nothing left to free' from 'freed some and it still failed'", async () => {
    const store = makeStore({ "planarfit:sites:v1": "PLANS" }); // nothing reclaimable at all
    const r = await reclaimThenRetry({ store, cache: cacheOf(0), save: () => false });
    expect(r.outcome).toBe("nothing-to-free");
    expect(r.freedLocalBytes).toBe(0);
    expect(reclaimMessage(r, formatBytes)).toMatch(/no map data left to clear/);
  });

  it("a save that throws is a failure, never a claimed success", async () => {
    const store = makeStore({});
    const r = await reclaimThenRetry({ store, cache: cacheOf(0), save: () => { throw new Error("quota"); } });
    expect(r.saved).toBe(false);
    expect(r.outcome).toBe("nothing-to-free");
  });

  it("reports 'saved-clean' when the write succeeds and nothing needed freeing", async () => {
    const r = await reclaimThenRetry({ store: makeStore({}), cache: cacheOf(0), save: () => true });
    expect(r.outcome).toBe("saved-clean");
    expect(reclaimMessage(r, formatBytes)).toBe("Saved on this device ✓");
  });
});

describe("⛔ THE HARD CONSTRAINT — a raster with NO cloud copy is never evicted (B474)", () => {
  /* B474: "a raster whose src had been dropped (idbKey set) was then unrecoverable." A raster that
   * carries a `storageKey` has a copy in the account; one that carries only an `idbKey` is the
   * user's ONLY copy of that image. The key alone cannot tell you which — so the whole class
   * declares no rehydration source, is never reclaimable, and no pressure changes that. */
  it("the reference-image class declares NO rehydration source and is not reclaimable", () => {
    const rasters = IDB_CLASSES.find((c) => c.id === "rasters");
    expect(rasters.rebuild).toBe(REBUILD.NONE);
    expect(rasters.reclaimable).toBe(false);
    expect(reclaimableClasses(IDB_CLASSES).map((c) => c.id)).not.toContain("rasters");
  });

  it("a raster with no cloud copy survives a full reclaim under maximum pressure", async () => {
    // The dangerous record: stashed in IndexedDB, NO storageKey, so nothing on earth can put it back.
    const idb = new Map([
      ["raster:site1:underlay", "data:image/png;base64,".concat("Z".repeat(50_000))], // idbKey only
      ["giscache:v1:terrain:a", JSON.stringify({ data: "x".repeat(4000), ts: 1 })],
    ]);
    const store = makeStore({
      "planyr:giscache:v1:terrain:a": JSON.stringify({ data: "x".repeat(4000), ts: 1 }),
      "planarfit:sites:v1": JSON.stringify({ s1: { id: "s1", underlay: { idbKey: "raster:site1:underlay", src: null } } }),
    });
    // A cache whose clear() only ever touches its OWN namespace (what gisCache.clear does).
    const cache = { ready: async () => {}, clear: () => { const had = idb.has("giscache:v1:terrain:a"); idb.delete("giscache:v1:terrain:a"); return had ? 4000 : 0; } };

    const r = await reclaimRefetchable({ store, cache, limitBytes: Infinity });
    expect(r.ok).toBe(true);
    expect(r.freedLocalBytes).toBeGreaterThan(0);           // it DID free the safe things…
    expect(idb.has("giscache:v1:terrain:a")).toBe(false);   // …including the cache tier…
    expect(idb.get("raster:site1:underlay")).toBeTruthy();  // …and it did NOT touch the only copy.
    expect(store.getItem("planarfit:sites:v1")).toBeTruthy(); // nor the record that points at it
  });

  it("a class marked reclaimable with no rebuild source aborts the whole pass — nothing is removed", async () => {
    // Simulate a future edit that flips a class reclaimable without giving it a way back. The
    // guard must refuse rather than delete, because the failure mode is unrecoverable data loss.
    const rogue = { id: "rasters", label: "Reference images", rebuild: null, reclaimable: true, match: () => true };
    expect(unprovenReclaimables([rogue])).toEqual(["rasters"]);
    expect(reclaimableClasses([rogue])).toEqual([]);        // never acted on, even so marked
  });
});

describe("storageCensus — formatBytes", () => {
  it("uses binary units with one decimal below ten", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(3.88 * 1024 * 1024)).toBe("3.9 MB");
    expect(formatBytes(35.9 * 1024 * 1024)).toBe("36 MB");
    expect(formatBytes(10_275.9 * 1024 * 1024)).toBe("10 GB");
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(-1)).toBe("—");
  });
});
