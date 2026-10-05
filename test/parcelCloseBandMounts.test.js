/* NEW-1 follow-up (V1475200 live FAIL, build c8fc0d0, 2026-10-04) — at Grand Port, zoomed in to lot level with
 * Chambers and Harris in view, NO lot numbers drew and the ONLY parcel layer was the statewide StratMap picture:
 * no county vector layer ever mounted, zero /query requests.
 *
 * ROOT CAUSE (measured here, not guessed): the outline set's 8-second hang-guard armed on the layer's first
 * `requeststart`. esri-leaflet fires that for the layer's own METADATA read the instant the layer is added —
 * at ANY zoom. NEW-1 moved a MapServer CAD's vector floor from the far floor to the vector floor, so a view
 * that opens (or sits) below the floor mounts the county layer, which reads metadata and then — correctly —
 * requests no cells, so it never fires `load`. Eight seconds later the guard declared the county DOWN, pulled
 * it, and put the statewide picture in its place; `down` is sticky for the session, so zooming in afterwards
 * never mounted the county layer again. (Before NEW-1 the wide band was a county IMAGE that loaded, so the
 * guard never saw a layer that was in range of nothing.)
 *
 * RED-PROOF: scenario 1 fails on c8fc0d0 (the county is marked down and the statewide composite mounts).
 * Scenario 3 is the Grand Port close band itself: both counties mount, no statewide, and each layer asks for
 * the number's field. Leaflet / esri-leaflet are mocked with recorders (they need a window). */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("esri-leaflet", () => ({
  featureLayer: (opts) => { const l = { options: { ...opts }, _requestFeatures() {}, metadata() {}, on() { return l; }, off() { return l; }, eachFeature() {} }; return l; },
  dynamicMapLayer: (opts) => { const l = { options: { ...opts }, on() { return l; }, off() { return l; }, onRemove() {}, _renderImage() {}, getPane() {}, setDynamicLayers(v) { l.options.dynamicLayers = v; l.sets = (l.sets || 0) + 1; return l; } }; return l; },
}));
vi.mock("leaflet", () => {
  const C = (proto) => { const F = function () {}; Object.assign(F.prototype, proto); return F; };
  return { default: {
    canvas: () => ({ remove() {} }), layerGroup: () => ({ addTo() { return {}; }, clearLayers() {} }), geoJSON: () => ({ on() {}, off() {} }),
    latLngBounds: () => ({}), point: (x, y) => ({ x, y }), latLng: (a, b) => ({ lat: a, lng: b }), divIcon: (o) => o, marker: () => ({ addTo() {} }),
    Layer: { extend: C }, GridLayer: { extend: C },
  } };
});

import { createOutlineSet } from "../src/workspaces/site-planner/lib/parcelOutlineSet.js";
import { makeParcelDisplayLayer } from "../src/workspaces/site-planner/lib/parcelDisplay.js";
import { displaySourcesForView, statewideKeysForState, statewideBackupScope, COUNTIES, COUNTIES_MAP, isStatewideLayerUrl, displayMinZoomForUrl, lotNumberFieldForUrl } from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";
import { PARCEL_VECTOR_MINZOOM, plainOutlineDynamicLayers, parcelUrlSupportsImageExport } from "../src/workspaces/site-planner/lib/parcelDisplayZoom.js";

