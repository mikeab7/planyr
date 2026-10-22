import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { drawParcelTile, ParcelIndex, tileLngLatBounds } from "../src/workspaces/site-planner/lib/parcelTileLayer.js";
import { prefetchModuleWhenQuiet, HOVER_QUIET_MAX_TRIES, pageIsBusyLoading } from "../src/app/modulePrefetch.js";
const src = (p) => readFileSync(new URL("../src/" + p, import.meta.url), "utf8");

/* NEW-1 (2026-10-22, work-laptop report) — our own canvases hold pixels only while they have ink to carry, and a hover over a module
 * tab does not start a workspace import while the page is still loading tiles. Measured on live ff7be38 at the laptop's 2.6775 pixel
 * ratio: the city-limits and city-name canvases were 29.3 MB EACH, blank, at every parcel zoom and while hidden behind the planner. */

describe("hover prefetch waits for a quiet page", () => {
  it("runs at once when nothing is loading", () => {
    const timers = [];
    const ran = vi.fn();
    prefetchModuleWhenQuiet("__none__", { busy: () => false, setTimer: (f) => timers.push(f) });
    expect(timers).toHaveLength(0);                          // no deferral
  });
  it("defers while tiles are loading, then runs once they are in", () => {
    let busy = true; const timers = [];
    prefetchModuleWhenQuiet("__none__", { busy: () => busy, setTimer: (f) => timers.push(f) });
    expect(timers).toHaveLength(1);                           // held back
    busy = false; timers.shift()();
    expect(timers).toHaveLength(0);                           // ran on the retry
  });
  it("gives up waiting after a bounded number of asks (the click path still loads on demand)", () => {
    const timers = []; let asks = 0;
    prefetchModuleWhenQuiet("__none__", { busy: () => { asks++; return true; }, setTimer: (f) => timers.push(f) });
    while (timers.length) timers.shift()();
    expect(asks).toBe(HOVER_QUIET_MAX_TRIES);
  });
  it("busy means a Leaflet tile that has not finished loading", () => {
    const doc = { querySelector: (sel) => (/leaflet-tile-container .leaflet-tile:not\(\.leaflet-tile-loaded\)/.test(sel) ? {} : null) };
    expect(pageIsBusyLoading(doc)).toBe(true);
    expect(pageIsBusyLoading({ querySelector: () => null })).toBe(false);
  });
  it("the header's hover uses it; the press (real intent) does not", () => {
    const h = src("shared/ui/AppHeader.jsx");
    expect(h).toMatch(/onMouseEnter=\{\(\) => \{ setHover\(true\); if \(!isActive\) prefetchModuleWhenQuiet\(m\.id\); \}\}/);
    expect(h).toMatch(/onPointerDown=\{\(\) => \{ if \(!isActive\) prefetchModule\(m\.id\); \}\}/);
  });
});

describe("own canvases give their pixels back", () => {
  it("the city-limits canvas is sized only while it has ink, and watches its container for display:none", () => {
    const s = src("workspaces/site-planner/lib/adminBoundaryLayer.js");
    expect(s).toMatch(/const hasInk = !hiddenMap/);
    expect(s).toMatch(/canvas\.width = 1; canvas\.height = 1/);
    expect(s).toMatch(/new ResizeObserver/);
    // the allocation must come AFTER the no-ink early return — the old shape allocated at the top of every frame
    expect(s.indexOf("if (!hasInk)")).toBeLessThan(s.indexOf("canvas.width = Math.round(size.x * dpr)"));
  });
  it("the city-names canvas likewise", () => {
    const s = src("shared/basemaps/placeNamesLayer.js");
    expect(s).toMatch(/const inking = !hiddenMap && \(layerA > 0 \|\| busy\)/);
    expect(s).toMatch(/canvas\.width = 1; canvas\.height = 1/);
    expect(s).toMatch(/new ResizeObserver/);
    expect(s.indexOf("if (!inking)")).toBeLessThan(s.indexOf("canvas.width = Math.round(size.x * dpr)"));
  });
  it("a parcel tile canvas parked in the pool holds no pixels", () => {
    const s = src("workspaces/site-planner/lib/parcelDisplay.js");
    expect(s).toMatch(/t\.el\.width = 0; t\.el\.height = 0; \} catch \(_\) \{ \/\* not a canvas \*\/ \} this\._pool\.push\(t\.el\)/);
  });
});

describe("a parcel tile with no lots holds no pixels; one with lots is unchanged", () => {
  it("_paint leaves a lot-less tile at 0x0 and allocates the full 2x backing only when lots are there", () => {
    const s = src("workspaces/site-planner/lib/parcelDisplay.js");
    expect(s).toMatch(/if \(!items\.length\) \{ if \(tile\.width\) \{ tile\.width = 0; tile\.height = 0; \} return; \}/);
    // the allocation is AFTER the no-lots return, and the density rule is untouched (still min(dpr, 2), not lowered)
    expect(s.indexOf("if (!items.length)")).toBeLessThan(s.indexOf("tile.width = size.x * dpr"));
    expect(s).toMatch(/const dpr = Math\.min\(window\.devicePixelRatio \|\| 1, 2\);/);
  });
  it("drawParcelTile draws exactly what it drew before when handed the lots, and nothing for an empty tile", () => {
    const index = new ParcelIndex();
    const ring = new Float64Array([0.5, 0.5, 0.5, 0.52, 0.52, 0.52, 0.5, 0.5]);
    index.add({ bbox: [-86.33, 35.71, -86.31, 35.73], rings: [ring] });
    const calls = []; const ctx = new Proxy({}, { get: (_, k) => (...a) => { calls.push(k); } , set: () => true });
    const z = 18, size = 512;
    const x = 69, y = 105;                                    // an arbitrary tile; the point is equality, not placement
    const bounds = tileLngLatBounds(x, y, z, size);
    const items = index.query(bounds);
    const a = []; const b = [];
    const mk = (out) => new Proxy({}, { get: (_, k) => (...args) => { out.push([k, ...args]); }, set: (_, k, v) => { out.push(["set", k, v]); return true; } });
    const n1 = drawParcelTile(mk(a), index, { x, y, z, size });
    const n2 = drawParcelTile(mk(b), index, { x, y, z, size, items });
    expect(n2).toBe(n1);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(drawParcelTile(mk([]), new ParcelIndex(), { x, y, z, size })).toBe(0);
  });
});
