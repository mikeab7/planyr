import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { cubicBezier, LEAFLET_ZOOM_EASE, parseTransform, tween, formatTransform, lockstepZoomAnimation } from "../src/shared/map/lockstepZoom.js";

/* B2426464 ×3 — every layer of the Map view moves together through a zoom animation (one rAF loop), instead of each layer's CSS transition
 * starting whenever the compositor has rasterised it. Measured: a level revealed just before a fast trackpad zoom-out started late and was
 * drawn at its old size beside the rest of the map (ui-audit/measure-parcel-zoom-slide.mjs). These pin the maths and the hand-over to Leaflet. */

describe("the easing is the stylesheet's own", () => {
  it("cubic-bezier(0,0,0.25,1): ends pinned, monotonic, ease-out", () => {
    expect(LEAFLET_ZOOM_EASE(0)).toBe(0);
    expect(LEAFLET_ZOOM_EASE(1)).toBe(1);
    let prev = 0;
    for (let p = 0.05; p <= 1; p += 0.05) { const e = LEAFLET_ZOOM_EASE(p); expect(e).toBeGreaterThanOrEqual(prev); prev = e; }
    expect(LEAFLET_ZOOM_EASE(0.5)).toBeGreaterThan(0.75); // front-loaded, like the CSS curve
  });
  it("linear bezier is the identity", () => {
    const lin = cubicBezier(0.25, 0.25, 0.75, 0.75);
    for (const p of [0.1, 0.33, 0.8]) expect(lin(p)).toBeCloseTo(p, 4);
  });
});

describe("transforms", () => {
  it("parses Leaflet's translate3d + scale, and the browser's normalised read-back", () => {
    expect(parseTransform("translate3d(10px,-20.5px,0) scale(0.5)")).toEqual({ x: 10, y: -20.5, s: 0.5 });
    expect(parseTransform("translate3d(10px, -20.5px, 0px) scale(0.5)")).toEqual({ x: 10, y: -20.5, s: 0.5 });
    expect(parseTransform("translate3d(3px, 4px, 0px)")).toEqual({ x: 3, y: 4, s: 1 });
    expect(parseTransform("")).toEqual({ x: 0, y: 0, s: 1 });
  });
  it("tween is translate and scale each linear in the eased time", () => {
    expect(tween({ x: 0, y: 0, s: 1 }, { x: 100, y: -50, s: 0.5 }, 0.5)).toEqual({ x: 50, y: -25, s: 0.75 });
    expect(formatTransform({ x: 1, y: 2, s: 3 })).toBe("translate3d(1px,2px,0) scale(3)");
  });
});

