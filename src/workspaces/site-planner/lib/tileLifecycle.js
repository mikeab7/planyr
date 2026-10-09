/* tileLifecycle — the Leaflet-bound half of the tile/overlay memory work. The POLICY
 * (how much overscan, how many tiles) is pure in tileBudget.js; everything that has to
 * touch a live Leaflet layer lives here so it stays in one auditable place.
 *
 * Five jobs:
 *   1. preserveTilesAcrossSetView — stop a `setView` from throwing away tiles it is about
 *      to ask for again (NEW-7, the biggest single load lever).
 *   2. capTileCache — an explicit ceiling on retained tiles, so a long session can't grow
 *      the tile cache without limit (NEW-7).
 *   3. releaseLayer — tear an overlay's RASTER down at toggle-off instead of leaving it to
 *      Leaflet's incidental pruning, and make sure a request still in flight can't
 *      resurrect the layer it belonged to (NEW-6).
 *   4. throttleTilePruning — B854832: coalesce Leaflet's own per-tile `_pruneTiles()` calls
 *      into one per burst instead of one per tile (see its own header below).
 *   5. armBlankTileHeal — B844704: notice a tile that is retained but permanently blank
 *      (errored past `withTileRetry`'s own budget) and force it back to life, on a timer,
 *      for as long as the layer lives. See its own header below for the full mechanism.
 */
import { tilesToEvict, stuckTiles, STUCK_TILE_GRACE_MS } from "./tileBudget.js";

/* ── 1. keep tiles across a same-grid setView ─────────────────────────────────────────
 * Leaflet's Map._resetView fires `viewprereset` on EVERY setView, and GridLayer's handler
 * for it (`_invalidateAll`) removes every tile and every zoom level unconditionally — then
 * `_setView` immediately asks for most of them back. That is what made one scenario load
 * fetch 221 tiles across five zoom levels, ~53% of them transitional levels nobody ever
 * looked at: the progressive fly-in wiped and refetched at each step.
 *
 * But the tiles a GridLayer holds are keyed by NATIVE tile zoom, and the planner drives the
 * basemap at fractional zoom (zoomSnap 0). A commit that moves the fractional zoom without
 * moving the rounded native zoom needs no new tiles at all — the existing ones just shift
 * and rescale. So we skip the wipe exactly when the incoming native tile zoom equals the one
 * we already hold, and let `_setView` do its normal `_resetGrid` / `_update` / `_pruneTiles`
 * pass over the tiles we kept. When the native zoom genuinely changes we fall straight
 * through to Leaflet's own behaviour, unchanged.
 *
 * The caller publishes the zoom it is about to set via `announceSetView` (Leaflet has not
 * applied it yet at `viewprereset` time, so the layer cannot read it off the map).
 */
export function preserveTilesAcrossSetView(layer) {
  if (!layer || layer.__pfTileKeep) return layer;
  const orig = layer._invalidateAll;
  if (typeof orig !== "function") return layer; // not a GridLayer (or a Leaflet we don't know) — leave it alone
  layer.__pfTileKeep = true;
  layer._invalidateAll = function () {
    const target = this.__pfTargetZoom;
    if (target != null && this._tileZoom !== undefined && typeof this._clampZoom === "function") {
      try {
        if (this._clampZoom(Math.round(target)) === this._tileZoom) return; // same tile grid → keep every tile
      } catch (_) { /* fall through to the stock wipe */ }
    }
    return orig.call(this);
  };
  return layer;
}

/* Publish the zoom `map.setView` is about to be called with, run the commit, then clear it —
 * so a setView from anywhere ELSE (which we know nothing about) always takes Leaflet's
 * stock wipe rather than silently keeping stale tiles. */
export function announceSetView(layers, zoom, fn) {
  const list = (Array.isArray(layers) ? layers : [layers]).filter(Boolean);
  list.forEach((l) => { l.__pfTargetZoom = zoom; });
  try { return fn(); }
  finally { list.forEach((l) => { l.__pfTargetZoom = null; }); }
}

