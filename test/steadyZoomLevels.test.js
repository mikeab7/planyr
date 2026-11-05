import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { holdNewZoomLevels, HOLD_MS, HOLD_FRAMES, DATA_HOLD_CAP_MS } from "../src/shared/map/steadyZoomLevels.js";
import { attachFreeWheelZoom } from "../src/shared/map/freePinchZoom.js";

/* B2426464 ×2 — the parcel outlines slid off the imagery during a zoom and snapped back when it ended. Measured on composited frames
 * (ui-audit/measure-parcel-zoom-slide.mjs); these pin the rules the fix rests on without a browser. A fake GridLayer stands in for
 * Leaflet's: `_animateZoom` (zoomanim) builds the target level, `_resetView` (the 'zoom' that ends the animation) and `_pruneTiles`. */

const el = () => ({ style: {}, children: [1], isConnected: true });
function fakeLayer() {
  const layer = {
    _levels: { 16: { el: el(), zoom: 16 } },
    _map: { _animatingZoom: false },
    prunes: 0,
    handlers: {},
    on(ev, fn) { this.handlers[ev] = fn; },
    _onCreateLevel() {},
    _pruneTiles() { this.prunes++; },
    _onMoveEnd() {},
    _resetView() { this._pruneTiles(); }, // Leaflet's _setView prunes inside the view reset
    _animateZoom(e) { // Leaflet builds the target zoom's level here
      if (!this._levels[e.zoom]) { const lv = { el: el(), zoom: e.zoom }; this._levels[e.zoom] = lv; this._onCreateLevel(lv); }
    },
  };
  return layer;
}

beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] }); });
afterEach(() => { vi.useRealTimers(); });
const settle = () => vi.advanceTimersByTime(HOLD_MS + 16 * (HOLD_FRAMES + 2));

describe("holdNewZoomLevels — a new zoom level is built out of sight and shown only when the zoom lands", () => {
  it("hides the level built for the target zoom, leaves the drawn one alone", () => {
    const L = holdNewZoomLevels(fakeLayer());
    L._map._animatingZoom = true;
    L._animateZoom({ zoom: 17 });
    expect(L._levels[17].el.style.visibility).toBe("hidden");
    expect(L._levels[16].el.style.visibility).toBeUndefined();
  });
  it("reveals it on the 'zoom' that ends the animation — and never earlier", () => {
    const L = holdNewZoomLevels(fakeLayer());
    L._map._animatingZoom = true;
    L._animateZoom({ zoom: 17 });
    L._resetView({}); // a mid-animation reset (pinch-style) must not reveal
    expect(L._levels[17].el.style.visibility).toBe("hidden");
    L._map._animatingZoom = false;
    L._resetView({});
    expect(L._levels[17].el.style.visibility).toBe("");
  });
  it("keeps the old level while the new one is hidden AND until the revealed one has had time to draw (no blank at the landing)", () => {
    const L = holdNewZoomLevels(fakeLayer());
    L._map._animatingZoom = true;
    L._animateZoom({ zoom: 17 });
    L._pruneTiles(); // Leaflet's non-fade _tileReady prunes the moment a hidden tile is ready
    expect(L.prunes).toBe(0);
    L._map._animatingZoom = false;
    L._resetView({}); // the end-of-zoom prune happens inside the reset — held
    expect(L.prunes).toBe(0);
    settle();
    expect(L.prunes).toBe(1); // ran once, after the hold
  });
  it("a zoom starting while a level is only just shown hides that level too, when an older drawn level can carry the picture", () => {
    const L = holdNewZoomLevels(fakeLayer());
    settle(); // level 16 is old and drawn
    L._map._animatingZoom = true;
    L._animateZoom({ zoom: 17 });
    L._map._animatingZoom = false;
    L._resetView({}); // 17 revealed just now
    L._map._animatingZoom = true;
    L._animateZoom({ zoom: 18 }); // the next wheel notch, inside the hold window
    expect(L._levels[17].el.style.visibility).toBe("hidden");
    expect(L._levels[18].el.style.visibility).toBe("hidden");
    expect(L._levels[16].el.style.visibility).toBeUndefined();
  });
  it("a young level that is the ONLY one stays shown (hiding it would blank the layer for the whole zoom)", () => {
    const L = holdNewZoomLevels(fakeLayer());
    L._onCreateLevel(L._levels[16]); // just created, nothing older
    L._map._animatingZoom = true;
    L._animateZoom({ zoom: 17 });
    expect(L._levels[16].el.style.visibility).toBeUndefined();
  });
  it("on a LOCKSTEP map nothing is hidden (the new level is animated from its start) and clearing old tiles waits for quiet", () => {
    const L = holdNewZoomLevels(fakeLayer());
    L._map.__lockstepZoom = true;
    L._map._animatingZoom = true;
    L._animateZoom({ zoom: 17 });
    expect(L._levels[17].el.style.visibility).toBeUndefined();
    L._pruneTiles(); // a new tile is ready
    vi.advanceTimersByTime(HOLD_MS / 2);
    L._pruneTiles(); // another one — the wait restarts
    vi.advanceTimersByTime(HOLD_MS / 2 + 16);
    expect(L.prunes).toBe(0);
    settle();
    expect(L.prunes).toBe(1); // once, after the last request had HOLD_FRAMES frames and HOLD_MS to draw
  });
  it("on a lockstep map, old tiles stay while the layer's data for the new view is still coming (empty new tiles never clear them)", () => {
    const L = holdNewZoomLevels(fakeLayer());
    L._map.__lockstepZoom = true;
    let pending = true;
    L._dataPending = () => pending;
    L._pruneTiles();
    settle(); settle();
    expect(L.prunes).toBe(0); // the county has not answered: keep what is drawn
    pending = false;
    settle();
    expect(L.prunes).toBe(1); // answered and repainted: now, after the usual hold
  });
  it("…but a server that never answers cannot pin old tiles past DATA_HOLD_CAP_MS", () => {
    const L = holdNewZoomLevels(fakeLayer());
    L._map.__lockstepZoom = true;
    L._dataPending = () => true;
    L._pruneTiles();
    vi.advanceTimersByTime(DATA_HOLD_CAP_MS + HOLD_MS + 16 * (HOLD_FRAMES + 4));
    expect(L.prunes).toBe(1);
  });
  it("is idempotent", () => {
    const L = holdNewZoomLevels(fakeLayer());
    const a = L._animateZoom;
    expect(holdNewZoomLevels(L)._animateZoom).toBe(a);
  });
});

