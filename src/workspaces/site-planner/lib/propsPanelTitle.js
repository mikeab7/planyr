/* ONE source for the Properties panel's title (B-NEW-1, owner 2026-10-08).
 *
 * Every properties panel (site element, markup, measurement, callout, multi-selection) shows ONE
 * header row carrying just the selected thing's own type name in title case — "Cloud", "Building",
 * "Distance", "Text box". No category prefix ("Element ·", "Markup ·", "Selected ·"), no middle-dot
 * breadcrumb, no second header row beneath it. The header row in SitePlanner.jsx reads this and the
 * per-kind inner <Section> wrappers render title-less, so a new panel cannot grow a second header
 * without going through here.
 *
 * Pure: takes already-resolved labels, reads nothing from the planner.
 */

const MEASURE_LABEL = { line: "Distance", polyline: "Polyline length", area: "Area", count: "Count" };

/** Title-case a markup kind id ("cloud" → "Cloud", "polyline" → "Polyline"). */
export function kindTitle(kind) {
  const k = String(kind || "").trim();
  return k ? k[0].toUpperCase() + k.slice(1) : "";
}

/** The measurement's own name ("Distance" / "Area" / …) from its mode. */
export function measureTitle(mode) {
  return MEASURE_LABEL[mode] || "Measurement";
}

/**
 * @param {object} p
 * @param {number} [p.multiCount]    members of a multi-selection (>1 → "N selected")
 * @param {string} [p.measureMode]   set when a measurement is selected
 * @param {object} [p.callout]       the selected callout / text box (reads `noLeader`)
 * @param {object} [p.markup]        the selected markup (reads `kind`)
 * @param {string} [p.elementLabel]  the selected site element's display name
 */
export function propsPanelTitle({ multiCount = 0, measureMode = null, callout = null, markup = null, elementLabel = "" } = {}) {
  if (multiCount > 1) return `${multiCount} selected`;
  if (measureMode != null) return measureTitle(measureMode);
  if (callout) return callout.noLeader ? "Text box" : "Callout";
  if (markup) return kindTitle(markup.kind) || "Markup";
  return elementLabel || "Element";
}
