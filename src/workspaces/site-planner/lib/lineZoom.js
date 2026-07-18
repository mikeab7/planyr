/* B880 — dash-period + inset-visibility zoom helpers: the B617 siblings for DASHED feet-frame
 * lines (the parcel setback ring, easement/deed/utility spines, neutral markups, overlay-
 * calibration connectors). B617's `strokeZoom` holds a line's WEIGHT constant relative to the
 * drawing across zoom; a fixed-px dash pattern has the SAME defect — on zoom-out the geometry
 * shrinks but the dash period doesn't, so edges shorter than one dash cycle stop rendering
 * (ragged/broken dashes) and a tight inset ring collapses onto its parent boundary (the garbled
 * double-line the owner reported on the setback line at Mueschke Rd). Pure — no DOM; unit-tested
 * in `test/lineZoom.test.js`. Mirrors the B719 curb "floor so it never goes sub-pixel" pattern. */

// A dashed period never shrinks below this many ON-SCREEN px (so a dash still renders on a short
// edge); growth is capped at DASH_ZOOM_CEIL× so the pattern doesn't balloon on deep zoom-in
// (mirrors `strokeZoom`'s 3.5× ceiling).
export const DASH_ZOOM_FLOOR_PX = 3;
export const DASH_ZOOM_CEIL = 3.5;

/* Scale an SVG dash spec ("7 6", "4 3", "6 4.8", …) by the B617 zoom factor `zk = view.ppf / 0.35`,
 * flooring the PERIOD (sum of the segments) so it never goes sub-pixel and capping the growth. A
 * null / undefined / empty / unparseable spec (i.e. a solid line) passes through unchanged. Pure. */
export function dashZoom(spec, zk) {
  if (spec == null || spec === "") return spec;
  const nums = String(spec).trim().split(/\s+/).map(Number);
  if (!nums.length || nums.some((n) => !isFinite(n) || n < 0)) return spec;
  const period = nums.reduce((a, b) => a + b, 0);
  if (!(period > 0) || !isFinite(zk)) return spec;
  // scale = zk, floored so period*scale >= DASH_ZOOM_FLOOR_PX, capped at DASH_ZOOM_CEIL
  const s = Math.max(DASH_ZOOM_FLOOR_PX / period, Math.min(zk, DASH_ZOOM_CEIL));
  return nums.map((n) => Math.round(n * s * 100) / 100).join(" ");
}

// A dashed INSET ring (offset INWARD from a boundary — the setback line) is worth drawing only
// when it sits far enough OFF its parent line to read as a SECOND line. Below this many on-screen
// px the two merge into a garbled double-line, so the caller SUPPRESSES the inset ring (it re-
// appears on zoom-in). The reported garble was at ~2.1 px of inset, so the floor sits just above.
export const INSET_MIN_VISIBLE_PX = 3;

/* True when a ring inset `minInsetFt` feet from its boundary reads as >= `minPx` on-screen, given
 * `ppf` (px per foot). Non-positive / non-finite inputs read as NOT visible (nothing to draw). Pure. */
export function insetRingVisible(minInsetFt, ppf, minPx = INSET_MIN_VISIBLE_PX) {
  if (!(minInsetFt > 0) || !(ppf > 0)) return false;
  return minInsetFt * ppf >= minPx;
}
