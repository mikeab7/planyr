/* Per-measurement STYLE + label-reveal threshold (NEW-1 / NEW-2).
 *
 * WHAT WAS WRONG. A measurement was the only drawn object in the planner with no style of its
 * own: its colour was hardcoded to the app accent at the single place it was painted, and no
 * measure object carried a stroke / weight / dash / fill field anywhere in the model. So
 * double-clicking an area measurement opened a Properties panel with nothing to style, while
 * every markup shape beside it had the full set. This module is the one place a measurement's
 * appearance is decided, so the canvas, the properties panel and the Standards defaults can
 * never drift from each other.
 *
 * THE ONE DELIBERATE EXCEPTION, preserved. When the drawing is UNCALIBRATED the measurement is
 * forced amber regardless of the user's colour. That is a CORRECTNESS signal ("this number is in
 * raw units, not real feet"), not decoration, so a user colour must not be able to hide it.
 * `measureStyle` is where that override lives, and `warn` is returned so the label layer can
 * carry the ⚠ mark with it.
 *
 * Pure (no React / DOM / theme reads) so it unit-tests without a browser. Tests:
 * test/measureStyle.test.js.
 */

import { MEASURE_INK } from "../../../shared/theme/familyInk.js";

// The amber the uncalibrated state has always used (matches the Doc Review calibration warning).
export const MEASURE_WARN_COLOR = "#b45309";

/* ⛔ B548816 — THE MEASUREMENT'S DEFAULT INK IS ITS OWN, NOT THE APP ACCENT. It used to be
 * PAL.accent, which is byte-for-byte the markup family's default FILL (#c2410c), so a
 * default-coloured measurement drawn over a default-coloured markup was INVISIBLE while being
 * painted on top of it — a hairline and a 10% tint over a solid slab of the same colour. That
 * read as a layering bug for weeks and is not one; the whole reasoning, and why the obvious teal
 * alternative was measured and rejected, is in shared/theme/familyInk.js. */
export const MEASURE_DEFAULT_COLOR = MEASURE_INK;

/* Built-in look, chosen to reproduce EXACTLY what a measurement looked like before it had any
 * style at all — an untouched plan must render byte-identically. weight 1.5 / +1 when selected,
 * fill opacity 0.10 / +0.06 when selected, solid line. */
export const MEASURE_LINE = { weight: 1.5, dash: "solid", fillOpacity: 0.1 };
export const MEASURE_SEL_WEIGHT_BUMP = 1;
export const MEASURE_SEL_FILL_BUMP = 0.06;

/* The style keys a measurement can carry, in panel order. `labelPpf` is NEW-2's per-measurement
 * "show label from this zoom in" threshold — it lives with the style keys because it is stamped,
 * defaulted and retroactively applied through exactly the same machinery. */
export const MEASURE_STD_KEYS = ["stroke", "weight", "dash", "fill", "fillOpacity", "labelPpf"];

/* ACCOUNT-scope defaults ("for all projects"), the mirror of planStyle's parcel/type register.
 * Kept here rather than threaded through call sites so every consumer resolves the same ladder:
 *   built-in  <  account default  <  project setting  <  per-measurement override */
let ACCOUNT_MEASURE_STD = {};
export const setAccountMeasureDefaults = (v) => { ACCOUNT_MEASURE_STD = { ...(v || {}) }; };
export const getAccountMeasureDefaults = () => ACCOUNT_MEASURE_STD;

/** The effective Standards value for one measure key: this plan's own copy over the account's. */
export const measureStdValue = (settings, key) =>
  ((settings && settings.measureStyle) || {})[key] ?? ACCOUNT_MEASURE_STD[key];

/**
 * Style keys STAMPED onto a freshly drawn measurement from the user's Standards defaults —
 * the exact mechanic `parcelDefaultStyle` uses for a new parcel (B929), so "Defaults for new
 * objects" means the same thing for both. Only keys the user actually customized are returned,
 * so an untouched default leaves the measurement on the built-in render fallbacks and a plan
 * drawn today looks identical to one drawn yesterday. Fill is opt-in: `fillOpacity` rides along
 * only when a fill colour is set.
 */
export function measureDefaultStyle(settings) {
  const ms = { ...ACCOUNT_MEASURE_STD, ...((settings && settings.measureStyle) || {}) };
  const out = {};
  if (ms.stroke) out.stroke = ms.stroke;
  if (ms.weight != null && ms.weight !== MEASURE_LINE.weight) out.weight = ms.weight;
  if (ms.dash && ms.dash !== MEASURE_LINE.dash) out.dash = ms.dash;
  if (ms.fill) {
    out.fill = ms.fill;
    if (ms.fillOpacity != null) out.fillOpacity = ms.fillOpacity;
  }
  if (Number.isFinite(ms.labelPpf) && ms.labelPpf > 0) out.labelPpf = ms.labelPpf;
  return out;
}