/* ── 2. bound the tile cache ──────────────────────────────────────────────────────────
 * Leaflet prunes tiles to `keepBuffer` rings, but only incidentally — the measured session
 * held ~500 tile <img> and only shed them when an unrelated pan happened to prune. This is
 * an explicit ceiling: past `limit` retained tiles, drop the furthest non-current ones.
 * Current tiles are never touched, so this can't punch a hole in the visible aerial.
 *
 * B854832 — `map.getCenter()` and `map.project(center, z)` used to be called ONCE PER TILE
 * inside the distance loop, even though the center is the same point for every tile in one
 * call and `project` at a given zoom only differs when `z` differs (normally one, sometimes
 * two, distinct zooms are retained at once). At the tile counts a real aerial re-anchor
 * retains (250+), that was up to 250 redundant `getCenter`/`project` calls on every single
 * "load"/"moveend" firing — real work (unprojecting a lat/lng through the map's CRS) paid
 * for an answer that does not change within the call. Hoisted out; `project` is memoised
 * per distinct zoom so this is now O(1) `getCenter` + O(distinct zooms) `project`. */
export function capTileCache(layer, limit) {
  if (!layer || !layer._tiles || !layer._map) return 0;
  const map = layer._map;
  let center = null;
  try { center = map.getCenter(); } catch (_) { center = null; }
  const tileSize = (layer.getTileSize && layer.getTileSize().x) || 256;
  const projectedAtZoom = new Map();
  const centerTileFor = (z) => {
    if (projectedAtZoom.has(z)) return projectedAtZoom.get(z);
    let cp = null;
    try { cp = center ? map.project(center, z).divideBy(tileSize) : null; } catch (_) { cp = null; }
    projectedAtZoom.set(z, cp);
    return cp;
  };
  const entries = Object.keys(layer._tiles).map((key) => {
    const t = layer._tiles[key];
    const c = t && t.coords;
    let distance = 0;
    const cp = c ? centerTileFor(c.z) : null;
    if (cp) {
      try { distance = Math.max(Math.abs(cp.x - c.x), Math.abs(cp.y - c.y)); } catch (_) { distance = 0; }
    }
    return { key, current: !!(t && t.current), active: !!(t && t.active), loaded: !!(t && t.loaded), distance };
  });
  const drop = tilesToEvict(entries, limit);
  drop.forEach((key) => { try { layer._removeTile(key); } catch (_) {} });
  return drop.length;
}

/* Keep a tile layer under its cap for as long as it is on the map. Returns a detach fn. */
export function boundTileCache(layer, limitFn) {
  if (!layer || typeof layer.on !== "function") return () => {};
  const run = () => { try { capTileCache(layer, limitFn()); } catch (_) {} };
  layer.on("load", run);
  layer.on("moveend", run);
  return () => { try { layer.off("load", run); layer.off("moveend", run); } catch (_) {} };
}

/* ── 3. release an overlay for real ───────────────────────────────────────────────────
 * Measured (NEW-6): toggling 23 overlays off released 780 of 782 SVG elements — the vector
 * teardown is already correct — but 0 of 51 overlay TILES. They lingered until an unrelated
 * later pan happened to prune them. Two causes, both fixed here:
 *   • esri-leaflet's raster layers hold their painted `<img>` on `_currentImage`, and a
 *     request already in flight when the layer is removed re-adds a FRESH image on resolve —
 *     so the layer quietly puts itself back on a map it was removed from.
 *   • grid/tile children of a layer group keep their whole `_tiles` map alive.
 * `releaseLayer` walks the layer (and, for a group, its children), aborts what it can,
 * removes the raster DOM, and leaves a tombstone that makes any later `onAdd` a no-op.
 */
