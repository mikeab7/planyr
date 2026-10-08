/* NEW-1 (owner decision 2026-10-05) — the SAVED COPY (Drive parcel snapshot) numbers its lots with the SAME
 * account the live county CAD shows, so a lot reads one number whether the county server is up or down.
 *
 * Measured the same day: the state record Planyr's Chambers snapshot is built from carries the real CAD account
 * in GEO_ID — lot 15835 (-94.8695, 29.8222): PROP_ID "15835" (the county parcel number) AND GEO_ID
 * "00321-02000-00100-100001", identical to the live `ChambersCADWeb.DBO.Accounts.Account`. The snapshot's own
 * features (fetched from /api/parcel-cache/svc/chambers) carry that attribute — this test uses that record verbatim.
 * RED on main: the saved copy drew outlines only (no numbers), and `snapshotLotNumberField` did not exist. */
import { describe, it, expect, vi, beforeEach } from "vitest";

const rec = vi.hoisted(() => ({ markers: [], groups: [], frames: [] }));

vi.mock("esri-leaflet", () => ({
  featureLayer: () => ({ options: {}, on() {}, off() {} }),
  dynamicMapLayer: () => ({ options: {}, on() {}, off() {} }),
}));
vi.mock("leaflet", () => {
  const L = {
    canvas: () => ({ remove() {} }),
    point: (x, y) => ({ x, y }),
    latLng: (lat, lng) => ({ lat, lng }),
    divIcon: (o) => o,
    layerGroup: () => {
      const g = { addTo() { rec.groups.push(g); return g; }, clearLayers() { rec.markers.length = 0; }, addLayer(m) { rec.markers.push(m); } };
      return g;
    },
    marker: (ll, o) => { const m = { ll, o, addTo(g) { g.addLayer(m); return m; } }; return m; },
    geoJSON: () => {
      const h = {};
      const lyr = {
        _map: null, data: [],
        on(ev, fn) { (h[ev] = h[ev] || []).push(fn); return lyr; },
        off() { return lyr; },
        fire(ev) { (h[ev] || []).slice().forEach((f) => f()); },
        addData(fc) { lyr.data.push(...fc.features); },
        clearLayers() { lyr.data.length = 0; },
      };
      return lyr;
    },
    latLngBounds: () => ({}),
    // B2092656 ×3 — the saved copy is now a plain Layer drawn by per-tile canvases (as the live outlines are), not an L.geoJSON.
    Layer: { extend: (proto) => {
      const C = function (...args) { this._h = {}; if (this.initialize) this.initialize(...args); };
      Object.assign(C.prototype, {
        on(ev, fn) { (this._h[ev] = this._h[ev] || []).push(fn); return this; },
        off() { return this; },
        fire(ev) { (this._h[ev] || []).slice().forEach((f) => f()); return this; },
      }, proto);
      return C;
    } },
    GridLayer: { extend: (proto) => { const C = function () {}; Object.assign(C.prototype, { addTo() { return this; }, remove() {}, getTileSize: () => ({ x: 512, y: 512 }) }, proto); return C; } },
    Util: { requestAnimFrame: (fn) => { rec.frames.push(fn); return rec.frames.length; }, cancelAnimFrame() {} },
  };
  return { default: L };
});

import { makeSnapshotLayer } from "../src/workspaces/site-planner/lib/parcelDisplay.js";
import { ensureSnapshot } from "../src/workspaces/site-planner/lib/parcelSnapshot.js";
import { snapshotLotNumberField, SNAPSHOT_COUNTIES } from "../src/workspaces/site-planner/lib/counties.js";
import { lotNumberText } from "../src/workspaces/site-planner/lib/parcelLotNumbers.js";

