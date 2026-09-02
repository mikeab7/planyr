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
  sweepBlankTiles, armBlankTileHeal,
} from "../src/workspaces/site-planner/lib/tileLifecycle.js";
import { STUCK_TILE_GRACE_MS } from "../src/workspaces/site-planner/lib/tileBudget.js";
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

/* B844704 — the owner reported a lingering light-grey square over the dashboard aerial. Traced
 * through Leaflet's own source: a tile that errors is marked `loaded` (so Leaflet's own grid
 * update never asks for it again) but never gains `leaflet-tile-loaded` — the one class that
 * takes it out of `visibility:hidden` (leaflet.css) — so it stays invisible forever, revealing
 * the map's own flat `#ddd` background. `withTileRetry` gives up after two quick tries. This is
 * the backstop: a periodic sweep that finds a retained tile still unpainted past a grace period
 * and forces a fresh, cache-busted reload — regardless of why it never painted. */
function fakeTileImg({ painted = false } = {}) {
  return {
    parentNode: {}, // truthy = still attached to the DOM
    _src: "https://example.test/tiles/1/2/3.png",
    get src() { return this._src; },
    set src(v) { this._src = v; },
    getAttribute(name) { return name === "src" ? this._src : null; },
    classList: { contains: (cls) => (cls === "leaflet-tile-loaded" ? painted : false) },
    getBoundingClientRect: () => ({ x: 100, y: 200, width: 256, height: 256 }),
  };
}

function fakeGridWithEls(specs) {
  // specs: [{ key, painted, current }]
  const layer = { _tiles: {} };
  specs.forEach(({ key, painted = false, current = true }) => {
    layer._tiles[key] = { el: fakeTileImg({ painted }), coords: { x: 1, y: 2, z: 3 }, current };
  });
  return layer;
}

describe("sweepBlankTiles (B844704 — blank-tile self-heal)", () => {
  it("does nothing when every retained tile has already painted", () => {
    const l = fakeGridWithEls([{ key: "a", painted: true }, { key: "b", painted: true }]);
    expect(sweepBlankTiles(l, { now: 0 })).toBe(0);
  });

  it("leaves a freshly-added unpainted tile alone — it may just be loading", () => {
    const l = fakeGridWithEls([{ key: "a", painted: false }]);
    expect(sweepBlankTiles(l, { now: 0 })).toBe(0); // first sighting, age 0
  });

  it("heals a tile that has sat unpainted past the grace period, and reports it", () => {
    const l = fakeGridWithEls([{ key: "a", painted: false }]);
    const el = l._tiles.a.el;
    const originalSrc = el.src;
    sweepBlankTiles(l, { now: 0 }); // first sighting — starts the clock
    const healed = [];
    const count = sweepBlankTiles(l, { now: STUCK_TILE_GRACE_MS + 1, onHeal: (info) => healed.push(info) });
    expect(count).toBe(1);
    expect(el.src).not.toBe(originalSrc); // reassigned, cache-busted
    expect(el.src.startsWith(originalSrc)).toBe(true);
    expect(healed).toHaveLength(1);
    expect(healed[0]).toMatchObject({ key: "a", coords: { x: 1, y: 2, z: 3 } });
    expect(healed[0].ageMs).toBeGreaterThanOrEqual(STUCK_TILE_GRACE_MS);
    expect(healed[0].rect).toEqual({ x: 100, y: 200, w: 256, h: 256 });
  });

  it("never touches a tile that is not part of the current view", () => {
    const l = fakeGridWithEls([{ key: "a", painted: false, current: false }]);
    const el = l._tiles.a.el;
    const originalSrc = el.src;
    sweepBlankTiles(l, { now: 0 });
    sweepBlankTiles(l, { now: STUCK_TILE_GRACE_MS + 1 });
    expect(el.src).toBe(originalSrc);
  });

  it("stops tracking a tile the instant it paints — a later error restarts its clock", () => {
    const l = fakeGridWithEls([{ key: "a", painted: false }]);
    sweepBlankTiles(l, { now: 0 });
    l._tiles.a.el.classList.contains = () => true; // painted between sweeps
    expect(sweepBlankTiles(l, { now: STUCK_TILE_GRACE_MS + 1 })).toBe(0);
  });

  it("restarts the clock on heal, so it isn't reloaded again every sweep tick", () => {
    const l = fakeGridWithEls([{ key: "a", painted: false }]);
    sweepBlankTiles(l, { now: 0 });
    expect(sweepBlankTiles(l, { now: STUCK_TILE_GRACE_MS + 1 })).toBe(1); // healed once
    expect(sweepBlankTiles(l, { now: STUCK_TILE_GRACE_MS + 100 })).toBe(0); // too soon to be "stuck" again
  });

  it("never throws on a layer with no retained tiles, or no tiles at all", () => {
    expect(() => sweepBlankTiles(null)).not.toThrow();
    expect(sweepBlankTiles({ _tiles: {} }, { now: 0 })).toBe(0);
  });
});

describe("armBlankTileHeal (B844704)", () => {
  it("sweeps on a timer and heals a tile once it clears the grace period", () => {
    vi.useFakeTimers();
    try {
      const l = fakeGridWithEls([{ key: "a", painted: false }]);
      const healed = [];
      const detach = armBlankTileHeal(l, { sweepMs: 1000, onHeal: (info) => healed.push(info) });
      vi.advanceTimersByTime(1000); // first sweep — starts the clock, nothing to heal yet
      expect(healed).toHaveLength(0);
      vi.advanceTimersByTime(STUCK_TILE_GRACE_MS);
      expect(healed).toHaveLength(1);
      detach();
    } finally {
      vi.useRealTimers();
    }
  });

  it("the returned detach function stops the sweep for good", () => {
    vi.useFakeTimers();
    try {
      const l = fakeGridWithEls([{ key: "a", painted: false }]);
      const healed = [];
      const detach = armBlankTileHeal(l, { sweepMs: 1000, onHeal: (info) => healed.push(info) });
      detach();
      vi.advanceTimersByTime(60_000);
      expect(healed).toHaveLength(0); // never armed again — the interval genuinely stopped
    } finally {
      vi.useRealTimers();
    }
  });

  it("never throws when armed on nothing", () => {
    expect(() => armBlankTileHeal(null)()).not.toThrow();
  });
});
