/* View-driven terrain layers (B704 contours, B705 drainage arrows) + the shared DEM
 * grid registry the hover readout samples (B706).
 *
 * Main-thread half of the terrain pipeline. Modeled on overpassLayer
 * (evidenceLayers.js): L.layerGroup + moveend refresh + busy/pending trailing-edge
 * guard (B56d) + gisCache.swr last-good painting — with the terrain-specific parts:
 *
 *  - THE GRID IS ANCHORED TO THE GROUND, NOT THE VIEWPORT (NEW-2). A refresh asks
 *    demGrid for the FIXED LATTICE TILES covering the view (`latticeCover`) and traces
 *    each one independently. A tile is a pure function of (zoom band, tx, ty), so the
 *    same ground is always traced from the same cells: pan away and back and the lines,
 *    the labels, and their positions are identical, and an already-traced tile is a
 *    plain cache hit. The predecessor requested ONE viewport-sized tile and coarsened
 *    it for that viewport, so every gesture moved the cell lattice AND the tile border
 *    — which is what made 1-ft contours (traced off ±0.1–0.3 ft LiDAR noise) visibly
 *    re-roll, and what put a moving line-break wherever the last tile happened to end.
 *  - A SUPERSESSION TOKEN, NOT JUST A MOUNT GUARD (NEW-1). Every refresh takes
 *    `mySeq = ++seq` and bails after EVERY await when a newer refresh (or an onRemove)
 *    has bumped it — exact parity with vectorOverlay.js. The old `if (!map) return`
 *    mount guard alone let a superseded compute paint into a still-mounted group, which
 *    is how two "150 ft" labels ended up stacked three characters apart and how a
 *    previous view's "155 ft" lingered over ground the live view traces as 150 ft.
 *    The fetch still rides gisCache.swr UNCANCELLED (aborting would poison the shared
 *    cache — B36(e)'s decision); a superseded result is simply never painted.
 *  - ONE grid fetch per lattice tile, shared by both layers AND the hover readout:
 *    the in-flight map dedupes concurrent refreshes (contours + arrows toggled
 *    together fire a single exportImage + a single worker job per tile), and both
 *    layers read the same swr artifact key.
 *  - The fetch runs HERE (not in the worker): gisCache is localStorage-backed and the
 *    proxy→direct fallback belongs beside its wireRaster precedent. Bytes transfer to
 *    the singleton worker; the decoded grid transfers back and lands in a small LRU
 *    registry (plain Map — a Float32Array must NEVER go through gisCache.write, which
 *    JSON.stringifies unconditionally). Only the JSON contour/arrow artifact is
 *    persisted; after a reload the lines paint instantly from swr while the grid
 *    refills in the background.
 *  - Polylines draw through a dedicated L.canvas renderer per layer instance (SVG DOM
 *    churn with hundreds of paths per pan is the perf cliff); labels are divIcon
 *    markers with the white-halo convention; everything interactive:false so terrain
 *    never intercepts site clicks.
 *  - setOpacity restyles in place (mapillary pattern) — no clear+rerender jank.
 */
import L from "leaflet";
import TerrainWorker from "./terrainWorker.js?worker";
import { gisCache } from "./gisCache.js";
import { TERRAIN_MIN_ZOOM } from "./terrainGate.js";
import { proxyServiceUrl } from "../../../shared/gis/gisProxyCore.js";
import { DEP_URL, M_TO_FT } from "./elevation.js";
import {
  gridRequest, exportUrl, looksLikeLerc, sampleAtLatLng, mercToPixel,
  lngToMercX, latToMercY, groundScale, mercPerPx, mercYToLat,
  latticeCover, latticeTileAt, LATTICE_MAX_BAND, LATTICE_MIN_BAND,
} from "./demGrid.js";
import {
  composeContourPaint, contourLabelText, buildContourIndex, hitContour,
  hoverLabelPlacement, hoverLabelSize,
  HOVER_TOL_PX, DOUBLE_STAMP_PX,
} from "./contours.js";

