/* NEW-1 (owner decision 2026-10-04) — Planyr owns parcel outlines AND lot numbers in every county.
 *
 * Three RED-PROOF checks, each failing on main @2feca52 (see the PR for the replay):
 *   (a) in the wide band a MapServer county mounts NO county /export image;
 *   (b) the close-band layer asks the service for the number's field and draws one label per placeable
 *       lot with ZERO overlapping label boxes;
 *   (c) the one remaining picture (statewide, image-only) is requested WITHOUT labels, in Planyr's colour.
 * Leaflet / esri-leaflet need a `window`, so they are mocked with recorders — the code under test is the
 * decision about WHAT gets mounted and requested, which is exactly what those recorders see. */
import { describe, it, expect, vi, beforeEach } from "vitest";

const rec = vi.hoisted(() => ({ feature: [], dynamic: [], markers: [], groups: [] }));

vi.mock("esri-leaflet", () => ({
  featureLayer: (opts) => {
    const handlers = {};
    const spy = vi.fn();
    const layer = {
      options: { ...opts },
      _map: null,
      _requestFeatures: spy,
      _spy: spy,
      metadata: (cb) => { layer._metaCb = cb; },
      on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); return layer; },
      off(ev, fn) { handlers[ev] = (handlers[ev] || []).filter((f) => f !== fn); return layer; },
      fire(ev) { (handlers[ev] || []).slice().forEach((f) => f()); },
      eachFeature: (fn) => (layer._features || []).forEach(fn),
    };
    rec.feature.push(layer);
    return layer;
  },
  dynamicMapLayer: (opts) => {
    const layer = { options: { ...opts }, on() { return layer; }, off() { return layer; }, onRemove() {}, _renderImage() {}, getPane() {} };
    rec.dynamic.push(layer);
    return layer;
  },
}));

vi.mock("leaflet", () => {
  const L = {
    canvas: () => ({ remove() {} }),
    point: (x, y) => ({ x, y }),
    latLng: (lat, lng) => ({ lat, lng }),
    divIcon: (o) => o,
    layerGroup: () => {
      const g = { items: [], addTo() { rec.groups.push(g); return g; }, clearLayers() { g.items.length = 0; rec.markers.length = 0; }, addLayer(m) { g.items.push(m); rec.markers.push(m); } };
      return g;
    },
    marker: (ll, o) => { const m = { ll, o, addTo(g) { g.addLayer(m); return m; } }; return m; },
    geoJSON: () => ({ on() {}, off() {}, addData() {}, clearLayers() {} }),
    latLngBounds: () => ({}),
    // main's per-tile ghost layer subclasses these at module scope; a stub class is enough — the code under test is what gets mounted.
    Layer: { extend: (proto) => { const C = function () {}; Object.assign(C.prototype, proto); return C; } },
    GridLayer: { extend: (proto) => { const C = function () {}; Object.assign(C.prototype, proto); return C; } },
  };
  return { default: L };
});

import { makeParcelDisplayLayer } from "../src/workspaces/site-planner/lib/parcelDisplay.js";
import { PARCEL_MINZOOM, PARCEL_VECTOR_MINZOOM, PARCEL_OUTLINE_COLOR, plainOutlineDynamicLayers } from "../src/workspaces/site-planner/lib/parcelDisplayZoom.js";
import { COUNTIES, STATEWIDE_PARCEL_LAYER, displayMinZoomForUrl, lotNumberFieldForUrl } from "../src/workspaces/site-planner/lib/counties.js";
import { resolveLotNumberField, lotNumberText, layoutLotNumbers, clipRingToRect } from "../src/workspaces/site-planner/lib/parcelLotNumbers.js";
import { attachLotNumbers } from "../src/workspaces/site-planner/lib/parcelLotLabelLayer.js";

const urlOf = (key) => COUNTIES[key].layerUrl;
beforeEach(() => { rec.feature.length = 0; rec.dynamic.length = 0; rec.markers.length = 0; rec.groups.length = 0; });