/**
 * Resolved paint for one measurement.
 * @param m            the measure object (may carry stroke/weight/dash/fill/fillOpacity)
 * @param uncalibrated true when the drawing has no scale yet (forces the amber warn state)
 * @param selected     bumps weight + fill opacity, exactly as the old hardcoded render did
 * @returns { stroke, fill, fillOpacity, weight, dash, warn } — `dash` is the NAME
 *          ("solid"/"dashed"/"dotted"), turned into a dash array by the caller's shared helper.
 *
 * B548816 — the `accent` option is GONE rather than defaulted, deliberately: a caller passing
 * the app accent is exactly the defect, and a silently-ignored option would let it come back.
 */
export function measureStyle(m, { uncalibrated = false, selected = false } = {}) {
  const accent = MEASURE_DEFAULT_COLOR;
  const o = m || {};
  const warn = !!uncalibrated;
  // The correctness override: amber wins over any user colour, for BOTH the line and the fill.
  const stroke = warn ? MEASURE_WARN_COLOR : (o.stroke || accent);
  const fill = warn ? MEASURE_WARN_COLOR : (o.fill || stroke);
  const baseW = Number.isFinite(o.weight) && o.weight > 0 ? o.weight : MEASURE_LINE.weight;
  const baseFo = Number.isFinite(o.fillOpacity) ? o.fillOpacity : MEASURE_LINE.fillOpacity;
  return {
    stroke,
    fill,
    fillOpacity: selected ? Math.min(1, baseFo + MEASURE_SEL_FILL_BUMP) : baseFo,
    weight: selected ? baseW + MEASURE_SEL_WEIGHT_BUMP : baseW,
    dash: o.dash || MEASURE_LINE.dash,
    warn,
  };
}

/* ------------------------------------------------- NEW-2: "show this label from THIS zoom in"
 *
 * Before this, a measurement's value label was gated by ONE global zoom floor
 * (dimCalloutVisible) with no per-object and no user control, so a survey-scale note and a
 * headline site area revealed and vanished together. The threshold below is a px-per-foot
 * number because that is what the render loop compares against — but it is NEVER shown as one:
 * the panel captures it from the live view with a single "Set at current zoom" click and reads
 * it back as a named zoom band (`zoomBandLabel`).
 */

/**
 * The zoom (px per foot) at or above which this measurement's summary shows: its own override,
 * else the Standards default, else `globalFloor` (the shared dimCalloutVisible floor, passed in
 * so this module stays free of a labelLayout import cycle).
 */
export function measureLabelThreshold(m, settings, globalFloor) {
  const own = m && m.labelPpf;
  if (Number.isFinite(own) && own > 0) return own;
  const std = measureStdValue(settings, "labelPpf");
  if (Number.isFinite(std) && std > 0) return std;
  return globalFloor;
}

/**
 * Is this measurement's summary label visible at `ppf`?
 * A SELECTED measurement always shows its value — you must be able to read what you are
 * editing (the same exception B149 / B121 / B225-B226 already make, and what the code did
 * before this item).
 *
 * `sheet` is the EXPORT pass (NEW-1). An export is a DOCUMENT, not a screenshot: every gate in
 * here is screen decluttering — it exists so the canvas stays readable while you work — and none
 * of that reasoning applies to a sheet that will be read at full size on paper. So on the sheet
 * the value ALWAYS renders, and the threshold above (whether the user's per-measurement pin, the
 * Standards default, or the shared floor) governs the CANVAS ONLY. This is the whole of the
 * owner's Sylvestri defect: he was zoomed out to see his multi-parcel site — the normal thing to
 * do before printing — so the numbers were below the gate and simply were not in the DOM to clone,
 * and the sheet printed anonymous marks.
 */
export function measureLabelVisible(m, ppf, { settings, globalFloor, selected = false, sheet = false } = {}) {
  if (sheet || selected) return true;
  return ppf >= measureLabelThreshold(m, settings, globalFloor);
}

/** Does this measurement (or the Standards default) pin its own reveal zoom? */
export const hasLabelThreshold = (m, settings) =>
  (Number.isFinite(m && m.labelPpf) && m.labelPpf > 0) ||
  (Number.isFinite(measureStdValue(settings, "labelPpf")) && measureStdValue(settings, "labelPpf") > 0);

/* Named zoom bands. The owner rule is explicit that a raw zoom/pixel number means nothing to
 * him, so every reveal-threshold readout in the UI is one of these words. Bands are chosen off
 * the planner's real range: default working zoom ~0.35 px/ft, hard cap 8. */
const ZOOM_BANDS = [
  { max: 0.08, label: "Region" },
  { max: 0.18, label: "Whole site" },
  { max: 0.5, label: "Site overview" },
  { max: 1.5, label: "Working zoom" },
  { max: 4, label: "Close in" },
  { max: Infinity, label: "Detail" },
];
export function zoomBandLabel(ppf) {
  if (!Number.isFinite(ppf) || ppf <= 0) return "Whole site";
  return ZOOM_BANDS.find((b) => ppf < b.max).label;
}

/** The plain-English readout under the "Set at current zoom" button. Never a number. */
export function labelRevealNote(m, settings, globalFloor) {
  const t = measureLabelThreshold(m, settings, globalFloor);
  const pinned = hasLabelThreshold(m, settings);
  return `Shows from ${zoomBandLabel(t)} in${pinned ? "" : " (default)"}`;
}