// The gate lives in a leaf module so `layers.js` can read it without static-importing this
// whole pipeline (B1095 — the pipeline is loaded on demand via terrainLazy.js).
export { TERRAIN_MIN_ZOOM } from "./terrainGate.js";
const TERRAIN_TTL = 7 * 24 * 60 * 60 * 1000; // DEM vintage moves slowly — a week is generous
const GRID_LRU_MAX = 12;                     // lattice tiles: ~1.4 MB each, a laptop view is ~4–6
const SITE_GRID_LRU_MAX = 4;                 // site envelopes: up to ~5 MB each — keep few
const FETCH_TIMEOUT_MS = 20000;
const MAX_CONCURRENT_TILES = 4;              // a wide view wants ~12 tiles; don't open 12 sockets

// ---------------------------------------------------------------------------
// Singleton worker with lazy rebuild after a crash (a crashed worker stays crashed —
// every pending job fails LOUDLY, the next refresh spins a fresh one).
let worker = null, seq = 0;
const pending = new Map(); // id -> {resolve, reject}
function getWorker() {
  if (worker) return worker;
  worker = new TerrainWorker();
  worker.onmessage = (e) => {
    const d = e.data || {};
    const p = pending.get(d.id);
    if (!p) return;
    pending.delete(d.id);
    if (d.ok) p.resolve(d);
    else p.reject(new Error(d.error || "terrain worker error"));
  };
  worker.onerror = (e) => {
    const err = new Error(`terrain worker crashed${e && e.message ? `: ${e.message}` : ""}`);
    for (const p of pending.values()) p.reject(err);
    pending.clear();
    try { worker.terminate(); } catch (_) { /* already dead */ }
    worker = null;
  };
  return worker;
}
if (import.meta.hot) import.meta.hot.dispose(() => { try { worker && worker.terminate(); } catch (_) {} worker = null; });

// ---------------------------------------------------------------------------
// Grid registry (B706): the last few decoded grids, newest last. Distinguishes
// "no grid covers this point" (undefined → the readout may fall back to a network
// sample) from "covered but VOID" (null → suppress, never invent water elevations).
const gridLru = new Map(); // key -> { req, grid }
const rememberGrid = (key, req, grid) => {
  gridLru.delete(key);
  gridLru.set(key, { req, grid });
  while (gridLru.size > GRID_LRU_MAX) gridLru.delete(gridLru.keys().next().value);
};
export function sampleTerrainGrids(lat, lng) {
  const r = sampleTerrainGridsInfo(lat, lng);
  return r.status === "value" ? r.ft : r.status === "void" ? null : undefined;
}

/* The same local sample, with the provenance the NEW-2 readout needs: which of the
 * three honest states this point is in, and how much GROUND one cell of the grid that
 * answered covers. A coarse cell is not a reason to refuse to sample a point — it is a
 * reason to SAY the sample is coarse (the chip marks it and the tooltip explains). */
export function sampleTerrainGridsInfo(lat, lng) {
  const x = lngToMercX(lng), y = latToMercY(lat);
  let covered = false;
  for (const { req, grid } of [...gridLru.values()].reverse()) {
    const [px, py] = mercToPixel(req, x, y);
    if (px < 1 || py < 1 || px > req.width - 1 || py > req.height - 1) continue;
    covered = true;
    const v = sampleAtLatLng(grid, req, lat, lng);
    if (v != null) return { status: "value", ft: v, cellFt: req.cellMeters * groundScale(lat) * M_TO_FT };
  }
  return covered ? { status: "void" } : { status: "uncovered" };
}

/* NEW-2(b) — keep ONE lattice tile under the cursor warm, whatever the layer toggles
 * say and whatever the zoom is. The z16 gate exists because 1-ft CONTOUR LINES traced
 * off a coarse cell are cartographic mush; that is no reason to refuse to SAMPLE A
 * POINT, which is why this path is deliberately ungated. The tile is the SAME
 * `latticeTile` the contour layer asks for at this zoom, so with contours on this is a
 * plain cache hit and costs no extra fetch.
 *
 * It calls computeTile DIRECTLY rather than through gisCache.swr: swr serves the cached
 * JSON contour artifact WITHOUT ever running the fetch, so a view painted from cache
 * leaves the grid registry empty — which is exactly why the readout's fast path went
 * missing after a reload even with contours on. The grid only ever lands in the LRU by
 * way of a real computeTile run.
 *
 * Returns a promise that settles when the tile's grid is in the registry (or rejects
 * LOUDLY). A failed tile is not retried for FAIL_COOLDOWN_MS, so a dead endpoint can't
 * be hammered once per cursor move. */
