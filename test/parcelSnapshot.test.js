import { describe, it, expect, beforeEach } from "vitest";
import {
  featureBbox, featuresForView, featureAtPoint,
  ensureSnapshot, getSnapshot, snapshotVintage, _resetSnapshots,
  preferSnapshotForDisplay,
} from "../src/workspaces/site-planner/lib/parcelSnapshot.js";
import { COUNTIES, STATEWIDE_PARCEL_LAYER } from "../src/workspaces/site-planner/lib/counties.js";

// A GeoJSON polygon Feature: an axis-aligned square centered at (lng,lat), half-size h, + props.
const sq = (lng, lat, h, props = {}) => ({
  type: "Feature",
  properties: props,
  geometry: { type: "Polygon", coordinates: [[[lng - h, lat - h], [lng + h, lat - h], [lng + h, lat + h], [lng - h, lat + h], [lng - h, lat - h]]] },
});

const round5 = (b) => b.map((n) => Math.round(n * 1e5) / 1e5); // kill float dust for exact compare
describe("featureBbox", () => {
  it("computes [minLng,minLat,maxLng,maxLat] for a Polygon", () => {
    expect(round5(featureBbox(sq(-94.9, 29.8, 0.01)))).toEqual([-94.91, 29.79, -94.89, 29.81]);
  });
  it("handles a MultiPolygon (two separate tracts)", () => {
    const mp = { type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: [
      sq(-95, 30, 0.01).geometry.coordinates, sq(-94.9, 30.05, 0.02).geometry.coordinates,
    ] } };
    expect(round5(featureBbox(mp))).toEqual([-95.01, 29.99, -94.88, 30.07]);
  });
  it("returns null for missing/degenerate geometry", () => {
    expect(featureBbox(null)).toBeNull();
    expect(featureBbox({ type: "Feature", properties: {} })).toBeNull();
    expect(featureBbox({ geometry: { type: "Point", coordinates: [1, 2] } })).toBeNull();
  });
});

describe("featuresForView — viewport bbox filter", () => {
  const feats = [sq(-94.9, 29.8, 0.005, { id: "A" }), sq(-95.5, 29.5, 0.005, { id: "B" }), sq(-94.89, 29.81, 0.005, { id: "C" })];
  it("keeps only features intersecting the view", () => {
    const inView = featuresForView(feats, { w: -94.92, s: 29.78, e: -94.87, n: 29.83 }).map((f) => f.properties.id);
    expect(inView.sort()).toEqual(["A", "C"]); // B is far southwest
  });
  it("returns everything when bounds is null", () => {
    expect(featuresForView(feats, null)).toHaveLength(3);
  });
});

describe("featureAtPoint — the click hit-test", () => {
  it("returns the containing parcel as an esri {geometry:{rings},attributes} feature", () => {
    const feats = [sq(-94.9, 29.8, 0.01, { PROP_ID: "55173", county: "CHAMBERS" })];
    const hit = featureAtPoint(feats, -94.9, 29.8);
    expect(hit).toBeTruthy();
    expect(hit.attributes.PROP_ID).toBe("55173");
    expect(Array.isArray(hit.geometry.rings)).toBe(true);
    expect(hit.geometry.rings[0].length).toBeGreaterThanOrEqual(4);
  });
  it("returns null when the point is outside every parcel", () => {
    expect(featureAtPoint([sq(-94.9, 29.8, 0.01)], -90, 29)).toBeNull();
  });
  it("prefers the TIGHTEST lot when parcels overlap (parity with optimisticHitAt)", () => {
    // a big tract + a small lot, both containing the point → the small lot wins
    const big = sq(-94.9, 29.8, 0.05, { id: "big" });
    const small = sq(-94.9, 29.8, 0.004, { id: "small" });
    expect(featureAtPoint([big, small], -94.9, 29.8).attributes.id).toBe("small");
    expect(featureAtPoint([small, big], -94.9, 29.8).attributes.id).toBe("small"); // order-independent
  });
});