describe("lockstepZoomAnimation — one loop moves every animated element; Leaflet gets them at their targets", () => {
  let rafs;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
    rafs = [];
    globalThis.requestAnimationFrame = (fn) => { rafs.push(fn); return rafs.length; };
    globalThis.cancelAnimationFrame = () => {};
  });
  afterEach(() => { vi.useRealTimers(); delete globalThis.requestAnimationFrame; delete globalThis.cancelAnimationFrame; });
  const frame = (ms) => { vi.advanceTimersByTime(ms); rafs.splice(0).forEach((f) => f()); };

  function fakeMap() {
    const mk = (t) => ({ style: { transform: t }, isConnected: true });
    const a = mk("translate3d(0px, 0px, 0px)"), b = mk("translate3d(10px, 10px, 0px) scale(2)");
    const doc = { getElementById: () => null, createElement: () => ({}), head: { appendChild() {} } };
    const container = { ownerDocument: doc, classList: { add() {}, remove() {} } };
    const map = {
      els: [a, b], ends: 0, seenAtEnd: null,
      _mapPane: { querySelectorAll: () => map.els },
      _layers: {}, getCenter: () => ({}), getZoom: () => 17,
      getContainer: () => container,
      _animateZoom(c, z, startAnim) { if (startAnim) { a.style.transform = "translate3d(-100px, -100px, 0px) scale(2)"; b.style.transform = "translate3d(-80px, -80px, 0px) scale(4)"; } },
      _onZoomTransitionEnd() { this.ends++; this.seenAtEnd = [a.style.transform, b.style.transform]; },
    };
    return { map, a, b };
  }

  it("holds each element where it was, then walks it to Leaflet's target with the eased curve", () => {
    const { map, a } = fakeMap();
    lockstepZoomAnimation(map);
    map._animateZoom(null, 18, true);
    expect(parseTransform(a.style.transform)).toEqual({ x: 0, y: 0, s: 1 }); // the frame before the animation
    frame(125);
    const mid = parseTransform(a.style.transform), e = LEAFLET_ZOOM_EASE(0.5);
    expect(mid.x).toBeCloseTo(-100 * e, 6);
    expect(mid.s).toBeCloseTo(1 + e, 6);
  });
  it("every element is at its target before Leaflet's end-of-zoom reset runs", () => {
    const { map } = fakeMap();
    lockstepZoomAnimation(map);
    map._animateZoom(null, 18, true);
    frame(60);
    map._onZoomTransitionEnd();
    expect(map.seenAtEnd).toEqual(["translate3d(-100px, -100px, 0px) scale(2)", "translate3d(-80px, -80px, 0px) scale(4)"]);
  });
  it("a tile LEVEL built inside 'zoomanim' starts where it would be at the zoom being left — never parked at its landing spot", () => {
    const { map } = fakeMap();
    const lvEl = { style: { transform: "" }, isConnected: true };
    const layer = {
      _levels: {},
      _setZoomTransform(level, c, z) { level.el.style.transform = z === 17 ? "translate3d(50px, 50px, 0px) scale(0.5)" : "translate3d(0px, 0px, 0px) scale(1)"; },
    };
    map._layers = { 1: layer };
    map.getCenter = () => ({}); map.zoomNow = 17; map.getZoom = () => map.zoomNow;
    const base = map._animateZoom;
    map._animateZoom = function (c, z, start) { base.call(this, c, z, start); layer._levels[18] = { el: lvEl, zoom: 18 }; map.els = [...map.els, lvEl]; layer._setZoomTransform(layer._levels[18], c, 18); map.zoomNow = 18; };
    lockstepZoomAnimation(map);
    map._animateZoom(null, 18, true);
    expect(parseTransform(lvEl.style.transform)).toEqual({ x: 50, y: 50, s: 0.5 }); // its start
    frame(125);
    const e = LEAFLET_ZOOM_EASE(0.5), mid = parseTransform(lvEl.style.transform);
    expect(mid.x).toBeCloseTo(50 - 50 * e, 6);
    expect(mid.s).toBeCloseTo(0.5 + 0.5 * e, 6);
    map._onZoomTransitionEnd();
    expect(lvEl.style.transform).toBe("translate3d(0px, 0px, 0px) scale(1)");
  });
  it("an element someone else repositions mid-zoom is theirs — the loop stops writing it", () => {
    const { map, a } = fakeMap();
    lockstepZoomAnimation(map);
    map._animateZoom(null, 18, true);
    frame(30);
    a.style.transform = "translate3d(5px, 5px, 0px)";
    frame(60);
    expect(a.style.transform).toBe("translate3d(5px, 5px, 0px)");
  });
  it("a pinch frame (no startAnim) passes straight through", () => {
    const { map, a } = fakeMap();
    lockstepZoomAnimation(map);
    map._animateZoom(null, 18, false);
    expect(a.style.transform).toBe("translate3d(0px, 0px, 0px)");
    expect(rafs.length).toBe(0);
  });
  it("detach restores Leaflet's own methods", () => {
    const { map } = fakeMap();
    const base = map._animateZoom;
    const off = lockstepZoomAnimation(map);
    expect(map._animateZoom).not.toBe(base);
    off();
    expect(map._animateZoom).toBe(base);
  });
  it("the Map view installs it", () => {
    expect(readFileSync(new URL("../src/workspaces/site-planner/MapFinder.jsx", import.meta.url), "utf8")).toMatch(/lockstepZoomAnimation\(map\)/);
  });
});