const WARM_FAIL_COOLDOWN_MS = 30000;
const warmFailed = new Map(); // tile key -> ts of the last failure
export function warmCursorGrid(lat, lng, zoom, { fetchImpl, now = Date.now } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return Promise.reject(new Error("no position"));
  const band = Math.min(LATTICE_MAX_BAND, Math.max(LATTICE_MIN_BAND,
    Number.isFinite(zoom) ? Math.round(zoom) : LATTICE_MAX_BAND));
  const tile = latticeTileAt(lat, lng, band);
  if (gridLru.has(tile.key)) return Promise.resolve(tile.key);
  const cur = inflight.get(tile.key);
  if (cur) return cur.then(() => tile.key);
  const failedAt = warmFailed.get(tile.key);
  if (failedAt != null && now() - failedAt < WARM_FAIL_COOLDOWN_MS) {
    return Promise.reject(new Error("terrain grid unavailable here"));
  }
  return computeTile(tile, { fetchImpl }).then(
    () => { warmFailed.delete(tile.key); return tile.key; },
    (e) => { warmFailed.set(tile.key, now()); throw e; },
  );
}

// ---------------------------------------------------------------------------
// One fetch+compute per tile, deduped. The proxy is tried first (durable Drive copy,
// outage fallback — B445); anything that isn't LERC (dev server's SPA index.html, the
// proxy's fail-open 302 landing somewhere odd, an agency error page) falls back ONCE
// to the direct agency URL (CORS-ok — sampleProfile fetches this host directly today).
async function fetchGridBytes(req, fetchImpl) {
  const tryBase = async (base) => {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS) : null;
    let r;
    try {
      r = await (fetchImpl || fetch)(exportUrl(req, base), ctrl ? { signal: ctrl.signal } : undefined);
    } finally { if (timer) clearTimeout(timer); }
    if (!r.ok) throw new Error(`3DEP HTTP ${r.status}`);
    const buf = await r.arrayBuffer();
    if (!looksLikeLerc(buf)) throw new Error("not a LERC payload");
    return buf;
  };
  try { return await tryBase(proxyServiceUrl(DEP_URL)); }
  catch (_) { return await tryBase(DEP_URL); }
}

// A view now asks for SEVERAL lattice tiles at once (NEW-2). Fetching them all at the
// same instant would stall the browser's per-host connection pool and the map's own tile
// requests, so tile jobs queue behind a small semaphore. Order is FIFO — the tiles the
// cover listed first (top row, west→east) land first.
let running = 0;
const waiters = [];
const acquireSlot = () => {
  if (running < MAX_CONCURRENT_TILES) { running++; return Promise.resolve(); }
  return new Promise((res) => waiters.push(res));
};
const releaseSlot = () => {
  const next = waiters.shift();
  if (next) next(); // hand the slot straight on
  else running--;
};

const inflight = new Map(); // req.key -> Promise<artifact>
function computeTile(req, { fetchImpl } = {}) {
  const cur = inflight.get(req.key);
  if (cur) return cur;
  const job = (async () => {
    await acquireSlot();
    let buf;
    try { buf = await fetchGridBytes(req, fetchImpl); }
    catch (e) { releaseSlot(); throw e; }
    releaseSlot();
    const id = ++seq;
    const res = await new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      getWorker().postMessage({ id, req, buffer: buf }, [buf]);
    });
    rememberGrid(req.key, req, res.grid);
    return { contours: res.contours, arrows: res.arrows };
  })();
  const clean = () => { if (inflight.get(req.key) === job) inflight.delete(req.key); };
  job.then(clean, clean);
  inflight.set(req.key, job);
  return job;
}