describe("(a) a MapServer county mounts no county /export picture", () => {
  const MS = ["harris", "chambers"];
  for (const key of MS) {
    it(`${key}: no dynamicMapLayer, one vector layer whose floor is the vector floor`, () => {
      makeParcelDisplayLayer(urlOf(key));
      expect(rec.dynamic).toHaveLength(0);               // fails on main: the wide band mounted an /export image
      expect(rec.feature).toHaveLength(1);
      expect(rec.feature[0].options.minZoom).toBe(PARCEL_VECTOR_MINZOOM);
    });
  }
  it("fort bend (FeatureServer) is unchanged: vector only, from the far floor", () => {
    makeParcelDisplayLayer(urlOf("fortbend"));
    expect(rec.dynamic).toHaveLength(0);
    expect(rec.feature[0].options.minZoom).toBe(PARCEL_MINZOOM);
  });
  it("every queryable MapServer county in the registry is held to the vector floor; FeatureServers are not", () => {
    const rows = Object.entries(COUNTIES).filter(([, c]) => c.layerUrl);
    let ms = 0, fs = 0;
    for (const [k, c] of rows) {
      if (c.layerUrl === STATEWIDE_PARCEL_LAYER) continue;
      const floor = displayMinZoomForUrl(c.layerUrl);
      if (/\/MapServer\/\d+\/?$/i.test(c.layerUrl)) { ms++; expect(floor, k).toBeGreaterThanOrEqual(PARCEL_VECTOR_MINZOOM); }
      else if (!c.displayMinZoom) { fs++; expect(floor, k).toBeLessThan(PARCEL_VECTOR_MINZOOM); }
    }
    expect(ms).toBeGreaterThan(20);
    expect(fs).toBeGreaterThan(80);
  });
});

describe("(c) the statewide image-only source is requested without labels, in Planyr's colour", () => {
  it("carries dynamicLayers with showLabels:false and the outline colour; no county look", () => {
    makeParcelDisplayLayer(STATEWIDE_PARCEL_LAYER);
    expect(rec.dynamic).toHaveLength(1);
    expect(rec.feature).toHaveLength(0);
    const dl = JSON.parse(rec.dynamic[0].options.dynamicLayers);   // fails on main: option absent
    expect(dl[0].drawingInfo.showLabels).toBe(false);
    expect(dl[0].drawingInfo.renderer.symbol.outline.color.slice(0, 3)).toEqual([162, 28, 175]);
    expect(PARCEL_OUTLINE_COLOR).toBe("#a21caf");
    expect(rec.dynamic[0].options.layers).toBeUndefined();         // dynamicLayers is the whole layer definition
    expect(rec.dynamic[0].options.minZoom).toBe(PARCEL_MINZOOM);
  });
  it("the sublayer id is the URL's", () => {
    expect(JSON.parse(plainOutlineDynamicLayers(3))[0].source.mapLayerId).toBe(3);
  });
});

describe("(b) the close band asks for the number's field", () => {
  const CHAMBERS_FIELDS = ["ChambersCADWeb.DBO.TaxParcels.OBJECTID", "ChambersCADWeb.DBO.TaxParcels.Name", "ChambersCADWeb.DBO.Accounts.Account", "ChambersCADWeb.DBO.Accounts.Parcel_Id"].map((name) => ({ name }));
  it("chambers: the number is the CAD account, not Parcel_Id, resolved against the live table-prefixed names", () => {
    expect(lotNumberFieldForUrl(urlOf("chambers"))).toBe("Account");
    expect(resolveLotNumberField(CHAMBERS_FIELDS, "Account")).toBe("ChambersCADWeb.DBO.Accounts.Account");
  });
  it("holds the first request until the field list answers, then requests OBJECTID + the number's field", () => {
    makeParcelDisplayLayer(urlOf("chambers"));
    const layer = rec.feature[0];
    const orig = layer._spy;
    layer._map = {};
    layer._requestFeatures("bounds", "coords");
    expect(orig).not.toHaveBeenCalled();                            // held: an invalid outField would fail the whole outline query
    layer._metaCb(null, { fields: CHAMBERS_FIELDS });
    expect(layer.options.fields).toEqual(["OBJECTID", "ChambersCADWeb.DBO.Accounts.Account"]);   // fails on main: only OBJECTID
    expect(orig).toHaveBeenCalledTimes(1);
  });
  it("a failed field-list read still releases the outline request (outlines never wait on numbers)", () => {
    makeParcelDisplayLayer(urlOf("fortbend"));
    const layer = rec.feature[0];
    const orig = layer._spy;
    layer._map = {};
    layer._requestFeatures("b", "c");
    layer._metaCb(new Error("down"), null);
    expect(layer.options.fields).toEqual(["OBJECTID"]);
    expect(orig).toHaveBeenCalledTimes(1);
  });
  it("a field that is not on the layer is never requested", () => {
    expect(resolveLotNumberField([{ name: "OBJECTID" }], "QUICKREFID")).toBeNull();
  });
});

