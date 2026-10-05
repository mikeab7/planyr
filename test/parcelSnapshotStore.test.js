/* B2092656 ×3 — a county's parcel saved copy is stored in CHUNKS, never as one IndexedDB value (one value was a
 * 227–254 ms main-thread deserialise per county — Michael's two long frames turning Select parcels on). */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import {
  chunkFeatures, readStoredSnapshot, writeStoredSnapshot,
  snapshotMetaKey, snapshotChunkKey, legacySnapshotKey, SNAPSHOT_CHUNK,
} from "../src/workspaces/site-planner/lib/parcelSnapshotStore.js";

// An in-memory kv with the same contract as localDb (resolves, never rejects).
function memKv() {
  const m = new Map();
  return {
    m,
    get: async (k) => (m.has(k) ? structuredClone(m.get(k)) : null),
    put: async (k, v) => { m.set(k, structuredClone(v)); return true; },
    del: async (k) => { m.delete(k); return true; },
  };
}
const feats = (n) => Array.from({ length: n }, (_, i) => ({ type: "Feature", properties: { prop_id: `P${i}` }, geometry: { type: "Polygon", coordinates: [[[i, 0], [i + 1, 0], [i + 1, 1], [i, 1], [i, 0]]] } }));

describe("chunkFeatures", () => {
  it("splits into chunks of at most `size`, preserving order", () => {
    const c = chunkFeatures(feats(7), 3);
    expect(c.map((x) => x.length)).toEqual([3, 3, 1]);
    expect(c.flat().map((f) => f.properties.prop_id)).toEqual(feats(7).map((f) => f.properties.prop_id));
  });
  it("an empty county is zero chunks", () => { expect(chunkFeatures([], 3)).toEqual([]); });
  it("the default chunk keeps one stored value small (≤ 2,000 lots)", () => { expect(SNAPSHOT_CHUNK).toBeLessThanOrEqual(2000); });
});

describe("write → read round trip", () => {
  it("returns the same features, in order, with the vintage, and no stored value holds more than one chunk", async () => {
    const kv = memKv();
    const f = feats(3500);
    expect(await writeStoredSnapshot("waller", { generatedAt: "v1", count: 3500, bbox: [1, 2, 3, 4], features: f }, { ...kv, size: 1500 })).toBe(true);
    const chunkVals = [...kv.m.entries()].filter(([k]) => k.includes(":chunk:"));
    expect(chunkVals).toHaveLength(3);
    expect(Math.max(...chunkVals.map(([, v]) => v.features.length))).toBe(1500);
    const seen = [];
    const back = await readStoredSnapshot("waller", { get: kv.get, onChunk: (c) => seen.push(c.length) });
    expect(seen).toEqual([1500, 1500, 500]);
    expect(back.generatedAt).toBe("v1");
    expect(back.count).toBe(3500);
    expect(back.bbox).toEqual([1, 2, 3, 4]);
    expect(back.features.map((x) => x.properties.prop_id)).toEqual(f.map((x) => x.properties.prop_id));
  });
  it("a missing copy reads as null", async () => { expect(await readStoredSnapshot("chambers", { get: memKv().get })).toBeNull(); });
});

describe("a half-written or mixed copy is discarded, never assembled", () => {
  it("an interrupted re-write (new chunks, old meta) reads as null", async () => {
    const kv = memKv();
    await writeStoredSnapshot("chambers", { generatedAt: "v1", features: feats(10) }, { ...kv, size: 4 });
    let n = 0;
    const dying = { ...kv, put: async (k, v) => { if (++n > 1) return false; return kv.put(k, v); } }; // first chunk lands, then the write dies
    expect(await writeStoredSnapshot("chambers", { generatedAt: "v2", features: feats(10) }, { ...dying, size: 4 })).toBe(false);
    expect(await readStoredSnapshot("chambers", { get: kv.get })).toBeNull();
  });
  it("a missing chunk reads as null", async () => {
    const kv = memKv();
    await writeStoredSnapshot("chambers", { generatedAt: "v1", features: feats(10) }, { ...kv, size: 4 });
    kv.m.delete(snapshotChunkKey("chambers", 1));
    expect(await readStoredSnapshot("chambers", { get: kv.get })).toBeNull();
  });
});

describe("housekeeping", () => {
  it("a smaller re-write removes the old copy's extra chunks", async () => {
    const kv = memKv();
    await writeStoredSnapshot("waller", { generatedAt: "v1", features: feats(10) }, { ...kv, size: 3 }); // 4 chunks
    await writeStoredSnapshot("waller", { generatedAt: "v2", features: feats(4) }, { ...kv, size: 3 }); // 2 chunks
    expect(kv.m.has(snapshotChunkKey("waller", 2))).toBe(false);
    expect(kv.m.has(snapshotChunkKey("waller", 3))).toBe(false);
    expect((await readStoredSnapshot("waller", { get: kv.get })).features).toHaveLength(4);
  });
  it("the pre-B2092656 ×3 single-value copy is deleted on write (it is never read — reading it IS the long task)", async () => {
    const kv = memKv();
    kv.m.set(legacySnapshotKey("waller"), { features: feats(5) });
    await writeStoredSnapshot("waller", { generatedAt: "v1", features: feats(5) }, kv);
    expect(kv.m.has(legacySnapshotKey("waller"))).toBe(false);
    expect(kv.m.has(snapshotMetaKey("waller"))).toBe(true);
  });
});

describe("source guards", () => {
  const snapSrc = fs.readFileSync(new URL("../src/workspaces/site-planner/lib/parcelSnapshot.js", import.meta.url), "utf8");
  const mapSrc = fs.readFileSync(new URL("../src/workspaces/site-planner/MapFinder.jsx", import.meta.url), "utf8");
  it("parcelSnapshot.js no longer stores or reads a whole county as ONE IndexedDB value", () => {
    expect(snapSrc).not.toMatch(/idbGet\(|idbPut\(/);
  });
  it("entering select mode does not warm every saved copy; only counties in view are warmed", () => {
    expect(mapSrc).not.toMatch(/CLIENT_SNAPSHOT_COUNTIES\.forEach\(\(c\) => \{ ensureSnapshot\(c\)/);
    expect(mapSrc).toMatch(/if \(!want\.has\(c\) \|\| snapshotsWarmedRef\.current\.has\(c\)\) return;/);
  });
});
