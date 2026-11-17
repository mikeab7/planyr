/* NEW-1 (2026-11-16) — Add parcels › click lots drew NO county lot lines at a normal site-scale zoom.
 * Owner, Goose Creek / Concept B, Harris County (~29.817, -95.017): "I tried to click lots on the map … it would click them, but none showed up
 * as a default, or no outline showed up." Four lots of 10–68 ac filled about a third of the map width; the panel said "Zoom in to see the county
 * lot lines".
 *
 * ROOT CAUSE (measured): HCAD is a queryable MapServer, whose own vector outlines start at zoom 16 (`displayMinZoom` — the record-cap floor).
 * The Map's Select parcels draws the LARGER lots two zoom steps further out (parcelWideLayer.js, `wide: true`); the planner's click-a-lot mode
 * never asked for it, and its status line read only the layer's own floor — so everywhere under zoom 16 it drew nothing and said "zoom in".
 *
 * These tests are RED on the old outline set / planner wiring (status ignores `_wide`; the planner never passes `wide: true` nor awaits
 * `wideViewReady`) and green on the fix. */
import { describe, it, expect, beforeAll } from "vitest";
import { createOutlineSet, layerReach, lotAtPoint } from "../src/workspaces/site-planner/lib/parcelOutlineSet.js";
import { COUNTIES_MAP, displayMinZoomOf } from "../src/workspaces/site-planner/lib/counties.js";
import { areaFieldsReady } from "../src/workspaces/site-planner/lib/parcelAreaFieldsLazy.js";
import { wideStageForZoom, wideSupportedForUrl, wideFloorFor, WIDE_MIN_ACRES, MID_MIN_ACRES } from "../src/workspaces/site-planner/lib/parcelWideRequest.js";
import { PARCEL_MINZOOM } from "../src/workspaces/site-planner/lib/parcelDisplayZoom.js";
import { plannerSource } from "./helpers/plannerSource.js";

// The reported view: a ~20 ac lot is roughly a tenth of the screen width on a desktop window — between zoom 15 and 16 at Baytown's latitude.
const REPORTED_ZOOM = 15.5;
const TOO_FAR_ZOOM = 11.5;

const floorFor = (key) => Math.max(PARCEL_MINZOOM, displayMinZoomOf(key));

describe("the zoom / size rule the add-lots mode draws by", () => {
  beforeAll(async () => { await areaFieldsReady(); });

  it("Harris (HCAD, a MapServer — vectors from 16) draws the LARGER lots at the reported zoom, instead of nothing", () => {
    const url = COUNTIES_MAP.harris.layerUrl;
    expect(floorFor("harris")).toBe(16);
    expect(wideSupportedForUrl(url)).toBe(true); // a verified geometric size column exists (Shape.STArea(), ft²)
    expect(wideStageForZoom(REPORTED_ZOOM, floorFor("harris"), true)).toBe("mid");
    expect(wideStageForZoom(15.0, floorFor("harris"), true)).toBe("mid");
    expect(wideStageForZoom(14.2, floorFor("harris"), true)).toBe("wide");
    // the rule the owner gave: only house-size lots are hidden at wide views — never every lot
    expect(MID_MIN_ACRES).toBeLessThanOrEqual(0.2);
    expect(WIDE_MIN_ACRES).toBeLessThanOrEqual(0.5);
    // …and without the wide stage (what the planner asked for before) the same zoom draws NOTHING
    expect(wideStageForZoom(REPORTED_ZOOM, floorFor("harris"), false)).toBe("far");
  });

  it("Fort Bend and Montgomery (FeatureServers — vectors from 14) already draw every lot at the reported zoom; wide only extends them", () => {
    for (const k of ["fortbend", "montgomery"]) {
      expect(floorFor(k)).toBe(PARCEL_MINZOOM);
      expect(wideStageForZoom(REPORTED_ZOOM, floorFor(k), true)).toBe("close");
    }
    expect(wideStageForZoom(13.2, floorFor("fortbend"), true)).toBe("mid");
  });

  it("a view genuinely too far out still says so — for every source", () => {
    for (const k of ["harris", "fortbend"]) expect(wideStageForZoom(TOO_FAR_ZOOM, floorFor(k), true)).toBe("far");
    expect(wideFloorFor(16)).toBe(14);
  });

  it("KNOWN GAP, stated not hidden: Chambers has no VERIFIED size column (its host was unreadable to the probe), so it keeps its own floor of 16", () => {
    const url = COUNTIES_MAP.chambers.layerUrl;
    expect(wideSupportedForUrl(url)).toBe(false);
    expect(wideStageForZoom(REPORTED_ZOOM, floorFor("chambers"), wideSupportedForUrl(url))).toBe("far");
  });
});