// Lot 15835, attributes verbatim from the deployed Chambers snapshot (GET /api/parcel-cache/svc/chambers).
const LOT_15835 = { objectid: "1465940", PROP_ID: "15835", GEO_ID: "00321-02000-00100-100001", OWNER_NAME: "BALLIS JOHN", LEGAL_AREA: "10.6945", GIS_AREA: "10.737824", LAND_VALUE: "2138900", IMP_VALUE: "0", MKT_VALUE: "2138900", SITUS_ADDR: ", MONT BELVIEU, TX 77523", COUNTY: "CHAMBERS", YEAR_BUILT: "Null", STAT_LAND_USE: "Null" };
const rect = (w, s, e, n) => [[[w, s], [e, s], [e, n], [w, n], [w, s]]];
const LNG = -94.8695, LAT = 29.8222, D = 0.0022; // a lot ~260 px across on the fake map below
const feature = (props, off = 0) => ({ type: "Feature", id: props.PROP_ID, properties: props, geometry: { type: "Polygon", coordinates: rect(LNG + off, LAT, LNG + off + D, LAT + D * 0.6) } });

// A linear fake map: 120,000 world-px per degree, 800×600 view whose NW corner sits just above-left of the lot.
const SCALE = 120000, NW = { lng: LNG - 0.001, lat: LAT + 0.003 };
const px = (lng, lat) => ({ x: (lng + 180) * SCALE, y: (90 - lat) * SCALE });
function fakeMap(zoom = 17) {
  const min = px(NW.lng, NW.lat);
  const map = {
    getZoom: () => zoom,
    getBounds: () => ({ getWest: () => NW.lng, getEast: () => NW.lng + 800 / SCALE, getSouth: () => NW.lat - 600 / SCALE, getNorth: () => NW.lat }),
    getPixelBounds: () => ({ min }),
    getSize: () => ({ x: 800, y: 600 }),
    project: (ll) => px(ll.lng, ll.lat),
    unproject: (pt) => ({ lng: pt.x / SCALE - 180, lat: 90 - pt.y / SCALE }),
    containerPointToLatLng: (pt) => ({ lng: (pt.x + min.x) / SCALE - 180, lat: 90 - (pt.y + min.y) / SCALE }),
    handlers: {},
    on(ev, fn) { map.handlers[ev] = fn; }, off() {},
  };
  return map;
}

let vintage = 0; // a snapshot with the same vintage is "up to date" and is not re-read, so each load needs its own
async function loadSnapshot(features) {
  const gen = `2026-10-04T13:45:${String(++vintage).padStart(2, "0")}.000Z`;
  const fetchImpl = async (url) => ({
    ok: true,
    json: async () => (url.includes("?meta=1") ? { cached: true, generatedAt: gen, count: features.length } : { type: "FeatureCollection", features }),
  });
  await ensureSnapshot("chambers", { fetchImpl });
}

// Leaflet's own order: onAdd, then the "add" event, then animation frames (the budgeted ingest drains in them).
const mounted = [];
const mount = async (map, opts) => {
  const layer = makeSnapshotLayer("chambers", opts);
  mounted.push([layer, map]);
  layer._map = map;
  layer.onAdd(map);
  layer.fire("add");
  // B2092656 ×3: the view's lots arrive asynchronously (the copy lives in a worker in the browser), ingest drains in
  // animation frames, and the lot-number layout is a sliced job — let all three finish.
  for (let k = 0; k < 10; k++) {
    await new Promise((r) => setTimeout(r, 2));
    for (let i = 0; i < 100 && rec.frames.length; i++) rec.frames.shift()();
  }
  return layer;
};
beforeEach(() => {
  // a layer left on its map keeps listening for snapshot changes — take the previous test's off first
  mounted.splice(0).forEach(([l, m]) => { l.onRemove(m); l.fire("remove"); });
  rec.markers.length = 0; rec.groups.length = 0; rec.frames.length = 0;
});

describe("which attribute the saved copy labels a lot with", () => {
  it("Chambers → GEO_ID (the CCAD account), Fort Bend → QUICKREFID, Waller → PROP_ID; every snapshot county has one", () => {
    expect(snapshotLotNumberField("chambers")).toBe("geo_id");
    expect(snapshotLotNumberField("fortbend")).toBe("quickrefid");
    expect(snapshotLotNumberField("Fort Bend")).toBe("quickrefid");
    expect(snapshotLotNumberField("waller")).toBe("prop_id");
    expect(snapshotLotNumberField("harris")).toBeNull();           // no snapshot, no saved-copy number
    for (const c of SNAPSHOT_COUNTIES) expect(snapshotLotNumberField(c), c).toBeTruthy();
  });
  it("reads the real lot 15835 record as the account, not the county parcel number", () => {
    expect(lotNumberText(LOT_15835, snapshotLotNumberField("chambers"))).toBe("00321-02000-00100-100001");
    expect(lotNumberText(LOT_15835, snapshotLotNumberField("chambers"))).not.toBe("15835");
  });
});