export function releaseLayer(map, layer) {
  if (!layer || layer === "pending") return;
  // Tombstone FIRST: whatever resolves after this point must find a dead layer.
  try { layer.__pfReleased = true; } catch (_) {}
  // Abort anything the layer itself knows how to cancel (evidence/vector layers expose a
  // controller; esri-leaflet does not, so its in-flight request is neutralised by the
  // tombstone + the onAdd block below rather than cancelled).
  try { if (layer.__pfAbort && typeof layer.__pfAbort.abort === "function") layer.__pfAbort.abort(); } catch (_) {}
  try { if (typeof layer.abortPending === "function") layer.abortPending(); } catch (_) {}

  // Children first, so a group's tile/raster children are released before the group leaves
  // the map (after removal `eachLayer` still works, but the child's `_map` is gone).
  try { if (typeof layer.eachLayer === "function") layer.eachLayer((child) => releaseLayer(map, child)); } catch (_) {}

  try { if (map && typeof map.removeLayer === "function") map.removeLayer(layer); } catch (_) {}

  // esri-leaflet RasterLayer: drop the painted image AND the reference that keeps its
  // decoded bitmap alive.
  try {
    const img = layer._currentImage;
    if (img) {
      if (map && typeof map.removeLayer === "function") { try { map.removeLayer(img); } catch (_) {} }
      const el = img._image || (typeof img.getElement === "function" ? img.getElement() : null);
      if (el && el.parentNode) el.parentNode.removeChild(el);
      layer._currentImage = null;
    }
  } catch (_) {}

  // GridLayer: drop every retained tile and its level containers now, not whenever a later
  // pan happens to prune.
  try { if (typeof layer._removeAllTiles === "function") layer._removeAllTiles(); } catch (_) {}
  try {
    if (layer._levels) {
      Object.keys(layer._levels).forEach((z) => {
        const el = layer._levels[z] && layer._levels[z].el;
        if (el && el.parentNode) el.parentNode.removeChild(el);
        delete layer._levels[z];
      });
    }
  } catch (_) {}

  // A resolve that lands after removal must not put the layer back. esri-leaflet's async
  // paths all funnel through onAdd/_renderImage; blocking both makes the removal final.
  try {
    layer.onAdd = function () { return this; };
    if (typeof layer._renderImage === "function") layer._renderImage = function () {};
  } catch (_) {}
}