// ---------------------------------------------------------------------------
// B808 — ONE bare-earth grid over a SITE's WGS84 envelope, for the mitigation engine's
// per-cell existing grade (and B826's proposed-surface lattice later). Reuses the exact
// tile plumbing above — gridRequest's deterministic snap/coarsen, fetchGridBytes'
// proxy-first + LERC-sniff path — but decodes on the caller's thread (one small decode
// per explicit drainage check; no worker round-trip, no Leaflet). The zoom is chosen so
// a cell is ≤ ~3 m of GROUND at the site latitude (fine enough for screening relief;
// gridRequest self-coarsens if the envelope would exceed MAX_GRID). Cached by req.key
// (the request is deterministic, so the same site re-checks are pure hits). LOUD:
// failure REJECTS — the caller records grid-unavailable and falls back to the labeled
// median, never a silent flat price.
const SITE_GRID_TARGET_GROUND_M = 3;
const _siteGrids = new Map(); // req.key -> Promise<{grid, req}>
export function siteGridZoom(lat) {
  // smallest integer zoom whose cell (CELL_PX px) is ≤ the ground-meter target
  for (let z = 12; z <= 19; z++) {
    if (mercPerPx(z) * 2 * groundScale(lat) <= SITE_GRID_TARGET_GROUND_M) return z;
  }
  return 19;
}
export function fetchSiteGrid(bounds, { fetchImpl, zoom } = {}) {
  const lat = (bounds.south + bounds.north) / 2;
  const req = gridRequest(bounds, zoom ?? siteGridZoom(lat));
  const cur = _siteGrids.get(req.key);
  if (cur) return cur;
  const job = (async () => {
    const buf = await fetchGridBytes(req, fetchImpl);
    // B1042 — the LERC codec loads only now, alongside the bytes it decodes, so it never
    // rides the planner's boot bundle. We're already inside an await; the chunk fetch
    // overlaps nothing the user is waiting on beyond the grid request itself.
    const { decodeGrid } = await import("./lercGrid.js");
    const grid = decodeGrid(buf, req);
    return { grid, req };
  })();
  // a failed fetch must not poison the cache — the next check retries
  job.catch(() => { if (_siteGrids.get(req.key) === job) _siteGrids.delete(req.key); });
  _siteGrids.set(req.key, job);
  if (_siteGrids.size > SITE_GRID_LRU_MAX) _siteGrids.delete(_siteGrids.keys().next().value);
  return job;
}

// ---------------------------------------------------------------------------
// Rendering. Fixed hex (not theme tokens) is correct here — these draw over aerial
// imagery, which doesn't theme (same rule as the coordinate chips / SVG exports).
const CONTOUR_COL = "#7C3F12";        // topo brown, readable on green imagery
const CONTOUR_INDEX_COL = "#5B2E0D";
const ARROW_COL = "#0369A1";          // drainage blue (not the status palette)
export const CONTOUR_HOVER_CLASS = "planyr-contour-hover"; // marks the ONE transient hover label

/* `offset` (NEW-1) shifts the tag off the anchor by an exact number of SCREEN pixels, with
 * the span's TOP-LEFT at the offset instead of its centre on the anchor — that is what
 * gets the hover tag out from under the mouse pointer. Omitted (every permanent index
 * label) keeps the historic centred placement, byte for byte.
 *
 * `position:absolute;left:0;top:0` rides ONLY with an offset, and it matters: an in-flow
 * inline-block sits on the marker div's LINE BOX, so the inherited font's baseline strut
 * pushes it a few pixels below the anchor. That slop is invisible when a label is merely
 * centred "about" its point, but here the placement is exact arithmetic against the canvas
 * edge — a few pixels of drift is the difference between clearing the bottom furniture and
 * hiding behind it. Taking the span out of flow makes its top-left the anchor exactly. */
const labelIcon = (text, className = "", offset = null) => L.divIcon({
  className,
  iconSize: [0, 0],
  html: `<span style="display:inline-block;${offset ? "position:absolute;left:0;top:0;" : ""}` +
    `transform:translate(${offset ? `${offset.tx}px,${offset.ty}px` : "-50%,-50%"});` +
    `white-space:nowrap;pointer-events:none;` +
    `font:700 10px/1.2 Inter,system-ui,sans-serif;font-variant-numeric:tabular-nums slashed-zero;color:${CONTOUR_INDEX_COL};` +
    `text-shadow:0 0 2px #fff,0 0 2px #fff,0 0 3px #fff,0 0 4px #fff;">${text}</span>`,
});