describe("the saved-copy layer draws the number", () => {
  it("a snapshot feature for lot 15835 labels as 00321-02000-00100-100001 (exactly once, inside its lot)", async () => {
    await loadSnapshot([feature(LOT_15835)]);
    const layer = await mount(fakeMap());
    // the layer refreshes on its first add; the numbers ride the same refresh
    expect(layer.getLayers()).toHaveLength(1);
    const texts = rec.markers.map((m) => /data-lot-no="([^"]+)"/.exec(m.o.icon.html)[1]);
    expect(texts).toEqual(["00321-02000-00100-100001"]);      // RED on main: no markers at all
    const { lat, lng } = rec.markers[0].ll;
    expect(lng).toBeGreaterThan(LNG); expect(lng).toBeLessThan(LNG + D);
    expect(lat).toBeGreaterThan(LAT); expect(lat).toBeLessThan(LAT + D * 0.6);
  });
  it("a lot whose record has no GEO_ID draws no number (never falls back to a different number)", async () => {
    const { GEO_ID, ...noAcct } = LOT_15835;
    await loadSnapshot([feature(noAcct)]);
    await mount(fakeMap());
    expect(rec.markers).toHaveLength(0);
  });
  it("two neighbouring lots → two numbers, no overlapping boxes", async () => {
    await loadSnapshot([feature(LOT_15835), feature({ ...LOT_15835, PROP_ID: "15836", GEO_ID: "00321-02000-00100-100002" }, D * 1.1)]);
    await mount(fakeMap());
    const texts = rec.markers.map((m) => /data-lot-no="([^"]+)"/.exec(m.o.icon.html)[1]).sort();
    expect(texts).toEqual(["00321-02000-00100-100001", "00321-02000-00100-100002"]);
  });
  it("below the far floor nothing is drawn (same floor as the outlines)", async () => {
    await loadSnapshot([feature(LOT_15835)]);
    await mount(fakeMap(10));
    expect(rec.markers).toHaveLength(0);
  });
});

describe("the Map view's acreage chip over a selected lot (V1475200 step 8, found live on production 2026-10-08)", () => {
  // The chip ("10.78 AC") sits at the middle of the selected lot — exactly where the number wants to be.
  const CHIP = { x: 200, y: 262, w: 104, h: 38 };   // container px, centred on the lot below
  const boxOf = (m) => {
    const [w, h] = m.o.icon.iconSize, min = px(NW.lng, NW.lat);
    const c = { x: (m.ll.lng + 180) * SCALE - min.x, y: (90 - m.ll.lat) * SCALE - min.y };
    return { x0: c.x - w / 2, y0: c.y - h / 2, x1: c.x + w / 2, y1: c.y + h / 2 };
  };
  const overlaps = (b) => !(b.x1 <= CHIP.x || b.x0 >= CHIP.x + CHIP.w || b.y1 <= CHIP.y || b.y0 >= CHIP.y + CHIP.h);
  it("known-good arm: with no obstacle the number lands under the chip (so the test can see the problem)", async () => {
    await loadSnapshot([feature(LOT_15835)]);
    await mount(fakeMap());
    expect(rec.markers).toHaveLength(1);
    expect(overlaps(boxOf(rec.markers[0]))).toBe(true);
  });
  it("with the chip as an obstacle the number clears it (or is hidden — never printed over it)", async () => {
    await loadSnapshot([feature(LOT_15835)]);
    await mount(fakeMap(), { getObstacles: () => [CHIP] });   // RED on main: makeSnapshotLayer took no obstacles
    for (const m of rec.markers) expect(overlaps(boxOf(m))).toBe(false);
    expect(rec.markers.length).toBeLessThanOrEqual(1);
  });
});
