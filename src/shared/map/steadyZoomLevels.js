/* B2426464 ×2 — a tiled layer's NEW zoom level is built out of sight during a zoom animation and shown only when the zoom lands.
 *
 * WHAT WENT WRONG (measured on the composited frames, ui-audit/measure-parcel-zoom-slide.mjs). Leaflet animates a zoom by giving every
 * tile level a CSS transform transition, and builds the TARGET zoom's level at `zoomanim` so it can transition in alongside the old one.
 * Chromium does not start a compositor transition until its element has been rasterised. A level whose tiles arrive with pixels already
 * in them — our parcel canvases (painted synchronously), or imagery tiles straight out of the browser's cache (zooming back over ground
 * just seen) — therefore starts its zoom frames late, rides behind everything else while it fades in, and snaps into place when the
 * zoom ends: up to 27 px off mid-zoom on a double-click, 15–37 px on a trackpad scroll. The levels that were ALREADY on screen are
 * rasterised, so their transitions all start on the same frame and stay locked to each other.
 *
 * THE RULE. During a zoom animation only the levels already on screen are shown (scaled, exactly as Leaflet always shows the old level);
 * a level built for the target zoom is `visibility: hidden` until the animation's closing `zoom`/`moveend`, when Leaflet has already set
 * its final, non-animated transform. Its tiles still load (or paint) while hidden, so it is ready the moment it is revealed. Pair with
 * the map option `fadeAnimation: false`: a level revealed while its tiles are still fading in is not drawn either, and the NEXT zoom
 * (the next wheel notch) would wait on it the same way.
 *
 * Apply BEFORE the layer is added to a map: Leaflet binds a GridLayer's event handlers (`getEvents`) when the layer is added. */

/** How long a just-shown level counts as "not drawn yet" (a zoom starting inside it hides that level; pruning waits at least this
 *  long AND this many frames after a reveal). */
export const HOLD_FRAMES = 3;
export const HOLD_MS = 120;
/** The longest a layer's own "my data for the new view is still coming" may hold old tiles (a server that never answers cannot pin them). */
export const DATA_HOLD_CAP_MS = 4000;

/** Patch one Leaflet GridLayer (instance). Idempotent. Returns the layer.
 *  `layer._dataPending` (optional, read at call time): a layer whose tiles are created EMPTY and filled when its data answers (the parcel tiles —
 *  a tile is "loaded" the moment it is created, blank or not) says so here, and on a lockstep map old tiles are kept until it reports false or
 *  DATA_HOLD_CAP_MS passes. Without it Leaflet cleared the old level the moment the new one's empty tiles existed: no outline at all until the
 *  county answered (a frame on a fast mock, the whole answer's wait on a real county — B2426464 ×3). */