/* NEW-1 — the box the hover tag has to stay inside, in MAP CONTAINER pixels.
 *
 * The planner's basemap container is deliberately OVERSCANNED (inset:-overscan inside a
 * clip box with overflow:hidden), so container coordinates run well past what the user can
 * see: a tag placed near the visible edge would be silently cut off by the clip, not by the
 * viewport. Measuring the clip parent against the container recovers the visible window at
 * whatever overscan is in force, and self-gates to the whole container on a surface that
 * has no overscan (the map finder, where the clip IS the container).
 *
 * `bottom` reserves the row of on-canvas furniture the planner floats over its own bottom
 * edge — the coordinate/elevation chip bottom-left, the scale bar and zoom cluster
 * bottom-right — so the tag flips up instead of hiding behind one of them. The right-hand
 * Tools rail needs no reserve: it is a flex SIBLING of the canvas, so it is outside this
 * box already and the clip would cut anything that reached it. */
const HOVER_BOTTOM_RESERVE_PX = 56;
function visibleBox(map, { bottom = HOVER_BOTTOM_RESERVE_PX } = {}) {
  const c = map && map.getContainer && map.getContainer();
  const size = map && map.getSize ? map.getSize() : null;
  let box = { x0: 0, y0: 0, x1: size ? size.x : 0, y1: size ? size.y : 0 };
  try {
    const clip = c && c.parentElement;
    if (clip && c.getBoundingClientRect && clip.getBoundingClientRect) {
      const cr = c.getBoundingClientRect(), pr = clip.getBoundingClientRect();
      if (pr.width > 0 && pr.height > 0) {
        box = { x0: pr.left - cr.left, y0: pr.top - cr.top, x1: pr.right - cr.left, y1: pr.bottom - cr.top };
      }
    }
  } catch (_) { /* fall back to the full container — never break a mousemove */ }
  return { ...box, y1: Math.max(box.y0, box.y1 - bottom) };
}

/* `parts` is [{ tile, data }] — one entry per lattice tile in the current cover.
 * Lines are merged by level across tiles and seam-joined (the tile clip cut each
 * contour at the shared lattice edge; this stitches the halves back into one polyline),
 * then labels are deduped and thinned by pickLabels. Both sublayers are built inside
 * this ONE call, into a group the caller just cleared — so a label can never outlive
 * the geometry it names (NEW-1). */
function renderContours(parts, group, { opacity, canvas, onComposed, labelPane = null }) {
  // composeContourPaint is the shared, PURE composition (contours.js) — the dedupe, the
  // seam-join, the label thinning and the ONE unit formatter all live there, so the
  // fixture-driven test exercises exactly what the map paints. This function only turns
  // its output into Leaflet objects.
  const { lines, labels } = composeContourPaint(parts);
  if (onComposed) onComposed({ lines, labels });
  for (const ln of lines) {
    // Line hierarchy by WEIGHT (index heavier), never by fading (salience rule).
    L.polyline(ln.coords, {
      renderer: canvas, color: ln.isIndex ? CONTOUR_INDEX_COL : CONTOUR_COL,
      weight: ln.isIndex ? 2.2 : 1.1, opacity, interactive: false,
    }).addTo(group);
  }
  for (const lab of labels) {
    L.marker(lab.ll, { icon: labelIcon(lab.text), interactive: false, keyboard: false, ...(labelPane ? { pane: labelPane } : null) }).addTo(group);
  }
  return lines.length;
}

function renderArrows(parts, group, { map, opacity, canvas }) {
  if (!map) return 0;
  const arrows = [];
  for (const { data } of parts) if (data && data.arrows) for (const a of data.arrows) arrows.push(a);
  let n = 0;
  for (const a of arrows) {
    // Steeper = longer + bolder (salience tracks importance). Normalized 0 at the
    // no-arrow threshold, saturating at a 2% grade (steep for Houston sheet flow).
    const t = Math.max(0, Math.min(1, (a.slope - 0.0008) / (0.02 - 0.0008)));
    const len = 14 + 14 * t, w = 1.2 + 1.6 * t, head = Math.max(5, len * 0.38);
    const p = map.latLngToLayerPoint(a.ll);
    const dx = Math.cos(a.dir), dy = Math.sin(a.dir);
    const tip = L.point(p.x + (dx * len) / 2, p.y + (dy * len) / 2);
    const tail = L.point(p.x - (dx * len) / 2, p.y - (dy * len) / 2);
    const back = a.dir + Math.PI;
    const h1 = L.point(tip.x + Math.cos(back - 0.45) * head, tip.y + Math.sin(back - 0.45) * head);
    const h2 = L.point(tip.x + Math.cos(back + 0.45) * head, tip.y + Math.sin(back + 0.45) * head);
    const pts = [tail, tip, h1, tip, h2].map((pt) => map.layerPointToLatLng(pt));
    L.polyline(pts, { renderer: canvas, color: ARROW_COL, weight: w, opacity, interactive: false, lineCap: "round" })
      .addTo(group);
    n++;
  }
  return n;
}

