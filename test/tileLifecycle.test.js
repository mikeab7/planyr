/* NEW-6 / NEW-7 — the Leaflet-bound lifecycle work, driven against fakes that mimic the
 * exact Leaflet/esri-leaflet shapes the real code touches.
 *
 * The measured defects these lock down:
 *   • toggling 23 overlays off released 780 of 782 SVG elements (the vector teardown was
 *     already correct) but ZERO of 51 raster tiles — they lingered until an unrelated later
 *     pan happened to prune them;
 *   • a `setView` wiped and refetched every tile even when the NATIVE tile zoom hadn't
 *     moved, which is most of the ~53% of one load's tiles that came from zoom levels the
 *     user never lingered on.
 */
import { describe, it, expect, vi } from "vitest";
import {
  preserveTilesAcrossSetView, announceSetView, capTileCache, releaseLayer, throttleTilePruning,
} from "../src/workspaces/site-planner/lib/tileLifecycle.js";
import { coalesceRequest, clearCoalesced } from "../src/workspaces/site-planner/lib/gisFetch.js";

// A stand-in for Leaflet's GridLayer, with just the internals tileLifecycle touches.
function fakeGrid({ tileZoom = 18, tiles = 8 } = {}) {
  const layer = {
    _tileZoom: tileZoom,
    _clampZoom: (z) => Math.max(0, Math.min(19, z)),
    _tiles: {},
    _levels: {},
    wiped: 0,
    _invalidateAll() { this.wiped += 1; this._tiles = {}; this._tileZoom = undefined; },
    _removeTile(key) { delete this._tiles[key]; },
    _removeAllTiles() { this._tiles = {}; },
    getTileSize: () => ({ x: 256 }),
    on() {}, off() {},
  };
  for (let i = 0; i < tiles; i++) layer._tiles[`${i}:0:${tileZoom}`] = { coords: { x: i, y: 0, z: tileZoom }, current: false, active: false };
  layer._map = { getCenter: () => ({}), project: () => ({ divideBy: () => ({ x: 0, y: 0 }) }) };
  return layer;
}

describe("preserveTilesAcrossSetView (NEW-7)", () => {
  it("keeps every tile when the NATIVE tile zoom doesn't move", () => {
    const l = preserveTilesAcrossSetView(fakeGrid({ tileZoom: 18, tiles: 12 }));
    // A fractional commit — 18.2 rounds to 18, the grid we already hold.
    announceSetView(l, 18.2, () => l._invalidateAll());
    expect(l.wiped).toBe(0);
    expect(Object.keys(l._tiles).length).toBe(12);
  });

  it("falls straight through to Leaflet's wipe when the tile zoom genuinely changes", () => {
    const l = preserveTilesAcrossSetView(fakeGrid({ tileZoom: 18 }));
    announceSetView(l, 16.4, () => l._invalidateAll());
    expect(l.wiped).toBe(1);
    expect(Object.keys(l._tiles).length).toBe(0);
  });

  it("wipes as normal for a setView we did NOT announce — no stale tiles behind our back", () => {
    const l = preserveTilesAcrossSetView(fakeGrid({ tileZoom: 18 }));
    l._invalidateAll();
    expect(l.wiped).toBe(1);
  });

  it("clears the announcement even when the commit throws", () => {
    const l = preserveTilesAcrossSetView(fakeGrid());
    expect(() => announceSetView(l, 18.1, () => { throw new Error("setView blew up"); })).toThrow();
    expect(l.__pfTargetZoom).toBeNull();
  });

  it("is idempotent and leaves a non-GridLayer alone", () => {
    const l = fakeGrid();
    preserveTilesAcrossSetView(l); preserveTilesAcrossSetView(l);
    announceSetView(l, 18.2, () => l._invalidateAll());
    expect(l.wiped).toBe(0);
    expect(() => preserveTilesAcrossSetView({ notALayer: true })).not.toThrow();
  });
});

