/* viewAnchor — the ANCHORED RENDER, generalised from a pan to a zoom (B1449 / B1360 increment 2).
 *
 * WHY THIS EXISTS. `f2p` used to be `worldToScreen(view, …)`, so every element's pixel geometry
 * was a function of the live view: a gesture changed the rendered output of EVERY element and no
 * memo could bail (B1360's measured fact). B1440 fixed that for a PAN by pinning the emitted
 * geometry at an ANCHOR view and writing ONE group `translate` per frame. This module is the same
 * idea with the scale term restored, so a WHEEL ZOOM gets the same treatment.
 *
 * THE MODEL. Emit every coordinate at the ANCHOR view `a = {ppf, offX, offY}`, then put one
 * transform on the group that holds them:
 *
 *     k  = view.ppf / a.ppf
 *     tx = view.offX - k * a.offX
 *     ty = view.offY - k * a.offY
 *     transform = "translate(tx ty) scale(k)"
 *
 * ⛔ THE INVARIANT, and it is EXACT rather than approximate — `anchoredEqualsDirect` below is the
 * property `test/viewAnchor.test.js` proves for arbitrary views and points:
 *
 *     k * (p * a.ppf + a.offX) + tx  ===  p * view.ppf + view.offX
 *
 * i.e. the anchored render lands EXACTLY where a direct render at the live view would have. So
 * WHERE things are is provably right; what changes mid-gesture is only their APPEARANCE — stroke
 * weights and text scale with the drawing, and level-of-detail gates stay at the anchor's tier
 * until the gesture settles. That is the trade the owner was told about and accepted
 * ("i think smooth zoom makes sense, unless theres something im not considering", 2026-08-06).
 *
 * ⛔ IT REDUCES TO B1440'S PURE TRANSLATE AT k === 1, BY CONSTRUCTION. A pan holds `ppf`, so
 * k === 1, `scale(1)` is dropped by `anchorTransformAttr`, and the emitted attribute is the
 * byte-identical `translate(dx dy)` the pan path already shipped. The owner calls the pan "great"
 * — this must not regress it, and it cannot.
 *
 * ⛔ THE DRIFT CAP IS NOT DECORATION. The mid-gesture picture is the settled picture at the
 * anchor's zoom, uniformly scaled by k — so the further k travels from 1 the more the line work
 * and type are the wrong physical size. `anchorHolds` bounds that; past the cap the caller re-bakes
 * (re-anchors at the live view, paying one full render) rather than showing an increasingly wrong
 * drawing. Leaflet's own basemap path in `SitePlanner.jsx` re-bases on the same principle at ~0.75
 * zoom levels (≈1.68×), which is where this cap's magnitude comes from.
 *
 * Pure: no React, no DOM, no module state. Two canvases can hold two anchors.
 */

/* How far the live view may drift from the anchor before the caller must re-bake. 2 = one
 * doubling / halving of the on-screen scale, about six wheel notches at the default 1.12 step —
 * long enough that an ordinary zoom gesture never re-bakes mid-flight, short enough that type and
 * line weight are never more than 2× off their settled size. */
export const ANCHOR_MAX_K = 2;

/* Below this the scale term is treated as absent, so a pure pan emits exactly what B1440 emitted.
 * Sized well under a sub-pixel difference at any zoom this app allows (ppf ≤ 8, canvases ≲ 4k px:
 * a 1e-9 relative scale error moves a coordinate by ~4e-6 px). */
export const ANCHOR_K_EPS = 1e-9;

/* How long after the LAST wheel/pinch event the frame re-bakes at the settled view (dropping the
 * anchor, so level-of-detail, stroke weights and type all snap to the new zoom).
 *
 * Chosen against the two gestures that actually happen, not as a round number: a trackpad sweep
 * emits events every 10–16 ms and must never settle mid-flight, while a slow deliberate
 * notch-pause-notch on a mouse wheel can leave ~200 ms between detents and SHOULD still be treated
 * as one gesture — settling between those notches is the pre-B1449 behaviour (a full re-render per
 * detent) that the owner reports as "a delay". Long enough to bridge that; short enough that
 * letting go still feels instantaneous. Leaflet's own tile re-base below it sits at 160 ms. */
export const ZOOM_SETTLE_MS = 220;

const num = (n, d = 0) => (Number.isFinite(+n) ? +n : d);

/** Is `anchor` usable as a render anchor for `view`? False for a missing/degenerate anchor and for
 *  one the live view has drifted too far from (see ANCHOR_MAX_K). */
export function anchorHolds(view, anchor, maxK = ANCHOR_MAX_K) {
  if (!view || !anchor) return false;
  const ap = +anchor.ppf, vp = +view.ppf;
  if (!(ap > 0) || !(vp > 0)) return false;
  if (!Number.isFinite(+anchor.offX) || !Number.isFinite(+anchor.offY)) return false;
  const k = vp / ap;
  const cap = maxK > 1 ? maxK : ANCHOR_MAX_K;
  return k <= cap && k >= 1 / cap;
}

/** The group transform that carries geometry emitted at `anchor` to where the live `view` wants it.
 *  Returns `{ k, tx, ty }`; `null` when there is no anchor to compose against. */