/* ── 4. throttle Leaflet's own per-tile prune ─────────────────────────────────────────
 * B854832 — the owner's own production perf capture (build 396be34, plan smt7q6ar8egz
 * "Concept A"/Richfield, 2026-08-29) shows first paint of a plan whose aerial is NOT already
 * anchored blocking the main thread across five long-animation-frame blocks (428–606ms,
 * ~6.5s total) while the tile layers come up (2 -> 4) and retained tiles jump 90 -> 257, all
 * five attributed to invoker "FrameRequestCallback" with an empty sourceFunctionName — an
 * ANONYMOUS function Leaflet itself scheduled via `Util.requestAnimFrame`, never React's own
 * MessageChannel-driven scheduler (ruled out by the invoker alone) and not contours/terrain
 * (no terrain-tile-timing event in the episode) or a leaking cache (257 is under the cap).
 *
 * Read straight from `node_modules/leaflet/dist/leaflet-src.js`'s `GridLayer._tileReady`: with
 * `fadeAnimation:false` (this map's own construction option — SitePlanner.jsx's map disables
 * it for an unrelated flyTo reason), EVERY SINGLE TILE calls `this._pruneTiles()` the instant
 * it finishes loading — not once per burst, once per tile:
 *
 *     if (this._map._fadeAnimated) { ...queue a fade... }
 *     else { tile.active = true; this._pruneTiles(); }
 *
 * `_pruneTiles()` is O(retained tiles): three separate `for (key in this._tiles)` passes, the
 * middle one walking up to 5 parent levels and down 2 child levels (`_retainParent`/
 * `_retainChildren`) for every tile that is "current" but not yet "active" — exactly the state
 * of every tile still loading during a burst. A re-anchor that brings up ~150+ new tiles in
 * quick succession therefore reruns that whole O(n) pass roughly once per tile that resolves,
 * an O(tiles-loading × tiles-retained) cost for work whose end state does not depend on how
 * many times it ran in between — `_pruneTiles` only decides what should currently be retained,
 * so calling it once after the burst settles instead of once per tile in the middle of it
 * changes nothing about what is on screen (current tiles are never pruned; see `tile.retain =
 * tile.current` at the top of the function), only how many times the decision gets repeated.
 * Leaflet already reaches the same conclusion for the FADE-animated path (there it queues onto
 * one shared rAF loop instead of pruning per tile); this restores that coalescing for the
 * non-fade path this map actually uses, without touching `fadeAnimation` (which is off here
 * for its own, unrelated, already-shipped reason).
 *
 * Deferred via a MessageChannel-posted macrotask rather than `requestAnimationFrame`, for the
 * same MEASURED reason `paintSchedule.js` gives (see its header): Leaflet's own tile-ready path
 * ALSO schedules a `requestAnimFrame(this._pruneTiles, this)` once the burst's last tile
 * resolves, and the browser runs every rAF callback due for a frame back-to-back with no yield
 * in between — deferring via rAF here would just line this call up alongside that one and
 * whatever else is scheduled for the same frame, buying no separation. A macrotask genuinely
 * hands control back to the browser between the burst and the (now singular) prune.
 *
 * Every call still runs `_pruneTiles` exactly once, eventually — this coalesces repeats within
 * one burst, it never skips the work. */
export function throttleTilePruning(layer, defer = (fn) => {
  const ch = new MessageChannel();
  ch.port1.onmessage = () => { try { fn(); } finally { ch.port1.close(); ch.port2.close(); } };
  ch.port2.postMessage(0);
}) {
  if (!layer || layer.__pfPruneThrottled) return layer;
  const orig = layer._pruneTiles;
  if (typeof orig !== "function") return layer;
  layer.__pfPruneThrottled = true;
  let pending = false;
  layer._pruneTiles = function () {
    if (pending) return;
    pending = true;
    defer(() => { pending = false; try { orig.call(layer); } catch (_) {} });
  };
  return layer;
}