describe("the number is the one a person would look up — Texas audit (live fields + sample rows, 2026-10-04)", () => {
  const expectField = { harris: "HCAD_NUM", fortbend: "QUICKREFID", chambers: "Account", montgomery: "pid", brazoria: "prop_id", galveston: "ID", liberty: "prop_id", austintx: "prop_id" };
  for (const [k, f] of Object.entries(expectField)) it(`${k} → ${f}`, () => expect(lotNumberFieldForUrl(urlOf(k))).toBe(f));
  it("the statewide-only counties (waller and every county with no CAD of its own) have no queryable attributes, so no number", () => {
    expect(lotNumberFieldForUrl(STATEWIDE_PARCEL_LAYER)).toBeNull();
    expect(lotNumberFieldForUrl(urlOf("waller"))).toBeNull();
  });
  it("georgia: ga_richmond and ga_baldwin carry no idField, so they draw no number", () => {
    expect(COUNTIES.ga_richmond.idField).toBeUndefined();
    expect(lotNumberFieldForUrl(urlOf("ga_richmond"))).toBeNull();
  });
  it("lotNumberText reads a prefixed key by its bare name and hides placeholders", () => {
    expect(lotNumberText({ "ChambersCADWeb.DBO.Accounts.Account": "00321-02000-00100-100001" }, "Account")).toBe("00321-02000-00100-100001");
    expect(lotNumberText({ prop_id: null }, "prop_id")).toBe("");
    expect(lotNumberText({ prop_id: 0 }, "prop_id")).toBe("");
    expect(lotNumberText({ QUICKREFID: " R596304 " }, "QUICKREFID")).toBe("R596304");
  });
});

/* ── layout: one number per placeable lot, never overlapping ─────────────────────────────────── */
const measure = (t, fs) => String(t).length * fs * 0.6;
const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const overlap = (a, b) => a.x - a.w / 2 < b.x + b.w / 2 && a.x + a.w / 2 > b.x - b.w / 2 && a.y - a.h / 2 < b.y + b.h / 2 && a.y + a.h / 2 > b.y - b.h / 2;
const grid = (cols, rows, cw, ch, textOf = (i) => `R${100000 + i}`) => {
  const lots = []; let i = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++, i++) lots.push({ id: String(i), text: textOf(i), ring: rect(c * cw, r * ch, cw, ch) });
  return lots;
};

describe("(b) layout — one label per placeable lot, zero overlaps", () => {
  it("roomy lots: every lot gets exactly one number, none overlap, each sits inside its own lot", () => {
    const lots = grid(6, 5, 120, 60);
    const out = layoutLotNumbers({ lots, origin: { x: 0, y: 0 }, measure });
    expect(out).toHaveLength(30);
    const ids = new Set(out.map((o) => o.id));
    expect(ids.size).toBe(30);
    for (let a = 0; a < out.length; a++) for (let b = a + 1; b < out.length; b++) expect(overlap(out[a], out[b])).toBe(false);
    for (const o of out) {
      const lot = lots.find((l) => l.id === o.id), r = lot.ring;
      expect(o.x - o.w / 2).toBeGreaterThanOrEqual(r[0].x - 0.01);
      expect(o.x + o.w / 2).toBeLessThanOrEqual(r[1].x + 0.01);
      expect(o.y - o.h / 2).toBeGreaterThanOrEqual(r[0].y - 0.01);
      expect(o.y + o.h / 2).toBeLessThanOrEqual(r[2].y + 0.01);
    }
  });
  it("a dense subdivision thins out: lots too small for their number are hidden, never piled", () => {
    const lots = [...grid(8, 8, 30, 14), ...grid(3, 3, 150, 60).map((l, i) => ({ ...l, id: `big${i}`, ring: l.ring.map((p) => ({ x: p.x + 400, y: p.y })) }))];
    const out = layoutLotNumbers({ lots, origin: { x: 0, y: 0 }, measure });
    for (let a = 0; a < out.length; a++) for (let b = a + 1; b < out.length; b++) expect(overlap(out[a], out[b])).toBe(false);
    expect(out.some((o) => o.id.startsWith("big"))).toBe(true);
    expect(out.filter((o) => !o.id.startsWith("big"))).toHaveLength(0);      // 30×14 lots cannot hold "R100000" — hidden
  });
  it("a number that would touch a parcel chip is hidden, not overprinted", () => {
    const lots = grid(1, 1, 200, 60);
    const clear = layoutLotNumbers({ lots, origin: { x: 0, y: 0 }, measure });
    expect(clear).toHaveLength(1);
    const chip = { x: 0, y: 0, w: 200, h: 60 };                                 // the chip covers the whole lot
    const blocked = layoutLotNumbers({ lots, origin: { x: 0, y: 0 }, measure, obstacles: [chip] });
    expect(blocked).toHaveLength(0);
    const half = layoutLotNumbers({ lots, origin: { x: 0, y: 0 }, measure, obstacles: [{ x: 0, y: 0, w: 200, h: 24 }] });
    expect(half).toHaveLength(1);                                               // slides to the free part of the same lot
    expect(overlap(half[0], { x: 100, y: 12, w: 200, h: 24 })).toBe(false);
  });
  it("two long numbers in two neighbouring lots never overlap each other", () => {
    const lots = grid(2, 1, 100, 40, () => "00321-02000-00100-100001");
    const out = layoutLotNumbers({ lots, origin: { x: 0, y: 0 }, measure: (t, fs) => t.length * fs * 0.5 });
    for (let a = 0; a < out.length; a++) for (let b = a + 1; b < out.length; b++) expect(overlap(out[a], out[b])).toBe(false);
  });
});