/* ── the outline set's status, with the real counties and a fake map / layers ─────────────────────── */
function setup({ zoom, wide }) {
  const layers = [];
  let t = 1000;
  const map = {
    getZoom: () => zoom.v,
    getBounds: () => ({ getSouth: () => 29.80, getNorth: () => 29.83, getWest: () => -95.03, getEast: () => -95.00 }),
    removeLayer: (l) => { l.mounted = false; },
  };
  const set = createOutlineSet({
    getMap: () => map,
    boundsOf: (m) => { const b = m.getBounds(); return { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }; },
    resolveUrl: async () => "https://www.gis.hctx.net/arcgis/rest/services/HCAD/Parcels/MapServer/0",
    makeLayer: () => {
      const handlers = {};
      const l = {
        options: { minZoom: 16 }, _layers: {}, mounted: false,
        on: (e, f) => { (handlers[e] ||= []).push(f); }, emit: (e) => (handlers[e] || []).forEach((f) => f()),
        addTo() { l.mounted = true; return l; },
        eachFeature(fn) { Object.values(l._layers).forEach(fn); },
        ...(wide ? { _wide: wide } : {}),
      };
      layers.push(l);
      return l;
    },
    sourcesForView: () => ["harris"],
    statewideKeysForState: () => [],
    stateOf: () => "TX",
    isStatewideUrl: () => false,
    setTimer: () => 0, clearTimer: () => {},
    now: () => t,
  });
  return { set, layers, advance: (ms) => { t += ms; } };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const wideLayer = (state) => ({ wideFloor: 14, info: () => state.info, stats: () => ({ held: state.held }), eachFeature: (fn) => (state.ghosts || []).forEach(fn) });

describe("Add parcels status line at the reported zoom (red on the old outline set)", () => {
  it("layerReach: a layer with the larger-lots band reaches two steps below its own floor", () => {
    expect(layerReach({ options: { minZoom: 16 } })).toEqual({ close: 16, floor: 16, wide: false });
    expect(layerReach({ options: { minZoom: 16 }, _wide: { wideFloor: 14 } })).toEqual({ close: 16, floor: 14, wide: true });
  });

  it("the larger lots are on the map → 'drawn', NOT 'zoom' (no 'Zoom in' hint where lines draw)", async () => {
    const zoom = { v: REPORTED_ZOOM };
    const w = { info: { stage: "mid", busy: false, error: null, loading: 0 }, held: 3 };
    const h = setup({ zoom, wide: wideLayer(w) });
    h.set.sync(); await flush(); await flush();
    expect(h.set.status().phase).toBe("drawn");
    expect(h.set.status().lots).toBe(3);
  });

  it("the old behaviour, for contrast: the same layer WITHOUT the band reads 'zoom' under its floor", async () => {
    const zoom = { v: REPORTED_ZOOM };
    const h = setup({ zoom, wide: null });
    h.set.sync(); await flush(); await flush();
    expect(h.set.status().phase).toBe("zoom");
  });

  it("while the band's tiles are on the way → 'loading'; once settled with none held → 'zoom' (small lots hidden, never 'No parcels here')", async () => {
    const zoom = { v: REPORTED_ZOOM };
    const w = { info: { stage: "mid", busy: false, error: null, loading: 2 }, held: 0 };
    const h = setup({ zoom, wide: wideLayer(w) });
    h.set.sync(); await flush(); await flush();
    expect(h.set.status().phase).toBe("loading");
    w.info = { ...w.info, loading: 0 };
    h.advance(1000);
    expect(h.set.status().phase).toBe("zoom");
  });

  it("a view genuinely too far out keeps the 'zoom in' hint", async () => {
    const zoom = { v: TOO_FAR_ZOOM };
    const w = { info: { stage: "far", busy: false, error: null, loading: 0 }, held: 0 };
    const h = setup({ zoom, wide: wideLayer(w) });
    h.set.sync(); await flush(); await flush();
    expect(h.set.status().phase).toBe("zoom");
  });

  it("a county server that REFUSES the band's tiles is reported, not shown as an empty map", async () => {
    const zoom = { v: REPORTED_ZOOM };
    const w = { info: { stage: "mid", busy: false, error: "HTTP 403", loading: 0 }, held: 0 };
    const h = setup({ zoom, wide: wideLayer(w) });
    h.set.sync(); await flush(); await flush();
    expect(h.set.status().refused).toBe(true);
  });

  it("at the layer's own zoom the close stage owns the count, exactly as before", async () => {
    const zoom = { v: 16.4 };
    const h = setup({ zoom, wide: wideLayer({ info: {}, held: 99 }) });
    h.set.sync(); await flush(); await flush();
    h.layers[0]._layers = { a: {}, b: {} };
    h.layers[0].emit("load");
    expect(h.set.status().lots).toBe(2);
    expect(h.set.status().phase).toBe("drawn");
  });
});

describe("the lot under a click, from lines already drawn", () => {
  const square = (x, y, d) => ({ type: "Feature", id: `${x},${y},${d}`, geometry: { type: "Polygon", coordinates: [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]] } });
  const ghost = (f) => { const c = f.geometry.coordinates[0]; return { feature: f, bbox: [c[0][0], c[0][1], c[2][0], c[2][1]] }; };

  it("lotAtPoint picks the tightest lot containing the point, and nothing outside every lot", () => {
    const big = ghost(square(-95.02, 29.81, 0.01)), small = ghost(square(-95.015, 29.812, 0.002));
    expect(lotAtPoint([big, small], -95.014, 29.813)).toBe(small.feature);
    expect(lotAtPoint([big, small], -95.011, 29.818)).toBe(big.feature);
    expect(lotAtPoint([big, small], -95.0, 29.0)).toBe(null);
  });

  it("featureAt reads BOTH the close stage's lots and the larger-lots band's", async () => {
    const zoom = { v: 16.5 };
    const wideGhost = ghost(square(-95.0185, 29.8105, 0.002));
    const w = { info: {}, held: 1, ghosts: [wideGhost] };
    const h = setup({ zoom, wide: wideLayer(w) });
    h.set.sync(); await flush(); await flush();
    const closeGhost = ghost(square(-95.012, 29.816, 0.002));
    h.layers[0]._layers = { x: closeGhost };
    expect(h.set.featureAt(29.817, -95.011)).toBe(closeGhost.feature);
    expect(h.set.featureAt(29.811, -95.018)).toBe(wideGhost.feature);
    expect(h.set.featureAt(29.9, -95.5)).toBe(null);
  });
});