/* ── 5. blank-tile self-heal (B844704) ────────────────────────────────────────────────
 * Owner report: a flat, opaque, light-grey square lingering over the dashboard map's aerial
 * (planyr.io/#/, Sites list, zoomed out over Houston) with no border/text/spinner, still there
 * unchanged after 45+ seconds. Root cause, traced through Leaflet's own source
 * (node_modules/leaflet/dist/leaflet-src.js): `GridLayer._tileReady` stamps `tile.loaded` on
 * EVERY outcome (so Leaflet's own grid update never revisits that tile again) but adds the
 * `leaflet-tile-loaded` class — the only thing `leaflet.css`'s `.leaflet-tile { visibility:
 * hidden }` / `.leaflet-tile-loaded { visibility: inherit }` pair ever un-hides — ONLY when the
 * load did not error. `withTileRetry` (layers.js) gives an errored tile two quick retries
 * (~1.5 s total) and then stops listening entirely. A tile whose retries ALSO fail (a rate
 * limit, a DNS hiccup, a cold host — nothing exotic) is therefore invisible FOREVER and Leaflet
 * itself will never ask for it again: `.leaflet-container`'s own flat, hardcoded light-grey
 * background (leaflet.css) shows through the gap — a borderless, tile-sized square. On a static
 * camera (the dashboard map isn't being panned) nothing ever gives the grid a reason to reset,
 * so it can sit there indefinitely, matching the report exactly.
 *
 * THE FIX HAS TWO HALVES ON PURPOSE. `withTileRetry`'s own budget stays deliberately small — a
 * genuinely dead host should not be hammered on every tile forever. This is the backstop: a slow,
 * bounded sweep of the SAME tile pane that finds any RETAINED ("current") tile still missing
 * `leaflet-tile-loaded` after `STUCK_TILE_GRACE_MS` — regardless of why, so it also covers a
 * future bug that leaves a tile in the same state — and forces one more real reload by
 * reassigning a cache-busted `src`. That reassignment re-enters Leaflet's own `load`/`error`
 * handlers (already bound at tile creation), so a reload that succeeds is indistinguishable from
 * an ordinary tile load: `leaflet-tile-loaded` gets added the normal way and the sweep leaves it
 * alone from then on. This is therefore the generic, "whatever the cause" self-heal the standing
 * guarantee requires for THIS surface (a Leaflet `<img>` tile grid) — it does not, and cannot,
 * cover a different painting mechanism (an offscreen `<canvas>` release, for instance); see
 * BACKLOG.md B844704 for what was checked and ruled out there.
 *
 * `graceMs` must clear ordinary load time by a wide margin so a merely-slow tile is never
 * interrupted mid-flight — 5 s is generous even on a poor connection (a real fetch here settles
 * in well under a second in practice). `sweepMs` is how often the pane is checked. Track "how
 * long has THIS tile been unpainted" in a WeakMap keyed on the `<img>` itself (not on Leaflet's
 * own tile record, which is reused/mutated) so GC reclaims the bookkeeping the moment a tile is
 * pruned — no manual cleanup needed. */
const _tileStuckSince = new WeakMap(); // <img> element -> ms timestamp first seen unpainted

function cacheBustedSrc(src) {
  const s = String(src || "");
  if (!s) return s;
  const sep = s.indexOf("?") === -1 ? "?" : "&";
  return s + sep + "_heal=" + Date.now().toString(36);
}

/* One pass over a layer's retained tiles: heal anything stuck, report what was healed. Pure
 * side-effecting DOM work over `layer._tiles` (Leaflet's own live map) — never throws. Returns
 * the number of tiles reloaded this pass. `onHeal({ key, coords, ageMs, rect })` fires once per
 * healed tile, `rect` being the tile's own on-screen box (`getBoundingClientRect`) at heal time —
 * everything a report needs to name what was blank and where. */
export function sweepBlankTiles(layer, { graceMs = STUCK_TILE_GRACE_MS, now = Date.now(), onHeal } = {}) {
  if (!layer || !layer._tiles) return 0;
  const t = typeof now === "function" ? now() : now;
  const records = [];
  const byKey = {};
  Object.keys(layer._tiles).forEach((key) => {
    const rec = layer._tiles[key];
    const el = rec && rec.el;
    if (!el || !el.parentNode) { return; }
    const painted = !!(el.classList && el.classList.contains("leaflet-tile-loaded"));
    if (painted) { _tileStuckSince.delete(el); return; }
    let since = _tileStuckSince.get(el);
    if (since == null) { since = t; _tileStuckSince.set(el, since); }
    byKey[key] = { rec, el };
    records.push({ key, current: !!rec.current, painted: false, ageMs: t - since });
  });
  const heal = stuckTiles(records, graceMs);
  heal.forEach((key) => {
    const found = byKey[key];
    if (!found) return;
    const { rec, el } = found;
    try {
      const ageMs = (records.find((r) => r.key === key) || {}).ageMs || 0;
      const rect = (typeof el.getBoundingClientRect === "function") ? el.getBoundingClientRect() : null;
      el.src = cacheBustedSrc(el.getAttribute ? el.getAttribute("src") : el.src);
      _tileStuckSince.set(el, t); // restart this tile's clock so a repeat failure re-grace-periods rather than reload every sweep tick
      if (onHeal) {
        onHeal({
          key, ageMs, coords: rec && rec.coords,
          rect: rect ? { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) } : null,
        });
      }
    } catch (_) {}
  });
  return heal.length;
}

