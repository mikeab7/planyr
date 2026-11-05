/* B2426464 ×3 — a zoom animation moves every layer of the map TOGETHER, frame by frame, instead of leaving each layer's CSS transition
 * to start whenever the browser gets round to it.
 *
 * WHAT WENT WRONG (measured on composited frames, ui-audit/measure-parcel-zoom-slide.mjs, a fast trackpad zoom-out at a high pixel ratio).
 * Leaflet animates a zoom by giving every `.leaflet-zoom-animated` element (each tile level, the vector renderer, the markers) its final
 * transform and letting a 0.25 s CSS transition carry it there. Chromium starts each of those transitions on the compositor only once that
 * element has been rasterised, so a layer the screen has not finished drawing — a tile level revealed a moment before the next zoom began,
 * which on a busy high-density screen can be well over a tenth of a second — starts its zoom late and is drawn at its OLD size while the rest
 * of the map has moved on: one frame showed two imagery levels at once at different scales, the outlines locked to one and ~40 px off the
 * other. holdNewZoomLevels (steadyZoomLevels.js) hides a level that is "only just shown", but "just" was a guess about the compositor's raster
 * time that the main thread cannot see; this removes the guess.
 *
 * THE RULE. While the map pane carries `leaflet-zoom-anim` the CSS transition is switched off for this map, and one rAF loop writes every
 * animated element's transform each frame, interpolated from where it was to where Leaflet put it with the SAME curve the stylesheet used
 * (cubic-bezier(0, 0, 0.25, 1) over 0.25 s, translate and scale each linear in the eased time — what a CSS transition between two
 * `translate3d() scale()` lists does). Every layer's transform for a frame lands in the same commit, so none can start late: a layer that is
 * not rasterised yet appears late, it never slides. The picture of a healthy zoom is unchanged. A tile level BUILT for the zoom starts where it
 * would be at the zoom being left, so it can be shown (and drawn) from the first frame instead of being hidden until the landing — hiding
 * it meant the browser drew a whole level in one go at the reveal, and the old levels were sometimes cleared before it had (a frame with
 * no outline at all). steadyZoomLevels.js stops hiding levels on a lockstep map and only holds the clearing of old ones.
 *
 * Install once per map, after it is created. Returns a detach function. */

const DURATION_MS = 250; // Leaflet's own: the stylesheet's 0.25 s and Map._animateZoom's 250 ms end timer
const STYLE_ID = "planyr-lockstep-zoom-style";
const CLASS = "planyr-lockstep-zoom";

/** CSS cubic-bezier timing function (x1,y1,x2,y2) → ease(p), p in [0,1]. Pure. */
export function cubicBezier(x1, y1, x2, y2) {
  const bx = (t) => 3 * x1 * t * (1 - t) * (1 - t) + 3 * x2 * t * t * (1 - t) + t * t * t;
  const by = (t) => 3 * y1 * t * (1 - t) * (1 - t) + 3 * y2 * t * t * (1 - t) + t * t * t;
  return (p) => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    let lo = 0, hi = 1, t = p;
    for (let i = 0; i < 40; i++) { t = (lo + hi) / 2; if (bx(t) < p) lo = t; else hi = t; }
    return by(t);
  };
}
export const LEAFLET_ZOOM_EASE = cubicBezier(0, 0, 0.25, 1);

/** Parse Leaflet's `translate3d(xpx, ypx, 0) scale(s)` (either part optional). Pure. */
export function parseTransform(str) {
  const s = String(str || "");
  const t = /translate(?:3d)?\(\s*(-?[\d.eE+-]+)px\s*,\s*(-?[\d.eE+-]+)px/.exec(s);
  const k = /scale\(\s*(-?[\d.eE+-]+)\s*\)/.exec(s);
  return { x: t ? Number(t[1]) : 0, y: t ? Number(t[2]) : 0, s: k ? Number(k[1]) : 1 };
}

/** The transform a frame at eased time `e` shows between `a` and `b` (both parsed). Pure. */
export function tween(a, b, e) {
  return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, s: a.s + (b.s - a.s) * e };
}

export function formatTransform({ x, y, s }) {
  return `translate3d(${x}px,${y}px,0) scale(${s})`;
}