describe("trackpad pinch moves the map like a touch pinch — never a view reset per frame", () => {
  let raf;
  beforeEach(() => { raf = []; globalThis.requestAnimationFrame = (fn) => { raf.push(fn); return raf.length; }; globalThis.cancelAnimationFrame = () => {}; });
  afterEach(() => { delete globalThis.requestAnimationFrame; delete globalThis.cancelAnimationFrame; });
  const pt = (x, y) => ({ x, y, add(o) { return pt(x + o.x, y + o.y); }, subtract(o) { return pt(x - o.x, y - o.y); }, multiplyBy(k) { return pt(x * k, y * k); }, divideBy(k) { return pt(x / k, y / k); } });
  function fakeMap() {
    const calls = [];
    let handler = null;
    const map = {
      calls, zoom: 17, options: { zoomAnimation: true, zoomSnap: 0 }, _zoomAnimated: true, _animatingZoom: false,
      getContainer: () => ({ addEventListener: (t, fn) => { handler = fn; }, removeEventListener() {} }),
      mouseEventToContainerPoint: () => pt(300, 200),
      getZoom: () => map.zoom, _limitZoom: (z) => z, getZoomScale: (a, b) => 2 ** (a - b), getSize: () => pt(800, 600),
      containerPointToLatLng: (p) => ({ lat: p.y, lng: p.x }), getCenter: () => ({ lat: 0, lng: 0 }),
      _stop: () => calls.push("stop"), _moveStart: () => calls.push("moveStart"),
      _move: (c, z, data) => { calls.push(["move", z, data && data.pinch]); map.zoom = z; },
      _animateZoom: (c, z) => calls.push(["animateZoom", z]),
      _resetView: () => calls.push("resetView"), setView: () => calls.push("setView"), setZoomAround: () => calls.push("setZoomAround"),
    };
    return { map, wheel: (e) => handler({ preventDefault() {}, stopPropagation() {}, deltaMode: 0, ...e }) };
  }
  it("each frame of a pinch is a `_move(…, { pinch: true })`, one settle animation when the fingers stop", () => {
    const { map, wheel } = fakeMap();
    attachFreeWheelZoom({ DomEvent: { getWheelDelta: () => 0 } }, map);
    for (let i = 0; i < 5; i++) { wheel({ ctrlKey: true, deltaY: -4 }); raf.splice(0).forEach((f) => f()); }
    const moves = map.calls.filter((c) => Array.isArray(c) && c[0] === "move");
    expect(moves.length).toBe(5);
    expect(moves.every((m) => m[2] === true)).toBe(true);
    expect(map.calls).not.toContain("setView");
    expect(map.calls).not.toContain("setZoomAround");
    expect(map.calls).not.toContain("resetView");
    expect(map.calls.filter((c) => c === "moveStart").length).toBe(1);
    vi.advanceTimersByTime(500);
    expect(map.calls.filter((c) => Array.isArray(c) && c[0] === "animateZoom").length).toBe(1);
  });
  it("a mouse-wheel notch still steps one animated level through setZoomAround", () => {
    const { map, wheel } = fakeMap();
    attachFreeWheelZoom({ DomEvent: { getWheelDelta: () => -120 } }, map);
    wheel({ ctrlKey: false, deltaY: 120 });
    vi.advanceTimersByTime(100);
    expect(map.calls).toContain("setZoomAround");
  });
});

describe("wiring — the Map view's imagery and the parcel tiles both use the one rule", () => {
  const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
  it("ParcelTiles holds its new zoom levels", () => expect(read("workspaces/site-planner/lib/parcelDisplay.js")).toMatch(/holdNewZoomLevels\(this\)/));
  it("every parcel tile layer says when its data is still coming", () => {
    expect(read("workspaces/site-planner/lib/parcelDisplay.js").match(/tiles\._dataPending = /g)?.length).toBe(2);
    expect(read("workspaces/site-planner/lib/parcelWideLayer.js")).toMatch(/tilesLayer\._dataPending = /);
  });
  it("the Map view's imagery layer holds its new zoom levels, and the map runs without the tile fade", () => {
    const s = read("workspaces/site-planner/MapFinder.jsx");
    expect(s).toMatch(/holdNewZoomLevels\(withTileRetry\(L\.tileLayer\(/);
    expect(s).toMatch(/L\.map\(elRef\.current, \{[^}]*fadeAnimation: false/);
  });
  it("the trackpad pinch never resets the view per frame", () => expect(read("shared/map/freePinchZoom.js")).not.toMatch(/animate:\s*false/));
});