/* Arm the sweep on a live tile layer for as long as it stays on the map. Returns a detach fn —
 * callers tear it down alongside their other per-layer listeners (`boundTileCache`'s own detach,
 * `releaseLayer`). `sweepMs` is deliberately independent of the map's `visible`/active state: the
 * scan is a handful of cheap DOM reads over an already-small retained set, so there is no reason
 * to gate it the way the heavier GIS-overlay re-probe is gated — a tile that went stuck while the
 * view was hidden is exactly the kind of thing that should already be fixed by the time the user
 * comes back to look at it. */
export function armBlankTileHeal(layer, { sweepMs = 2500, graceMs = STUCK_TILE_GRACE_MS, onHeal } = {}) {
  if (!layer) return () => {};
  const iv = setInterval(() => { try { sweepBlankTiles(layer, { graceMs, onHeal }); } catch (_) {} }, sweepMs);
  return () => clearInterval(iv);
}

/* ── 6. pace tile LOADS so a whole grid never lands in one burst (B2225425 round 3) ─────────────────
 * A plan switch remounts the planner and with it the Leaflet map, so every aerial tile of the new view is requested at once —
 * 112–252 tiles on the owner's Grand Port plans at a 2.15 device ratio (detail layer, retina path). When they answer together
 * (the browser's cache on a plan already opened this session; the sandbox rig's instant replies) the main thread handles ~4
 * loader tasks per tile back to back: measured 1,012 tasks / 242 ms of main-thread time inside ONE 335 ms heartbeat gap, with
 * no single task over 45 ms. A posted message (the owner's MessageChannel heartbeat — and React's own scheduler) waits behind
 * all of them, so it reads as a freeze even though no one task is long.
 *
 * The fix bounds how many tiles are IN FLIGHT at once: a tile's `src` is assigned only while fewer than `maxInFlight` tiles are
 * loading; each `load`/`error` releases the next. A cached tile completes almost at once, so a revisit becomes a steady trickle
 * interleaved with everything else instead of one wall; a network tile is latency-bound and `maxInFlight` is set well above any
 * per-host limit that would matter. Nothing is skipped and nothing is reordered: tiles start in the order Leaflet asked for them
 * (centre-out — GridLayer sorts by distance), and a tile Leaflet has already discarded before its turn is never fetched.
 *
 * Mechanism: `createTile` is Leaflet 1.9's own `TileLayer.createTile` with the one `tile.src = url` line routed through the
 * pacer — same listeners (its own `_tileOnLoad` / `_tileOnError`), same attributes. A layer without those private hooks (another
 * Leaflet version) is left untouched rather than half-wrapped. Retries (`withTileRetry`) and the blank-tile heal reassign `src`
 * directly; they are rare and stay outside the pacer by design. */