describe("capTileCache (NEW-7)", () => {
  it("sheds retained tiles down to the cap", () => {
    const l = fakeGrid({ tiles: 40 });
    const dropped = capTileCache(l, 20);
    expect(dropped).toBe(20);
    expect(Object.keys(l._tiles).length).toBe(20);
  });

  it("holds tiles that are part of the current view rather than punching a hole", () => {
    const l = fakeGrid({ tiles: 40 });
    Object.values(l._tiles).forEach((t) => { t.current = true; });
    expect(capTileCache(l, 5)).toBe(0);
    expect(Object.keys(l._tiles).length).toBe(40);
  });

  it("is a no-op on a layer that isn't on a map", () => {
    const l = fakeGrid(); l._map = null;
    expect(capTileCache(l, 1)).toBe(0);
  });

  it("calls getCenter/project ONCE per distinct zoom, not once per tile (B854832)", () => {
    const l = fakeGrid({ tiles: 40 });
    let centerCalls = 0, projectCalls = 0;
    l._map = {
      getCenter: () => { centerCalls++; return { lat: 0, lon: 0 }; },
      project: () => { projectCalls++; return { divideBy: () => ({ x: 0, y: 0 }) }; },
    };
    capTileCache(l, 20);
    // every tile in fakeGrid() shares one zoom, so both collapse to a single call
    expect(centerCalls).toBe(1);
    expect(projectCalls).toBe(1);
  });

  it("still evicts correctly when getCenter throws (falls back to distance 0 for every tile)", () => {
    const l = fakeGrid({ tiles: 10 });
    l._map = { getCenter: () => { throw new Error("no view yet"); }, project: () => { throw new Error("unreachable"); } };
    expect(() => capTileCache(l, 5)).not.toThrow();
    expect(Object.keys(l._tiles).length).toBe(5);
  });
});

describe("throttleTilePruning (B854832)", () => {
  // A fake defer that just records the deferred callback instead of running it, so a test can
  // assert HOW MANY were queued before choosing when (or whether) to flush one.
  function fakeDefer() {
    const queue = [];
    const defer = (fn) => queue.push(fn);
    defer.flush = () => { const fns = queue.splice(0); fns.forEach((fn) => fn()); };
    defer.pending = () => queue.length;
    return defer;
  }

  it("coalesces many synchronous calls within one burst into a single deferred run", () => {
    const l = fakeGrid({ tiles: 12 });
    let calls = 0;
    l._pruneTiles = () => { calls++; };
    const defer = fakeDefer();
    throttleTilePruning(l, defer);
    // Simulate ~150 tiles resolving in a burst, each calling `_pruneTiles()` synchronously —
    // exactly what GridLayer._tileReady does per tile when fadeAnimation is off.
    for (let i = 0; i < 150; i++) l._pruneTiles();
    expect(defer.pending()).toBe(1); // ONE deferred run queued, not 150
    expect(calls).toBe(0); // the real prune has not run yet
    defer.flush();
    expect(calls).toBe(1); // …and runs exactly once once the burst settles
  });

  it("still runs the real prune eventually — this coalesces, it never skips", () => {
    const l = fakeGrid({ tiles: 5 });
    let calls = 0;
    l._pruneTiles = () => { calls++; };
    const defer = fakeDefer();
    throttleTilePruning(l, defer);
    l._pruneTiles();
    defer.flush();
    expect(calls).toBe(1);
  });

  it("a call after the batch settles schedules a fresh deferred run", () => {
    const l = fakeGrid({ tiles: 5 });
    let calls = 0;
    l._pruneTiles = () => { calls++; };
    const defer = fakeDefer();
    throttleTilePruning(l, defer);
    l._pruneTiles();
    defer.flush();
    expect(calls).toBe(1);
    l._pruneTiles(); // a later, independent burst
    expect(defer.pending()).toBe(1);
    defer.flush();
    expect(calls).toBe(2);
  });

  it("is idempotent and leaves a layer with no _pruneTiles alone", () => {
    const l = fakeGrid({ tiles: 3 });
    let calls = 0;
    l._pruneTiles = () => { calls++; };
    const defer = fakeDefer();
    throttleTilePruning(l, defer);
    throttleTilePruning(l, defer); // wrapping twice must not double-wrap
    l._pruneTiles();
    expect(defer.pending()).toBe(1);
    defer.flush();
    expect(calls).toBe(1);
    expect(() => throttleTilePruning({ notALayer: true })).not.toThrow();
    expect(() => throttleTilePruning(null)).not.toThrow();
  });

  it("a throwing prune does not wedge the pending flag — the next burst still schedules", () => {
    const l = fakeGrid({ tiles: 3 });
    let calls = 0;
    l._pruneTiles = () => { calls++; throw new Error("boom"); };
    const defer = fakeDefer();
    throttleTilePruning(l, defer);
    l._pruneTiles();
    expect(() => defer.flush()).not.toThrow(); // the throw is swallowed, same as every other _pf* guard here
    expect(calls).toBe(1);
    l._pruneTiles();
    expect(defer.pending()).toBe(1);
  });

  it("defaults to a real MessageChannel macrotask, and the prune runs after it", async () => {
    const l = fakeGrid({ tiles: 4 });
    let calls = 0;
    l._pruneTiles = () => { calls++; };
    throttleTilePruning(l);
    l._pruneTiles();
    l._pruneTiles();
    expect(calls).toBe(0); // deferred — not yet
    await new Promise((resolve) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => resolve();
      ch.port2.postMessage(0);
    });
    expect(calls).toBe(1);
  });
});

