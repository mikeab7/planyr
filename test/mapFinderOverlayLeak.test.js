/* B1933584 — owner report 2026-09-28, verbatim: "the fema floodplain layer is showing up on
 * map view when I zoom in even though its not selected."
 *
 * ROOT CAUSE, traced from source and reproduced here without a browser: MapFinder.jsx keeps its
 * Leaflet map alive while the Map view is hidden (`display:none`, never unmounted — the Plan view
 * is a sibling that toggles the other way), and hands memory back while hidden by calling
 * `tileLifecycle.releaseLayer(map, layer)` DIRECTLY on whatever `overlayRefs.current[key]` holds.
 * For a ROLE-SPLIT layer (FEMA's `roleLayers: {area:[28], line:[27]}`, and BKDD's two role-split
 * rows) that ref is `rasterComposite(slots)` — a plain `{__pfParts, setOpacity}` object, never
 * itself added to the Leaflet map — so `releaseLayer` is a silent no-op on it: `map.removeLayer`
 * returns immediately because the composite was never in `map._layers`, and the composite's TWO
 * REAL esri-leaflet layers stay fully attached, still wired to `moveend`, with nothing left
 * anywhere that references them once `overlayRefs.current[key]` is deleted. They repaint the next
 * time the map is interacted with — e.g. zoomed in past FEMA's own street-level scale gate — with
 * the Layers-panel checkbox reading unchecked the whole time, because `syncOverlayLayers` can no
 * longer see a ref to release: `!st.on && cur` never fires once `cur` is already undefined.
 *
 * The fix is `releaseOverlayRef` (layers.js): the ONE composite-aware teardown, now used both by
 * `syncOverlayLayers`'s own toggle-off path and by MapFinder's hidden-view teardown. This file
 * proves it directly (fast, no browser) two ways:
 *   1. hand-built fakes, matching tileLifecycle.test.js's own `releaseLayer` fixture shape, prove
 *      `releaseOverlayRef` unwraps a composite and tears down BOTH real parts, and behaves exactly
 *      like `releaseLayer` on a plain (non-split) ref — never a second, forked mechanism;
 *   2. a real drive through `syncOverlayLayers` (mocked esri-leaflet + fetch, the
 *      test/layerRegistryDrift.test.js house pattern) across every ROLE-SPLIT registry row plus a
 *      plain raster row and a vector row, so the fix is proven generic — not asserted only for
 *      FEMA — and the OLD MapFinder shape (raw `releaseLayer` on the tracked ref) is shown to leak
 *      on every role-split row while a plain ref was never at risk.
 *
 * The live, on-the-map paint symptom itself needs a real browser + a real Layers-panel toggle
 * across a real view switch — that live/e2e proof is `e2e/mapfinder-overlay-teardown-leak.spec.js`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("esri-leaflet", () => ({
  dynamicMapLayer: vi.fn(() => makeEsriFake()),
  imageMapLayer: vi.fn(() => makeEsriFake()),
  featureLayer: vi.fn(() => makeEsriFake()),
  tiledMapLayer: vi.fn(() => makeEsriFake()),
}));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({
  cachedVectorLayer: vi.fn(() => makeEsriFake()),
  cachedPipelineLayer: vi.fn(() => null),
  cachedCorridorLayer: vi.fn(() => null),
  isPointFeature: vi.fn(() => false),
}));
vi.mock("../src/workspaces/site-planner/lib/mapSymbols.js", () => ({ installDefaultMarkerIcon: vi.fn(), pointToLayerFor: vi.fn() }));

// ---------------------------------------------------------------------------
// Part 1 — releaseOverlayRef against hand-built fakes (tileLifecycle.test.js's own shape).
// ---------------------------------------------------------------------------
import { releaseLayer } from "../src/workspaces/site-planner/lib/tileLifecycle.js";
import { syncOverlayLayers as syncLayers, ALL_LAYERS as LAYERS, releaseOverlayRef } from "../src/workspaces/site-planner/lib/layers.js";

const fakeRaster = () => {
  const el = { parentNode: { removeChild: vi.fn() } };
  return { _currentImage: { _image: el, __el: el }, onAdd() { return this; }, _renderImage() { this.rendered = true; } };
};
const fakeMap = () => ({ removed: [], removeLayer(l) { this.removed.push(l); } });

describe("releaseOverlayRef (B1933584) — the composite-aware teardown", () => {
  it("unwraps a role-split composite and releases BOTH real parts", () => {
    const map = fakeMap();
    const area = fakeRaster(), line = fakeRaster();
    const composite = { __pfParts: [area, line], setOpacity() {} };
    releaseOverlayRef(map, composite);
    expect(map.removed).toContain(area);
    expect(map.removed).toContain(line);
    expect(area.__pfReleased).toBe(true);
    expect(line.__pfReleased).toBe(true);
  });

  it("a late resolve on either released part cannot resurrect it (the resurrection releaseLayer exists to stop)", () => {
    const map = fakeMap();
    const area = fakeRaster(), line = fakeRaster();
    releaseOverlayRef(map, { __pfParts: [area, line], setOpacity() {} });
    area.onAdd(map); area._renderImage({});
    line.onAdd(map); line._renderImage({});
    expect(area.rendered).toBeUndefined();
    expect(line.rendered).toBeUndefined();
  });

  it("a plain (non-split) ref goes straight through to releaseLayer, unchanged", () => {
    const map = fakeMap();
    const lyr = fakeRaster();
    releaseOverlayRef(map, lyr);
    expect(map.removed).toContain(lyr);
    expect(lyr.__pfReleased).toBe(true);
  });

  it("never throws on null / \"pending\" / a half-built ref", () => {
    expect(() => releaseOverlayRef(null, null)).not.toThrow();
    expect(() => releaseOverlayRef(fakeMap(), "pending")).not.toThrow();
    expect(() => releaseOverlayRef(fakeMap(), {})).not.toThrow();
    // a composite with a missing/falsy part must not throw either
    expect(() => releaseOverlayRef(fakeMap(), { __pfParts: [null, fakeRaster()] })).not.toThrow();
  });

  it("⛔ THE BUG ITSELF, characterised directly: raw tileLifecycle.releaseLayer on a composite is a no-op — this is exactly what MapFinder.jsx's hidden-view teardown used to call", () => {
    const map = fakeMap();
    const area = fakeRaster(), line = fakeRaster();
    const composite = { __pfParts: [area, line], setOpacity() {} };
    releaseLayer(map, composite); // the pre-fix shape, verbatim
    expect(map.removed).not.toContain(area);
    expect(map.removed).not.toContain(line);
    expect(area.__pfReleased).toBeUndefined();
    expect(line.__pfReleased).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Part 2 — a real drive through syncOverlayLayers, generic across registry kinds.
// ---------------------------------------------------------------------------
const fakeEsriLayers = [];
function makeEsriFake() {
  const l = {
    options: {},
    _listeners: {},
    on(evt, fn) { (l._listeners[evt] ||= []).push(fn); return l; },
    off() { return l; },
    once(evt, fn) { (l._listeners[evt] ||= []).push(fn); return l; },
    addTo(map) { l._map = map; return l; },
    setOpacity: vi.fn(),
    fire(evt, payload) { (l._listeners[evt] || []).forEach((fn) => fn(payload)); },
  };
  fakeEsriLayers.push(l);
  return l;
}

function fakeLeafletMap() {
  const panes = {};
  const removed = [];
  return {
    _loaded: true,
    getSize: () => ({ x: 800, y: 600 }),
    getPane: (name) => panes[name],
    createPane: (name) => { const el = { style: {} }; panes[name] = el; return el; },
    whenReady(cb) { cb(); },
    on() {}, off() {},
    removeLayer(l) { removed.push(l); },
    eachLayer() {},
    _removed: removed,
  };
}

const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };

beforeEach(() => {
  fakeEsriLayers.length = 0;
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
});

// The three role-split rows declared in the live registry today — read from ALL_LAYERS itself
// (never hand-copied) so this test can't silently stop covering a row that's added later, and so
// it fails loudly if the registry ever drops role-split entirely.
const ROLE_SPLIT_KEYS = Object.keys(LAYERS).filter((k) => LAYERS[k] && LAYERS[k].roleLayers);

describe("syncOverlayLayers → releaseOverlayRef, driven for real (B1933584)", () => {
  it("sanity: the live registry actually has role-split rows to test against", () => {
    expect(ROLE_SPLIT_KEYS.length).toBeGreaterThanOrEqual(1);
    expect(ROLE_SPLIT_KEYS).toContain("fema");
  });

  it.each(ROLE_SPLIT_KEYS)("%s — builds a role-split composite with its declared number of real parts, and releaseOverlayRef tears down every one", async (key) => {
    const map = fakeLeafletMap();
    const refs = {};
    syncLayers(map, { [key]: { on: true, opacity: 0.55 } }, refs, {});
    await flush();
    const ref = refs[key];
    expect(ref, `${key} never built a ref`).toBeTruthy();
    expect(ref.__pfParts).toBeTruthy();
    const roles = Object.keys(LAYERS[key].roleLayers).filter((r) => Array.isArray(LAYERS[key].roleLayers[r]) && LAYERS[key].roleLayers[r].length);
    expect(ref.__pfParts.length).toBe(roles.length);

    releaseOverlayRef(map, ref);
    for (const part of ref.__pfParts) expect(map._removed).toContain(part);
  });

  it.each(ROLE_SPLIT_KEYS)("%s — THE LEAK: the OLD MapFinder shape (raw releaseLayer on the tracked ref) tears down NONE of its real parts", async (key) => {
    const map = fakeLeafletMap();
    const refs = {};
    syncLayers(map, { [key]: { on: true, opacity: 0.55 } }, refs, {});
    await flush();
    const ref = refs[key];
    expect(ref.__pfParts.length).toBeGreaterThanOrEqual(1);

    releaseLayer(map, ref); // MapFinder.jsx's hidden-view teardown, verbatim, before this fix

    for (const part of ref.__pfParts) expect(map._removed, `${key}'s real layer leaked through the old teardown shape`).not.toContain(part);
  });

  it("a PLAIN (non-split) raster row (wetlands) was never at risk — raw releaseLayer already tore it down correctly", async () => {
    const map = fakeLeafletMap();
    const refs = {};
    syncLayers(map, { wetlands: { on: true, opacity: 0.55 } }, refs, {});
    await flush();
    const ref = refs.wetlands;
    expect(ref).toBeTruthy();
    expect(ref.__pfParts).toBeUndefined(); // single-role — no composite wrapper at all

    releaseLayer(map, ref); // the plain, pre-existing shape — correct even without releaseOverlayRef
    expect(map._removed).toContain(ref);

    // releaseOverlayRef must behave identically for the plain case — one mechanism, not a fork.
    const map2 = fakeLeafletMap();
    const refs2 = {};
    syncLayers(map2, { wetlands: { on: true, opacity: 0.55 } }, refs2, {});
    await flush();
    releaseOverlayRef(map2, refs2.wetlands);
    expect(map2._removed).toContain(refs2.wetlands);
  });

  it("a vector row (jur_county) is a plain ref too — releaseOverlayRef tears it down the same way releaseLayer would", async () => {
    const map = fakeLeafletMap();
    const refs = {};
    syncLayers(map, { jur_county: { on: true, opacity: 0.4 } }, refs, {});
    await flush();
    const ref = refs.jur_county;
    expect(ref).toBeTruthy();
    expect(ref.__pfParts).toBeUndefined();
    releaseOverlayRef(map, ref);
    expect(map._removed).toContain(ref);
  });
});