export function createTilePacer({ maxInFlight = 24 } = {}) {
  const queue = [];
  let inFlight = 0;
  const stats = { started: 0, dropped: 0, peak: 0 };
  const settle = () => { inFlight = Math.max(0, inFlight - 1); pump(); };
  function start(job) {
    inFlight++; stats.started++; stats.peak = Math.max(stats.peak, inFlight);
    let done = false;
    const fin = () => { if (done) return; done = true; job.tile.removeEventListener("load", fin); job.tile.removeEventListener("error", fin); settle(); };
    job.tile.addEventListener("load", fin);
    job.tile.addEventListener("error", fin);
    job.tile.src = job.url;
  }
  function pump() {
    while (inFlight < maxInFlight && queue.length) {
      const job = queue.shift();
      // discarded by Leaflet while it waited (pruned / layer removed): never fetch it. B2233521 — "discarded" is "Leaflet took it OUT OF ITS
      // TILE CONTAINER" (`parentNode` null), never "not in the document": a kept planner's whole map is detached from the page while you are
      // on another plan (lib/plannerKeepAlive.js), and reading `isConnected` dropped every tile it still had queued — they stayed unpainted,
      // and the blank-tile heal then cache-busted and re-downloaded the whole grid the moment the plan was shown again.
      if (job.started === false && job.tile.__pfAttached && !job.tile.parentNode) { stats.dropped++; continue; }
      job.started = true;
      start(job);
    }
  }
  return {
    schedule(tile, url) { queue.push({ tile, url, started: false }); pump(); },
    attached(tile) { tile.__pfAttached = true; },
    get inFlight() { return inFlight; },
    get queued() { return queue.length; },
    stats,
  };
}
const _sharedPacer = createTilePacer();
export function paceTileLoads(layer, pacer = _sharedPacer) {
  if (!layer || layer.__pfPaced) return layer;
  if (typeof layer._tileOnLoad !== "function" || typeof layer._tileOnError !== "function" || typeof layer.getTileUrl !== "function") return layer;
  layer.__pfPaced = true;
  layer.createTile = function (coords, done) {
    const tile = document.createElement("img");
    tile.addEventListener("load", this._tileOnLoad.bind(this, done, tile));
    tile.addEventListener("error", this._tileOnError.bind(this, done, tile));
    if (this.options.crossOrigin || this.options.crossOrigin === "") tile.crossOrigin = this.options.crossOrigin === true ? "" : this.options.crossOrigin;
    if (typeof this.options.referrerPolicy === "string") tile.referrerPolicy = this.options.referrerPolicy;
    tile.alt = "";
    const url = this.getTileUrl(coords);
    // Leaflet appends the tile right after createTile returns; from then on a disconnected tile means "discarded"
    queueMicrotask(() => pacer.attached(tile));
    pacer.schedule(tile, url);
    return tile;
  };
  return layer;
}

/* ── 7. position tiles FLAT, not each on its own compositor layer (B2233521) ─────────────────────────────────────
 * Leaflet places every tile with `transform: translate3d(x, y, 0)`. A 3D transform promotes each tile `<img>` to its own compositor
 * layer — on a planner map that is 150–250 layers. They are normally created a few at a time as tiles arrive, but a KEPT planner shown
 * again (lib/plannerKeepAlive.js) brings its whole retained grid back in one frame, and handing that many layers to the compositor at once
 * is a single 20–40 ms frame with no script in it (measured in a Chromium trace of the re-show; with the tiles positioned flat the same
 * re-show read 31–43 ms on the heartbeat at 2× CPU against 53–77 ms before). This map is a slaved backdrop whose tiles never animate
 * individually (zoom/fade animation are off; a gesture moves the whole map container), so a tile gains nothing from its own layer.
 * Mechanism: after Leaflet's own `_addTile` has positioned the tile, the same position is re-expressed as `left`/`top` — exactly what
 * Leaflet itself does when 3D is unavailable (`DomUtil.setPosition`'s other branch), and `_leaflet_pos` is untouched. Tiles are positioned
 * once, when added, so nothing later re-applies the transform. A layer without the private hooks is left untouched. */
export function flattenTilePositions(layer) {
  if (!layer || layer.__pfFlat || typeof layer._addTile !== "function" || typeof layer._tileCoordsToKey !== "function") return layer;
  layer.__pfFlat = true;
  const orig = layer._addTile;
  layer._addTile = function (coords, container) {
    const out = orig.call(this, coords, container);
    try {
      const rec = this._tiles && this._tiles[this._tileCoordsToKey(coords)];
      const el = rec && rec.el, p = el && el._leaflet_pos;
      if (el && p) { el.style.transform = ""; el.style.left = `${p.x}px`; el.style.top = `${p.y}px`; }
    } catch (_) { /* positioning stays Leaflet's own */ }
    return out;
  };
  return layer;
}
