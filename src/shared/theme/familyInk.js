/* THE DEFAULT INK OF EACH DRAWN FAMILY — one table, and the rule that keeps them apart (B548816).
 *
 * ⛔ WHAT WENT WRONG, measured on the owner's own plan and reported by him. A measurement drawn
 * over a markup vanished. It read as a LAYERING bug — "the measurement is behind the markup" —
 * and the first diagnosis said exactly that. It was wrong, and reordering anything would have
 * been the wrong fix. The measurement was ON TOP the whole time. It was CAMOUFLAGED:
 *
 *     the site-planner measurement's default ink   PAL.accent  = #C2410C = rgb(194, 65, 12)
 *     the markup family's default FILL             tools.matrix = #c2410c = rgb(194, 65, 12)
 *
 * Identical. And a measurement is a hairline stroke plus a ten-percent tint, so painted over a
 * SOLID fill of its own colour there is nothing left to see. Two element classes had been given
 * the same default colour, and the class that lost the fight is the one whose entire job is to
 * display a NUMBER.
 *
 * ⛔ WHY IT SURVIVED EVERY PROBE, including this session's own. A harness seeds markups in
 * deliberately loud colours so it can tell them apart — this one used red #c02020 and blue
 * #2020c0 — and against those the measurement is perfectly visible. It is ONLY the default that
 * collides, which is to say only what a real user actually draws. Same species as B820's four
 * correct-but-wrong-case fixes: the fixture hid the defect.
 *
 * THE RULE, in the owner's words: an element whose job is to display a number must never be able
 * to disappear into another element, and two different element classes must not share a default
 * colour. This module is where that is decided, and `test/familyInk.test.js` is where it is
 * enforced — pairwise CIEDE2000, not string inequality, because #c2410c and #c3420d are also
 * "different colours" and would camouflage just as completely.
 *
 * ⛔ SITE-ELEMENT TYPE COLOURS ARE DELIBERATELY NOT IN THE PAIRWISE SET, and that is not an
 * exemption of convenience. Paving, road, sidewalk and trailer parking are all pavement, they are
 * all meant to read as one material family, and their strokes sit 9–11 ΔE00 apart ON PURPOSE.
 * They are told apart by FILL, PATTERN and SHAPE — a hatched landscape polygon is never mistaken
 * for a road. An annotation has none of that: it is a thin line and a tint, and hue is all it has.
 * So the rule is "every annotation ink must stand clear of every other annotation ink AND of every
 * element colour it may be drawn over", which is exactly what the guard checks.
 *
 * Pure data + one pure predicate; no React, no DOM, no theme read. Both themes share these inks
 * (a measurement is magenta in light and dark alike — the canvas is a drawing, not chrome).
 */

/* The distinctness bar, chosen BEFORE the candidate colours were measured (PERCEPTUAL-PARITY §4).
 * The classical just-noticeable difference for two large adjacent patches is ΔE00 = 1.0. Telling
 * two OBJECT CLASSES apart at a glance, across a busy drawing, at working zoom, through a 10%
 * tint, is a far harder ask than noticing an edge, so the bar is an order of magnitude above the
 * JND. Raising or lowering it is a product decision about drawing legibility — argue it on the
 * item, never nudge it to make a run pass. */
export const INK_DISTINCT_MIN_DE = 10.0;

/* ⛔ THE MEASUREMENT'S OWN INK. Magenta, and it is the one value in this file that CHANGED — it
 * was PAL.accent, the same burnt orange the markup family fills with by default.
 *
 * Why magenta and not the obvious candidate: Document Review already gives its measure kinds a
 * teal ink (#0e7490, `markupStyle.js` MEAS_STROKE) and the tidy answer was to adopt it here, so
 * one workspace's measurement looks like the other's. It was measured and REJECTED — teal sits
 * 9.1 ΔE00 from the detention-pond stroke (#2C5D6B), under the bar, and a measurement drawn
 * around a pond is one of the most common things on these plans. Trading one camouflage for
 * another is not a fix. Magenta clears every element colour and every other annotation ink by
 * 25 ΔE00 or more, and is the traditional dimension colour on a civil sheet besides.
 *
 * An existing measurement that carries its own `stroke` / `fill` keeps it — this is the fallback
 * only, so a colour the user chose is never overwritten. */
export const MEASURE_INK = "#A21CAF";

/* The default ink of every family whose colour is a FREE CHOICE — the ones this rule governs.
 * `markup` and `callout` are recorded here as the values they already are (from
 * shared/markup/tools.matrix.js and the planner's `calloutStyle`), so the table states the whole
 * constraint rather than one side of it; if either moves, the guard re-checks the pair. */
export const FAMILY_DEFAULT_INK = {
  measure: MEASURE_INK,   // the number-bearing family — the one this item exists for
  markup:  "#c2410c",     // tools.matrix.js PROPERTY_COLUMNS.stroke/.fill default (burnt orange)
  callout: "#1f2937",     // SitePlanner calloutStyle default border/ink (slate) on its cream plate
  parcel:  "#34E802",     // PAL.canvasParcel — the owner's property-line green
  /* The revision-cloud tool's own default (`lib/cloudGeometry.js` CLOUD_DEFAULT_INK). Picked
   * explicitly distinct from `markup` — a cloud drawn with no colour change must never read as an
   * ordinary rectangle/polygon markup, which is exactly the class of camouflage this file exists to
   * prevent, and the same #c2410c a cloud would otherwise inherit is the collision the tool's own
   * spec calls out by name. Measured 12.2–19.6 ΔE00 clear of every other entry here (worst case is
   * the detention-pond fill) — see `test/familyInk.test.js`.
   */
  cloud:   "#2563EB",
};

/* Every colour a site element paints by default, fill and stroke, flattened — the surfaces an
 * annotation gets drawn ON TOP OF. Mirrored from planStyle.js TYPES; the guard asserts the mirror
 * is complete, so a new element type cannot be added without this list noticing. */
export const ELEMENT_DEFAULT_PAINT = {
  building:  ["#f3ece1", "#33302b"],
  paving:    ["#d6d1c7", "#9a9384"],
  parking:   ["#cdd7dd", "#7d949e"],
  trailer:   ["#e3d4b2", "#b09a6c"],
  pond:      ["#5B97A5", "#2C5D6B"],
  sidewalk:  ["#eceae3", "#b4b1a6"],
  landscape: ["#bcd3a6", "#7f9a63"],
  road:      ["#b9b4a8", "#7c786d"],
};

/** "#rgb" / "#rrggbb" → [r, g, b] 0..255. Returns null for anything else (a var(), a named
 *  colour, a user's malformed entry) so a caller can skip rather than compare garbage. */
export function parseHex(c) {
  const s = String(c || "").trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(s)) return [0, 1, 2].map((i) => parseInt(s[i] + s[i], 16));
  if (/^[0-9a-fA-F]{6}$/.test(s)) return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
  return null;
}