// --- IO: ensureSnapshot download / SWR / version-compare (injected fetch; IndexedDB is a no-op
//     in Node so this exercises the in-memory registry + refresh logic) ---
describe("ensureSnapshot — download, hold, and SWR-refresh only when Drive is newer", () => {
  beforeEach(() => _resetSnapshots());

  // A fake parcel-cache endpoint: `?meta=1` → meta, else the FeatureCollection.
  const stub = (meta, fc, spy) => async (url) => {
    if (spy) spy(url);
    const body = /meta=1/.test(url) ? meta : fc;
    return { ok: true, json: async () => body };
  };
  const fc = (ids) => ({ type: "FeatureCollection", features: ids.map((id) => ({ type: "Feature", properties: { PROP_ID: id }, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } })) });

  it("downloads and holds a snapshot in memory; vintage reflects the meta", async () => {
    const snap = await ensureSnapshot("chambers", { fetchImpl: stub({ cached: true, generatedAt: "2026-07-03T00:00:00Z", count: 2 }, fc(["a", "b"])) });
    expect(snap).toBeTruthy();
    expect(getSnapshot("chambers").features).toHaveLength(2);
    expect(snapshotVintage("chambers")).toEqual({ asOf: "2026-07-03T00:00:00Z", count: 2 });
  });

  it("does NOT re-download when the Drive vintage is unchanged", async () => {
    const calls = [];
    const impl = stub({ cached: true, generatedAt: "v1", count: 1 }, fc(["a"]), (u) => calls.push(u));
    await ensureSnapshot("chambers", { fetchImpl: impl });
    const before = calls.length;
    await ensureSnapshot("chambers", { fetchImpl: impl }); // same generatedAt → meta check only, no full re-fetch
    const afterMeta = calls.filter((u) => /meta=1/.test(u)).length;
    const afterFull = calls.filter((u) => !/meta=1/.test(u)).length;
    expect(calls.length).toBeGreaterThan(before); // it did re-check meta
    expect(afterFull).toBe(1); // but downloaded the full FC only once
  });

  it("re-downloads when Drive has a NEWER vintage", async () => {
    await ensureSnapshot("chambers", { fetchImpl: stub({ cached: true, generatedAt: "v1", count: 1 }, fc(["a"])) });
    await ensureSnapshot("chambers", { fetchImpl: stub({ cached: true, generatedAt: "v2", count: 3 }, fc(["a", "b", "c"])) });
    expect(getSnapshot("chambers").features).toHaveLength(3);
    expect(snapshotVintage("chambers").asOf).toBe("v2");
  });

  it("no snapshot on Drive (cached:false) → nothing loaded", async () => {
    const snap = await ensureSnapshot("waller", { fetchImpl: stub({ cached: false }, null) });
    expect(snap).toBeNull();
    expect(getSnapshot("waller")).toBeNull();
  });

  it("ignores a non-snapshot county", async () => {
    expect(await ensureSnapshot("harris", { fetchImpl: async () => { throw new Error("should not fetch"); } })).toBeNull();
  });
});

// preferSnapshotForDisplay decides whether the Drive snapshot is the DISPLAYED outline
// source or just a click/outage fallback (B783). A staler harvested snapshot must NOT
// shadow a live queryable CAD (the exact B783 complaint), but SHOULD back an image-only
// statewide source (whose /query is disabled, so its vector layer draws nothing).
describe("preferSnapshotForDisplay — snapshot shows only when the live source can't draw current selectable outlines (B783)", () => {
  it("prefers the snapshot for an image-only statewide (TxGIO) live source — Waller", () => {
    expect(preferSnapshotForDisplay({ hasSnapshot: true, liveUrl: STATEWIDE_PARCEL_LAYER })).toBe(true);
    // and matches the actual Waller config, which rides the statewide layer
    expect(preferSnapshotForDisplay({ hasSnapshot: true, liveUrl: COUNTIES.waller.layerUrl })).toBe(true);
  });

  it("does NOT prefer the snapshot for a queryable CAD — Chambers on CCAD draws its own current vectors", () => {
    expect(preferSnapshotForDisplay({ hasSnapshot: true, liveUrl: COUNTIES.chambers.layerUrl })).toBe(false);
    expect(COUNTIES.chambers.layerUrl).toMatch(/ChambersCADPublic/); // guards the repoint
  });

  it("never prefers the snapshot when none is loaded, or before the live URL is known", () => {
    expect(preferSnapshotForDisplay({ hasSnapshot: false, liveUrl: STATEWIDE_PARCEL_LAYER })).toBe(false);
    expect(preferSnapshotForDisplay({ hasSnapshot: true, liveUrl: undefined })).toBe(false);
    expect(preferSnapshotForDisplay({})).toBe(false);
  });

  it("tolerates a trailing slash on the live URL (URL-equality, trimmed)", () => {
    expect(preferSnapshotForDisplay({ hasSnapshot: true, liveUrl: STATEWIDE_PARCEL_LAYER + "/" })).toBe(true);
  });
});