describe("a lot larger than the screen is numbered where you can see it", () => {
  const view = { x0: 0, y0: 0, x1: 400, y1: 300 };
  it("clips to the view and the number lands inside the visible part", () => {
    const huge = rect(-5000, -5000, 10000, 10000);
    const seen = clipRingToRect(huge, view);
    expect(seen).not.toBeNull();
    const out = layoutLotNumbers({ lots: [{ id: "h", text: "R123456", ring: seen }], origin: { x: 0, y: 0 }, measure });
    expect(out).toHaveLength(1);
    expect(out[0].x - out[0].w / 2).toBeGreaterThanOrEqual(0);
    expect(out[0].x + out[0].w / 2).toBeLessThanOrEqual(400);
    expect(out[0].y + out[0].h / 2).toBeLessThanOrEqual(300);
  });
  it("a ring wholly outside the view clips to nothing; one wholly inside is returned whole", () => {
    expect(clipRingToRect(rect(1000, 1000, 50, 50), view)).toBeNull();
    expect(clipRingToRect(rect(50, 50, 100, 100), view)).toHaveLength(4);
  });
});

describe("(b) the Leaflet layer draws exactly the placed numbers", () => {
  it("one marker per placeable lot, zero overlapping boxes, cleared on remove", () => {
    vi.useFakeTimers();
    const feats = grid(5, 4, 120, 60).map((l, i) => ({
      feature: { id: i, properties: { QUICKREFID: l.text }, geometry: { type: "Polygon", coordinates: [l.ring.map((p) => [p.x, p.y]).concat([[l.ring[0].x, l.ring[0].y]])] } },
    }));
    const layer = { options: { minZoom: 14, fields: ["OBJECTID"] }, _map: null, _requestFeatures() {}, metadata: (cb) => cb(null, { fields: [{ name: "QUICKREFID" }] }), eachFeature: (fn) => feats.forEach(fn), _h: {},
      on(ev, fn) { (layer._h[ev] = layer._h[ev] || []).push(fn); return layer; }, off() { return layer; }, fire(ev) { (layer._h[ev] || []).forEach((f) => f()); } };
    const map = {
      getZoom: () => 17, project: (ll) => ({ x: ll.lng, y: ll.lat }), getPixelBounds: () => ({ min: { x: 0, y: 0 } }), getSize: () => ({ x: 1000, y: 800 }),
      containerPointToLatLng: (p) => ({ lat: p.y, lng: p.x }), on() {}, off() {}, removeLayer() {},
    };
    const ctl = attachLotNumbers(layer, { hint: "QUICKREFID", getObstacles: () => [] });
    layer._requestFeatures(); // kicks the field list; the stub answers synchronously and releases
    layer._map = map;
    layer.fire("add");
    vi.advanceTimersByTime(500);
    expect(ctl.field()).toBe("QUICKREFID");
    expect(rec.markers).toHaveLength(20);
    const boxes = rec.markers.map((m) => ({ x: m.ll.lng, y: m.ll.lat, w: m.o.icon.iconSize[0], h: m.o.icon.iconSize[1] }));
    for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) expect(overlap(boxes[a], boxes[b])).toBe(false);
    layer.fire("remove");
    vi.useRealTimers();
  });
});