describe("releaseLayer (NEW-6)", () => {
  // esri-leaflet's RasterLayer shape: the painted <img> hangs off `_currentImage`.
  const fakeRaster = () => {
    const el = { parentNode: { removeChild: vi.fn() } };
    return { _currentImage: { _image: el, __el: el }, onAdd() { return this; }, _renderImage() { this.rendered = true; } };
  };
  const fakeMap = () => ({ removed: [], removeLayer(l) { this.removed.push(l); } });

  it("drops the raster image the old teardown left behind — the 0-of-51 bug", () => {
    const map = fakeMap(), lyr = fakeRaster();
    const el = lyr._currentImage._image;
    releaseLayer(map, lyr);
    expect(map.removed).toContain(lyr);
    expect(el.parentNode.removeChild).toHaveBeenCalled();
    expect(lyr._currentImage).toBeNull();
  });

  it("empties a grid layer's tile cache immediately, not on some later pan", () => {
    const map = fakeMap(), l = fakeGrid({ tiles: 51 });
    releaseLayer(map, l);
    expect(Object.keys(l._tiles).length).toBe(0);
  });

  it("a request landing AFTER removal cannot resurrect the layer", () => {
    const map = fakeMap(), lyr = fakeRaster();
    releaseLayer(map, lyr);
    lyr.onAdd(map);          // the late resolve tries to put itself back…
    lyr._renderImage({});    // …and to paint a fresh image
    expect(lyr.rendered).toBeUndefined();
    expect(lyr.__pfReleased).toBe(true);
  });

  it("aborts what the layer knows how to cancel, and walks a group's children", () => {
    const map = fakeMap();
    const child = fakeRaster();
    const abort = vi.fn();
    const group = { abortPending: abort, eachLayer: (fn) => fn(child) };
    releaseLayer(map, group);
    expect(abort).toHaveBeenCalled();
    expect(child.__pfReleased).toBe(true);
  });

  it("never throws on a half-built or already-released layer", () => {
    expect(() => releaseLayer(null, null)).not.toThrow();
    expect(() => releaseLayer(fakeMap(), "pending")).not.toThrow();
    expect(() => releaseLayer(fakeMap(), {})).not.toThrow();
  });
});

describe("request coalescing (NEW-6)", () => {
  it("shares ONE request between callers asking for the same thing at the same time", async () => {
    clearCoalesced();
    let calls = 0;
    const fn = () => { calls += 1; return new Promise((r) => setTimeout(() => r("data"), 5)); };
    const [a, b, c] = await Promise.all([
      coalesceRequest("k", fn), coalesceRequest("k", fn), coalesceRequest("k", fn),
    ]);
    expect(calls).toBe(1);
    expect([a, b, c]).toEqual(["data", "data", "data"]);
  });

  it("reuses a just-finished result — panning back to a bbox you just left is free", async () => {
    clearCoalesced();
    let calls = 0;
    const fn = () => { calls += 1; return Promise.resolve(calls); };
    await coalesceRequest("bbox", fn);
    await coalesceRequest("bbox", fn);
    expect(calls).toBe(1);
  });

  it("does NOT cache a failure — a blip must not be remembered as an answer", async () => {
    clearCoalesced();
    let calls = 0;
    const fn = () => { calls += 1; return calls === 1 ? Promise.reject(new Error("blip")) : Promise.resolve("ok"); };
    await expect(coalesceRequest("f", fn)).rejects.toThrow("blip");
    await expect(coalesceRequest("f", fn)).resolves.toBe("ok");
    expect(calls).toBe(2);
  });

  it("expires past its short window rather than becoming a shadow cache", async () => {
    clearCoalesced();
    let calls = 0, t = 0;
    const fn = () => { calls += 1; return Promise.resolve(calls); };
    await coalesceRequest("t", fn, { now: () => t });
    t = 60_000;
    await coalesceRequest("t", fn, { now: () => t });
    expect(calls).toBe(2);
  });

  it("keys separately, so two different layers never share an answer", async () => {
    clearCoalesced();
    const a = await coalesceRequest("layer:a", () => Promise.resolve("A"));
    const b = await coalesceRequest("layer:b", () => Promise.resolve("B"));
    expect([a, b]).toEqual(["A", "B"]);
  });
});