describe("the planner's wiring (source guard — the three things that made it draw nothing)", () => {
  const src = plannerSource();
  it("the click-a-lot layers are built WITH the larger-lots band", () => {
    expect(src).toMatch(/makeParcelDisplayLayer\(url, \{[^}]*wide: true/s);
  });
  it("the first layer is built only after the larger-lots module and size-column table have loaded", () => {
    expect(src).toMatch(/wideViewReady\(\)/);
    const eff = src.slice(src.indexOf("const ready = Promise.resolve(wideViewReady())"));
    expect(eff.slice(0, 400)).toMatch(/ready\.then\(\(\) => \{ if \(!gone\) attach\(\)/);
  });
  it("a click flashes the lot's outline before the county answers, above everything, and removes it when the answer lands", () => {
    expect(src).toMatch(/flashLotAt\(d\.tapIdentify\);\s*[^\n]*\n\s*quickAddAt\(d\.tapIdentify, d\.ack\)/);
    expect(src).toMatch(/pane: m\.getPane\(PANE_PARCEL_PICK\) \? PANE_PARCEL_PICK/);
    expect(src).toMatch(/clearLotFlash\(\); \/\/ the real parcel/);
  });
  it("the 'Zoom in' hint is driven by the set's own phase, never a fixed zoom, and never auto-zooms", () => {
    expect(src).toMatch(/outlinePhase === "zoom" \? "Zoom in to see the county lot lines/);
    const effStart = src.indexOf("const set = createOutlineSet({");
    const effEnd = src.indexOf("}, [identifyMode, origin]);", effStart);
    const eff = src.slice(effStart, effEnd);
    expect(eff).not.toMatch(/setZoom|flyTo|fitBounds|setView/); // owner direction 2026-10-19: no auto-zoom on tool activation
  });
});