function ensureStyle(doc) {
  if (!doc || doc.getElementById(STYLE_ID)) return;
  const el = doc.createElement("style");
  el.id = STYLE_ID;
  el.textContent = `.${CLASS} .leaflet-zoom-anim .leaflet-zoom-animated { transition: none !important; }`;
  doc.head.appendChild(el);
}

export function lockstepZoomAnimation(map) {
  if (!map || map.__lockstepZoom) return () => {};
  map.__lockstepZoom = true;
  const container = map.getContainer();
  const doc = container.ownerDocument;
  ensureStyle(doc);
  container.classList.add(CLASS);
  const raf = (fn) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(fn) : setTimeout(fn, 16));
  const caf = (id) => (typeof cancelAnimationFrame === "function" ? cancelAnimationFrame(id) : clearTimeout(id));
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

  let run = null; // { items: [{ el, a, b, last }], t0, frame }
  const animated = () => (map._mapPane ? Array.from(map._mapPane.querySelectorAll(".leaflet-zoom-animated")) : []);
  /* write one frame; an element whose transform someone else changed since our last write is theirs again */
  const paint = (e) => {
    for (const it of run.items) {
      if (it.el.style.transform !== it.last) { it.gone = true; continue; }
      if (it.gone) continue;
      it.el.style.transform = formatTransform(tween(it.a, it.b, e));
      it.last = it.el.style.transform; // read back: the browser normalises the string
    }
  };
  const finish = () => {
    if (!run) return;
    caf(run.frame);
    for (const it of run.items) if (!it.gone && it.el.style.transform === it.last) it.el.style.transform = it.target;
    run = null;
  };
  const tick = () => {
    if (!run) return;
    const p = Math.min(1, (now() - run.t0) / DURATION_MS);
    paint(LEAFLET_ZOOM_EASE(p));
    if (p < 1) run.frame = raf(tick);
  };

  const baseAnimate = map._animateZoom, baseEnd = map._onZoomTransitionEnd;
  map._animateZoom = function (center, zoom, startAnim, noUpdate) {
    if (!startAnim) return baseAnimate.call(this, center, zoom, startAnim, noUpdate);
    finish();
    const before = new Map();
    for (const el of animated()) before.set(el, el.style.transform);
    const startCenter = this.getCenter(), startZoom = this.getZoom();
    const out = baseAnimate.call(this, center, zoom, startAnim, noUpdate); // layers set their TARGET transforms inside 'zoomanim'
    const items = [];
    const add = (el, from, target) => {
      const it = { el, a: parseTransform(from), b: parseTransform(target), target, last: from };
      el.style.transform = from; // the frame before the animation: where it is (or, for a new level, would be) now
      it.last = el.style.transform;
      items.push(it);
    };
    for (const [el, from] of before) {
      const target = el.style.transform;
      if (!el.isConnected || target === from) continue;
      add(el, from, target);
    }
    /* A tile LEVEL built for this zoom (inside 'zoomanim') has no "before": Leaflet puts it straight at its END transform, so on its own it
     * would sit at the landing position for the whole animation. Its start is where it would be at the zoom we are leaving — the same
     * `_setZoomTransform` Leaflet uses, at the start centre/zoom — and because every level's screen position is affine in (translate, scale),
     * levels interpolated the same way stay aligned on every frame. So a new level is shown, correctly placed, from the first frame. */
    for (const id in this._layers) {
      const layer = this._layers[id];
      if (!layer || !layer._levels || typeof layer._setZoomTransform !== "function") continue;
      for (const z in layer._levels) {
        const lv = layer._levels[z];
        if (!lv || !lv.el || before.has(lv.el) || !lv.el.isConnected) continue;
        const target = lv.el.style.transform;
        layer._setZoomTransform(lv, startCenter, startZoom);
        const from = lv.el.style.transform;
        lv.el.style.transform = target;
        if (from !== target) add(lv.el, from, target);
      }
    }
    if (items.length) { run = { items, t0: now(), frame: 0 }; run.frame = raf(tick); }
    return out;
  };
  map._onZoomTransitionEnd = function () {
    finish(); // every element at its target before Leaflet resets the view
    return baseEnd.apply(this, arguments);
  };

  return () => {
    finish();
    map._animateZoom = baseAnimate;
    map._onZoomTransitionEnd = baseEnd;
    container.classList.remove(CLASS);
    delete map.__lockstepZoom;
  };
}