beforeAll(async () => {
  await setCountyPolygons(JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8")));
});

// Grand Port, north of I-10, with the Harris/Chambers line inside the view.
const GRAND_PORT = { south: 29.80, north: 29.90, west: -95.02, east: -94.80 };

function harness(zoom0) {
  let zoom = zoom0;
  const timers = [];
  const layers = [];
  const map = {
    getZoom: () => zoom,
    getBounds: () => ({ getSouth: () => GRAND_PORT.south, getNorth: () => GRAND_PORT.north, getWest: () => GRAND_PORT.west, getEast: () => GRAND_PORT.east }),
    removeLayer: (l) => { l.mounted = false; },
  };
  const set = createOutlineSet({
    getMap: () => map,
    boundsOf: () => GRAND_PORT,
    resolveUrl: async (k) => ((COUNTIES[k] || COUNTIES_MAP[k] || {}).layerUrl),
    // The REAL floor for the real URL — the whole point: Chambers and Harris are MapServers.
    makeLayer: (url) => {
      const h = {};
      const l = {
        url, mounted: false, _map: null, options: { minZoom: Math.max(14, displayMinZoomForUrl(url)) },
        on: (e, f) => { (h[e] ||= []).push(f); }, emit: (e) => (h[e] || []).forEach((f) => f()),
        // esri-leaflet reads the layer's field list the moment the layer is added, at any zoom → requeststart.
        addTo: (m) => { l.mounted = true; l._map = m; l.emit("requeststart"); return l; },
      };
      if (isStatewideLayerUrl(url)) { l.scopes = []; l.setCountyScope = (n) => { l.scopes.push(n); return l; }; }
      layers.push(l);
      return l;
    },
    sourcesForView: displaySourcesForView,
    statewideKeysForState,
    stateOf: (k) => COUNTIES_MAP[k] && COUNTIES_MAP[k].state,
    isStatewideUrl: isStatewideLayerUrl,
    scopeFor: statewideBackupScope,
    setTimer: (f, ms) => { const t = { f, ms, dead: false }; timers.push(t); return t; },
    clearTimer: (t) => { t.dead = true; },
  });
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const fireTimers = () => timers.filter((t) => !t.dead).forEach((t) => { t.dead = true; t.f(); });
  // A healthy layer that IS in range asks for cells and answers; one below its floor asks for none.
  const answerInRange = () => layers.forEach((l) => { if (zoom >= l.options.minZoom) l.emit("load"); });
  return { set, layers, map, answerInRange, setZoom: (z) => { zoom = z; }, flush, fireTimers };
}
const mountedKeys = (h) => h.set.mounted();
const isStatewideKey = (k) => COUNTIES_MAP[k] && COUNTIES_MAP[k].statewide;

describe("Grand Port: Chambers + Harris county layers mount and stay mounted (V1475200)", () => {
  it("precondition — both counties are in the view and both are MapServer CADs held to the vector floor", () => {
    const want = new Set(displaySourcesForView(GRAND_PORT));
    expect(want.has("chambers")).toBe(true);
    expect(want.has("harris")).toBe(true);
    expect(displayMinZoomForUrl(COUNTIES.chambers.layerUrl)).toBeGreaterThanOrEqual(PARCEL_VECTOR_MINZOOM);
    expect(displayMinZoomForUrl(COUNTIES.harris.layerUrl)).toBeGreaterThanOrEqual(PARCEL_VECTOR_MINZOOM);
  });

  it("(1) a view BELOW the vector floor must not make the hang-guard declare the counties down", async () => {
    const h = harness(15.4);
    h.set.sync(); await h.flush(); await h.flush();
    expect(mountedKeys(h)).toEqual(expect.arrayContaining(["chambers", "harris"]));
    h.answerInRange();                           // Liberty (a FeatureServer, floor 14) is in range and healthy; the two MapServers are not in range
    h.fireTimers(); await h.flush();             // the 8 s guard elapses; the MapServers (correctly) requested no cells
    expect(mountedKeys(h)).toEqual(expect.arrayContaining(["chambers", "harris"]));   // fails on c8fc0d0: pulled as DOWN
    expect(mountedKeys(h).some(isStatewideKey)).toBe(false);                            // fails on c8fc0d0: statewide picture mounted
  });

  it("(2) …and zooming IN afterwards still has the county layers, with no statewide picture", async () => {
    const h = harness(15.4);
    h.set.sync(); await h.flush(); await h.flush();
    h.answerInRange();
    h.fireTimers(); await h.flush();
    h.setZoom(17.2);
    h.set.sync(); await h.flush();
    expect(mountedKeys(h)).toEqual(expect.arrayContaining(["chambers", "harris"]));
    expect(mountedKeys(h).some(isStatewideKey)).toBe(false);
    h.layers.forEach((l) => l.emit("requeststart")); // real cells now go out
    h.answerInRange();                               // …and answer
    h.fireTimers();
    expect(mountedKeys(h)).toEqual(expect.arrayContaining(["chambers", "harris"]));
  });

  it("(3) in the close band both county layers mount, load, and no statewide picture is ever mounted", async () => {
    const h = harness(17.2);
    h.set.sync(); await h.flush(); await h.flush();
    h.answerInRange();
    h.fireTimers(); await h.flush();
    expect(mountedKeys(h)).toEqual(expect.arrayContaining(["chambers", "harris"]));
    expect(mountedKeys(h).some(isStatewideKey)).toBe(false);
  });

  it("(4) a county layer that is IN range and never answers is still declared down (the guard keeps its teeth)", async () => {
    const h = harness(17.2);
    h.set.sync(); await h.flush(); await h.flush();
    h.fireTimers(); await h.flush(); await h.flush(); await h.flush();   // in range, requested, never loaded → genuinely hung
    expect(mountedKeys(h).some(isStatewideKey)).toBe(true);
  });
});

describe("each Grand Port county layer carries the number's field request (labels)", () => {
  it("chambers → the CAD account, harris → the HCAD number; both get a lot-number layer attached", () => {
    for (const [key, field] of [["chambers", "Account"], ["harris", "HCAD_NUM"]]) {
      expect(lotNumberFieldForUrl(COUNTIES[key].layerUrl)).toBe(field);
      const layer = makeParcelDisplayLayer(COUNTIES[key].layerUrl);
      expect(layer._lotNumbers, key).toBeTruthy();
      expect(layer.options.minZoom, key).toBeGreaterThanOrEqual(PARCEL_VECTOR_MINZOOM);
    }
  });
});

describe("a failed county's statewide backup covers ONLY that county (owner question, V1475200 follow-up)", () => {
  const GP_BASE = ["harris", "chambers", "liberty"];
  it("pure: Chambers down → only CHAMBERS; two down → both; nothing down → whole state", () => {
    expect(statewideBackupScope("txgio_statewide", GP_BASE, ["chambers"])).toEqual(["CHAMBERS"]);
    expect(statewideBackupScope("txgio_statewide", GP_BASE, ["chambers", "harris"])).toEqual(["CHAMBERS", "HARRIS"]);
    expect(statewideBackupScope("txgio_statewide", ["fortbend"], ["fortbend"])).toEqual(["FORT BEND"]);   // the spelling the layer's `county` column uses
    expect(statewideBackupScope("txgio_statewide", GP_BASE, [])).toBeNull();
  });
  it("pure: where the statewide source is itself PRIMARY (a county with no CAD of its own, Waller parked on it) it is drawn whole", () => {
    expect(statewideBackupScope("txgio_statewide", ["waller", "chambers"], ["chambers"])).toBeNull();
    expect(statewideBackupScope("txgio_statewide", ["txgio_statewide"], ["chambers"])).toBeNull();
  });
  it("the export request carries a definitionExpression naming the failed counties (quotes escaped), and none when unscoped", () => {
    expect(JSON.parse(plainOutlineDynamicLayers(0, { countyNames: ["CHAMBERS", "FORT BEND"] }))[0].definitionExpression).toBe("county IN ('CHAMBERS','FORT BEND')");
    expect(JSON.parse(plainOutlineDynamicLayers(0))[0].definitionExpression).toBeUndefined();
    expect(JSON.parse(plainOutlineDynamicLayers(0, { countyNames: ["O'BRIEN"] }))[0].definitionExpression).toBe("county IN ('O''BRIEN')");
  });
  it("the real statewide image layer re-requests only when the scope actually changes", () => {
    const layer = makeParcelDisplayLayer(COUNTIES.waller.layerUrl);
    layer.setCountyScope(["CHAMBERS"]); layer.setCountyScope(["CHAMBERS"]);
    expect(layer.sets).toBe(1);
    expect(JSON.parse(layer.options.dynamicLayers)[0].definitionExpression).toBe("county IN ('CHAMBERS')");
    layer.setCountyScope(null);
    expect(JSON.parse(layer.options.dynamicLayers)[0].definitionExpression).toBeUndefined();
  });
  it("Grand Port, Chambers' own server failing: the statewide layer mounts SCOPED to Chambers, and Harris keeps its own vector layer", async () => {
    const h = harness(17.2);
    h.set.sync(); await h.flush(); await h.flush();
    const chambers = h.layers.find((l) => l.url === COUNTIES.chambers.layerUrl);
    chambers.emit("requesterror");               // the live service answers every query with an error
    await h.flush(); await h.flush(); await h.flush();
    h.layers.filter((l) => !isStatewideLayerUrl(l.url)).forEach((l) => l.emit("load"));
    expect(mountedKeys(h)).toEqual(expect.arrayContaining(["harris", "txgio_statewide"]));
    expect(mountedKeys(h)).not.toContain("chambers");
    const sw = h.layers.find((l) => isStatewideLayerUrl(l.url));
    expect(sw.scopes[sw.scopes.length - 1]).toEqual(["CHAMBERS"]);   // fails before this change: the whole view, Harris included
    expect(sw.scopes[0]).toEqual(["CHAMBERS"]);                      // already scoped BEFORE its first request
  });
});