export function holdNewZoomLevels(layer) {
  if (!layer || layer.__holdNewZoomLevels) return layer;
  layer.__holdNewZoomLevels = true;
  const hidden = new Set();
  /* A level that has only just become visible has not been drawn yet — the screen draws it some frames later. Two consequences:
   * (1) Leaflet would drop the old level in the SAME task as a reveal (its new tiles are already loaded), leaving nothing on screen
   *     until the revealed one is drawn (measured: a quarter-second with no lines) — so pruning is held until the revealed level has had
   *     HOLD_FRAMES frames and HOLD_MS to draw;
   * (2) a zoom that STARTS while a level is that young — the next wheel notch, the next step of a trackpad scroll, the first zoom after
   *     a stage's tile layer was added — waits on it exactly like a new level (measured: 30–40 px of slide) — so a young level is hidden
   *     for that zoom too, whenever an older, drawn level of this layer is there to carry the picture. */
  const shownAt = new Map(); // level el -> when it became visible
  let holding = 0, prunePending = false;
  const raf = (fn) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(fn) : setTimeout(fn, 16));
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const basePrune = layer._pruneTiles;
  /* …and none may be dropped WHILE a level is hidden either: with `fadeAnimation: false` Leaflet prunes the moment each new tile is
   * ready (its non-fade `_tileReady` ignores the zoom-in-progress `_noPrune` flag), which emptied the screen mid-zoom. */
  /* On a LOCKSTEP map (lockstepZoom.js) nothing is hidden — a new level is animated from its correct start and shown from the first frame —
   * so the one rule left is the hold: old tiles are cleared only HOLD_FRAMES frames and HOLD_MS after the LAST request to clear them, so a
   * just-arrived tile has been drawn before the one under it goes. */
  const lockstep = () => !!(layer._map && layer._map.__lockstepZoom);
  let quietToken = 0;
  let dataWaitFrom = null; // when the current "data still coming" wait began (survives restarts, so the cap is a real ceiling)
  const dataPending = () => { try { return typeof layer._dataPending === "function" && !!layer._dataPending(); } catch (_) { return false; } };
  const pruneWhenQuiet = () => {
    prunePending = true;
    const token = ++quietToken, t0 = now();
    let frames = 0;
    const tick = () => {
      if (token !== quietToken) return; // a later request restarted the wait
      if (dataPending()) {
        if (dataWaitFrom == null) dataWaitFrom = now();
        if (now() - dataWaitFrom < DATA_HOLD_CAP_MS) { frames = 0; raf(tick); return; } // keep the old tiles; the frame count restarts once the data is in
      }
      if (++frames < HOLD_FRAMES || now() - t0 < HOLD_MS) { raf(tick); return; }
      dataWaitFrom = null;
      prunePending = false;
      if (layer._map) basePrune.call(layer);
    };
    raf(tick);
  };
  layer._pruneTiles = function () {
    if (lockstep()) { pruneWhenQuiet(); return; }
    if (holding || hidden.size) { prunePending = true; return; }
    basePrune.call(this);
  };
  const baseCreate = layer._onCreateLevel;
  layer._onCreateLevel = function (level) {
    if (level && level.el) shownAt.set(level.el, now());
    if (baseCreate) baseCreate.call(this, level);
  };
  const hide = (el) => { el.style.visibility = "hidden"; hidden.add(el); };
  /* Called BEFORE the base handler runs, so the prune that `_setView` performs inside it is already held. */
  const beginReveal = () => {
    if (!hidden.size) return null;
    const token = ++holding, t0 = now();
    let frames = 0;
    const tick = () => {
      if (holding !== token) return; // a later reveal took over the hold
      if (++frames < HOLD_FRAMES || now() - t0 < HOLD_MS) { raf(tick); return; }
      holding = 0;
      if (prunePending && layer._map) { prunePending = false; layer._pruneTiles(); }
    };
    raf(tick);
    return () => { const t = now(); hidden.forEach((el) => { el.style.visibility = ""; shownAt.set(el, t); }); hidden.clear(); };
  };
  const baseAnimate = layer._animateZoom, baseReset = layer._resetView, baseMoveEnd = layer._onMoveEnd;
  layer._animateZoom = function (e) {
    if (lockstep()) return baseAnimate.call(this, e); // the lockstep animation places and shows the new level itself
    const t = now(), levels = this._levels || {};
    const young = [], drawn = [];
    for (const z of Object.keys(levels)) {
      const el = levels[z] && levels[z].el;
      if (!el || hidden.has(el) || !el.children.length) continue;
      (t - (shownAt.get(el) ?? -Infinity) < HOLD_MS ? young : drawn).push(el);
    }
    if (drawn.length) young.forEach(hide);
    const had = new Set(Object.keys(levels));
    baseAnimate.call(this, e);
    for (const z of Object.keys(this._levels || {})) {
      const lv = this._levels[z];
      if (!had.has(z) && lv && lv.el) hide(lv.el);
    }
  };
  layer._resetView = function (e) {
    const done = this._map && !this._map._animatingZoom ? beginReveal() : null;
    baseReset.call(this, e);
    if (done) done();
  };
  layer._onMoveEnd = function () {
    const done = this._map && !this._map._animatingZoom ? beginReveal() : null;
    baseMoveEnd.call(this);
    if (done) done();
  };
  layer.on("remove", () => { hidden.forEach((el) => { el.style.visibility = ""; }); hidden.clear(); shownAt.clear(); holding = 0; quietToken++; prunePending = false; });
  return layer;
}