/* The honesty line for a view whose band had to step down (NEW-2 (3)). Says the ground
 * size of one grid cell, so nobody reads 1-ft lines traced from a coarse grid as if
 * they were surveyed — same register as the z16 gate's own message. */
function coarseNote(cover) {
  const lat = cover.tiles.length
    ? mercYToLat((cover.tiles[0].bbox.ymin + cover.tiles[0].bbox.ymax) / 2) : 30;
  const ft = cover.cellMeters * groundScale(lat) * M_TO_FT;
  return `Wide view — grid coarsened to about ${Math.round(ft)} ft per sample, so the 1-ft lines are smoothed. Zoom in for full detail.`;
}

// ---------------------------------------------------------------------------
/* The shared view-driven factory. `render` is one of the two above; both layers key
 * the SAME lattice tiles, so toggling both costs one fetch + one worker job per tile. */
/* NEW-1 — `pane` / `labelPane` put a terrain layer in a STACKING BAND (lib/mapStack.js).
 * Contours are declared a LINE role, so on the planner they render in the band ABOVE the
 * site elements: the whole point of the owner's report — place a building, still see the
 * ground it sits on. Absent → Leaflet's default overlay/marker panes (the map finder). */
function terrainLayer(cfg, onStatus, render, emptyMsg, { hover = false, pane = null, labelPane = null } = {}) {
  const group = L.layerGroup();
  let map = null, canvas = null, lastKey = null, opacity = cfg.opacity ?? 0.9;
  let busy = false, pendingMove = false, lastPainted = null;
  // NEW-1 — the hover readout's OWN sublayer. It is a child group so the transient label
  // is cleared (and re-parented) independently of the geometry, and so a repaint can
  // never leave one stranded over lines it no longer names.
  const hoverGroup = L.layerGroup();
  let composed = null, hoverIndex = null, hoverKey = null;
  // NEW-1: the SUPERSESSION token vectorOverlay.js already uses. `!map` alone only
  // catches an unmounted group — a superseded compute on a STILL-MOUNTED layer sailed
  // past it and painted its lines and labels over the newer view's.
  let paintSeq = 0;
  group.setOpacity = (o) => {
    opacity = o;
    group.eachLayer((l) => {
      if (l.setStyle) l.setStyle({ opacity: o });
      else if (l.getElement) { const el = l.getElement(); if (el) el.style.opacity = o; }
    });
  };
  // Geometry and labels are cleared and rebuilt in ONE synchronous pass, so no label can
  // outlive the lines it names (NEW-1 (2)).
  const paint = (parts, ts, opts = {}) => {
    group.clearLayers();
    const n = render(parts, group, {
      map, opacity, canvas, labelPane,
      onComposed: (c) => { composed = c; hoverIndex = null; },
    });
    // Re-parent the (now emptied) hover sublayer: the label named the geometry that was
    // just replaced, so it goes with it — the same "no label outlives its lines" rule the
    // permanent labels follow (B1087).
    if (hover) { hoverGroup.clearLayers(); hoverKey = null; group.addLayer(hoverGroup); }
    lastPainted = parts;
    const msg = opts.note || (n ? null : emptyMsg);
    onStatus && onStatus(n ? "loaded" : "empty", msg, { ts, stale: !!opts.stale });
  };
  const refresh = async () => {
    if (!map) return;
    if (busy) { pendingMove = true; return; } // moveend mid-job — serve the latest view after (B56d)
    const z = map.getZoom();
    if (z < TERRAIN_MIN_ZOOM) {
      paintSeq++; // a slow in-flight compute from above the gate must not paint below it
      group.clearLayers(); lastKey = "zoomed-out"; lastPainted = null;
      composed = null; hoverIndex = null; hoverKey = null;
      if (hover) group.addLayer(hoverGroup);
      onStatus && onStatus("empty", `Zoom in to ≥ ${TERRAIN_MIN_ZOOM} to load (1-ft detail needs close zoom)`);
      return;
    }
    const b = map.getBounds();
    const cover = latticeCover(
      { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() },
      z, { maxBand: LATTICE_MAX_BAND },
    );
    // The key is the ground the view covers, not the view — pan inside one tile and
    // nothing recomputes; pan back across a boundary and the tiles are cache hits.
    const key = cover.tiles.map((t) => t.key).join("|");
    if (key === lastKey && lastPainted) return;
    lastKey = key;
    const mySeq = ++paintSeq;
    const entries = cover.tiles.map((tile) => ({
      tile, ...gisCache.swr(`terrain:${tile.key}`, () => computeTile(tile), { ttl: TERRAIN_TTL }),
    }));
    const coarse = cover.coarsened ? coarseNote(cover) : null;
    const cachedParts = entries.filter((e) => e.cached).map((e) => ({ tile: e.tile, data: e.cached.data }));
    if (cachedParts.length) {
      const ts = Math.min(...entries.filter((e) => e.cached).map((e) => e.cached.ts));
      paint(cachedParts, ts, { stale: entries.some((e) => e.stale), note: coarse });
    } else onStatus && onStatus("loading");
    busy = true;
    const settled = await Promise.all(entries.map((e) =>
      e.fresh.then((r) => ({ tile: e.tile, r }), (error) => ({ tile: e.tile, r: { error } }))));
    // Bail before painting or reporting status when a newer refresh (or an onRemove)
    // has taken over, so a superseded compute never renders — the NEW-1 fix. `busy` is
    // deliberately NOT reset here: onRemove owns it once it has bumped the token, and a
    // newer refresh could not have started while this one held it. The fetch rides
    // gisCache.swr uncancelled (aborting would poison the shared cache — B36e).
    if (mySeq !== paintSeq) return;
    busy = false;
    if (!map) return;
    const parts = [], errs = [];
    let ts = null, anyUpdated = false, anyStale = false;
    for (const { tile, r } of settled) {
      if (r && r.data) {
        parts.push({ tile, data: r.data });
        if (typeof r.ts === "number") ts = ts == null ? r.ts : Math.min(ts, r.ts);
        if (r.error) anyStale = true;          // served from cache because the refresh failed
      } else if (r && r.error) errs.push(r.error);
      if (r && r.updated) anyUpdated = true;
    }
    if (!parts.length) {
      lastKey = null; lastPainted = null;
      onStatus && onStatus("failed", `${cfg.label}: ${(errs[0] && errs[0].message) || "terrain fetch failed"}`);
    } else if (anyUpdated || parts.length !== cachedParts.length) {
      // A tile that came back empty-handed leaves a hole — clear lastKey so the next
      // map move retries it instead of trusting a partial picture forever (LOUD-FAILURE).
      if (errs.length) lastKey = null;
      const notes = [];
      if (errs.length) notes.push(`${errs.length} of ${settled.length} terrain tiles unavailable — showing what loaded`);
      if (coarse) notes.push(coarse);
      paint(parts, ts, { stale: anyStale || errs.length > 0, note: notes.join(" · ") || null });
    }
    if (pendingMove) { pendingMove = false; refresh(); } // trailing edge (B56d)
  };
  /* NEW-1 — answer "what elevation is the line under my cursor?" without making a single
   * polyline interactive. The cursor position arrives from the coordinate readout's
   * ALREADY-throttled mousemove (no second listener anywhere); `forMap` identifies which
   * surface sent it, so the other surface's layer clears instead of painting a label for
   * a cursor that isn't over it. Exactly one label, in its own sublayer, cleared on every
   * move — a ghost or a stacked pair is structurally impossible. */
  group.hoverAt = (ll, forMap) => {
    if (!hover) return null;
    const want = ll && map && (!forMap || forMap === map) && composed && composed.lines.length &&
      map.getZoom() >= TERRAIN_MIN_ZOOM ? ll : null;
    if (!want) {
      if (hoverKey !== null) { hoverGroup.clearLayers(); hoverKey = null; }
      return null;
    }
    const here = L.latLng(want.lat, want.lng);
    const p = map.latLngToContainerPoint(here);
    // The tolerance is a constant number of SCREEN pixels — convert it through the live
    // map scale so it means the same thing at every zoom.
    const tolDeg = Math.abs(map.containerPointToLatLng(L.point(p.x, p.y + HOVER_TOL_PX)).lat - here.lat);
    if (!hoverIndex) hoverIndex = buildContourIndex(composed.lines);
    const hit = hitContour(hoverIndex, here.lat, here.lng, tolDeg);
    // NO DOUBLE-STAMP: if this contour already carries a permanent index label close by,
    // the question is answered — a second label would just crowd the first.
    const answered = hit && (composed.labels || []).some((lab) =>
      lab.level === hit.level &&
      map.latLngToContainerPoint(L.latLng(lab.ll[0], lab.ll[1])).distanceTo(p) <= DOUBLE_STAMP_PX);
    // NEW-1 — the tag is anchored at the CURSOR and offset from it, so the key carries the
    // cursor's whole-pixel position too: the level alone would let the tag sit still while
    // the pointer moved along one contour (the offset is measured from the pointer, not
    // from the line). Rounding to whole pixels keeps it to at most one rebuild per pixel.
    const key = hit && !answered
      ? `${hit.level}|${Math.round(p.x)},${Math.round(p.y)}`
      : null;
    if (key === hoverKey) return hit && !answered ? hit : null;
    hoverGroup.clearLayers();
    hoverKey = key;
    if (!key) return null;
    // Same white-halo divIcon, same size and colour as the permanent index labels — the
    // hovered line reads exactly like a labelled one, which is the whole ask. What changed
    // in NEW-1 is only WHERE it sits: beside the pointer instead of under it, flipped near
    // an edge so the canvas clip (or the bottom furniture) can never eat it.
    const text = contourLabelText(hit.level);
    const place = hoverLabelPlacement(p, visibleBox(map), hoverLabelSize(text));
    L.marker(here, {
      // the class exists so a harness can tell the ONE transient label from the permanent
      // index labels — a ghost or a stacked pair is otherwise invisible to a DOM check
      icon: labelIcon(text, CONTOUR_HOVER_CLASS, place),
      interactive: false, keyboard: false,
    }).addTo(hoverGroup);
    return hit;
  };
  group.onAdd = function (m) {
    L.LayerGroup.prototype.onAdd.call(this, m);
    map = m;
    canvas = L.canvas(pane ? { pane } : {});
    if (hover) { group.addLayer(hoverGroup); hoverGroups.add(group); }
    m.on("moveend", refresh);
    refresh();
    return this;
  };
  group.onRemove = function (m) {
    paintSeq++; // invalidate every in-flight compute — nothing may paint into a removed group
    m.off("moveend", refresh);
    hoverGroups.delete(group);
    hoverGroup.clearLayers(); hoverKey = null; composed = null; hoverIndex = null;
    map = null; lastKey = null; lastPainted = null; pendingMove = false; busy = false;
    L.LayerGroup.prototype.onRemove.call(this, m);
  };
  return group;
}

// Every mounted contour layer, so the coordinate readout can hand its (already
// throttled) cursor position to whichever one belongs to the map it came from.
const hoverGroups = new Set();

/* NEW-1 — the ONE entry point a map surface calls from its existing cursor-move path.
 * `map` is that surface's Leaflet map; `ll` is {lat,lng} or null on mouse-out. Layers on
 * other maps clear, so two mounted surfaces can never both show a hover label. Returns
 * the hit ({level, ll, …}) when one was painted. */
export function setContourHover(map, ll) {
  let hit = null;
  for (const g of hoverGroups) {
    try { const h = g.hoverAt(ll, map); if (h) hit = h; } catch (_) { /* never break a mousemove */ }
  }
  return hit;
}

export const contourLayer = (cfg, onStatus, opts = {}) =>
  terrainLayer(cfg, onStatus, renderContours, "No contour lines in view", { hover: true, ...opts });
export const flowLayer = (cfg, onStatus, opts = {}) =>
  terrainLayer(cfg, onStatus, renderArrows, "Ground too flat to call — no confident direction", opts);