export function anchorTransform(view, anchor) {
  if (!view || !anchor) return null;
  const ap = +anchor.ppf;
  if (!(ap > 0)) return null;
  const k = num(view.ppf, ap) / ap;
  if (!Number.isFinite(k) || k <= 0) return null;
  return {
    k,
    tx: num(view.offX) - k * num(anchor.offX),
    ty: num(view.offY) - k * num(anchor.offY),
  };
}

/* Round a transform component to a fixed number of decimals so an idle frame emits a
 * byte-identical attribute string (React skips the DOM write) instead of churning on float noise.
 * 4 decimals is ~1/10000 px — orders of magnitude below the quarter-pixel the pointer-accuracy
 * harness pins placement to (B1141). */
const q = (n) => {
  const r = Math.round(n * 1e4) / 1e4;
  return Object.is(r, -0) ? 0 : r;
};

/** The SVG `transform` attribute for an anchored group, or `undefined` when the anchor and the live
 *  view coincide (no attribute at all — the resting and export case).
 *
 *  ⛔ At k === 1 this emits `translate(dx dy)` and NOTHING ELSE, which is byte-for-byte what the
 *  B1440 pan path emitted. Do not "simplify" by always writing the scale term. */
export function anchorTransformAttr(t) {
  if (!t) return undefined;
  const flat = Math.abs(t.k - 1) < ANCHOR_K_EPS;
  const tx = q(t.tx), ty = q(t.ty);
  if (flat) return tx || ty ? `translate(${tx} ${ty})` : undefined;
  return `translate(${tx} ${ty}) scale(${q(t.k)})`;
}

/** The exactness property, exposed so the test suite proves it on the shipped code rather than on a
 *  restatement of it: where does world coordinate `p` (one axis) land under the anchored render,
 *  and where would a direct render at the live view have put it? */
export function anchoredEqualsDirect(view, anchor, p, axis = "x") {
  const t = anchorTransform(view, anchor);
  const off = axis === "y" ? "offY" : "offX";
  const shift = axis === "y" ? "ty" : "tx";
  const emitted = p * num(anchor.ppf) + num(anchor[off]);
  return {
    anchored: t ? t.k * emitted + t[shift] : null,
    direct: p * num(view.ppf) + num(view[off]),
  };
}

/* ---- wheel → zoom factor ------------------------------------------------------------------
 *
 * ⛔ THE OLD RULE IGNORED HOW HARD YOU SCROLLED: `deltaY < 0 ? 1.12 : 1/1.12`. A mouse notch and a
 * one-pixel trackpad nudge produced the SAME 12% jump, so a trackpad — which emits many small
 * deltas per gesture — zoomed in violent 12% staircases. That is the "doesn't feel smooth" half of
 * the owner's report, and it is a separate defect from the render cost.
 *
 * The factor is now proportional to the delta, expressed in NOTCHES. One notch is 100 px in pixel
 * mode (what Chrome sends for one detent), 3 lines in line mode (what Firefox sends for one), and a
 * page mode event is treated as three notches' worth before the clamp.
 *
 * ⛔ A REAL MOUSE NOTCH IS PRESERVED EXACTLY, not approximately: `wheelZoomFactor` short-circuits at
 * |n| === 1 so it returns the literal 1.12 and 1/1.12 the old path returned, byte for byte. That is
 * asserted in `test/viewAnchor.test.js` with `Object.is`, because "the mouse wheel is unchanged" is
 * a claim, not a hope.
 */
export const ZOOM_PER_NOTCH = 1.12;
export const WHEEL_NOTCH_PX = 100;          // deltaMode 0 (pixels) — one detent in Chrome
export const WHEEL_NOTCH_LINES = 3;         // deltaMode 1 (lines)  — one detent in Firefox
export const WHEEL_NOTCH_PAGES = 1 / 3;     // deltaMode 2 (pages)  — a page is ~3 notches
/* One event may never zoom more than this many notches. Guards a runaway trackpad-inertia burst and
 * a page-mode event, both of which can otherwise teleport the view in a single frame. */
export const WHEEL_MAX_NOTCHES = 3;

/** Notches of zoom-IN this wheel event asks for (negative = out). Exported for the tests and for
 *  anyone who needs the raw magnitude rather than the factor. */
export function wheelNotches({ deltaY = 0, deltaMode = 0 } = {}) {
  const d = num(deltaY);
  const per = deltaMode === 1 ? WHEEL_NOTCH_LINES : deltaMode === 2 ? WHEEL_NOTCH_PAGES : WHEEL_NOTCH_PX;
  const n = -d / (per || WHEEL_NOTCH_PX);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-WHEEL_MAX_NOTCHES, Math.min(WHEEL_MAX_NOTCHES, n));
}

/** The multiplicative zoom factor for one wheel event. 1 means "no zoom" (a zero delta). */
export function wheelZoomFactor(e) {
  const n = wheelNotches(e);
  if (n === 0) return 1;
  if (n === 1) return ZOOM_PER_NOTCH;        // exact, byte-for-byte the pre-B1449 mouse notch
  if (n === -1) return 1 / ZOOM_PER_NOTCH;   // ditto
  return Math.pow(ZOOM_PER_NOTCH, n);
}
