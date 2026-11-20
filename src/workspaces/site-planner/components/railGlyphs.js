/* Rail-icon artwork that is too fiddly to live inline in SitePlanner.jsx's RAIL_ICONS table (NEW-1, B2591568).
 *
 * Plain data on purpose (no JSX, no imports) so the harness and the node test can read the exact path strings
 * the dock registers. Every glyph is drawn on the dock's 24-unit grid and inherits the shared RailIcon's stroke
 * (1.75, round cap, round join, currentColor) — nothing here sets a colour, so the selected state needs no special case.
 */

/* Grading (owner-only): a small hill drawn as three nested contour lines, the surveyor's spot elevation below-right.
 * Cubic curves only, tangent-continuous (the two control points either side of each join sit level with it, so the curve crosses the crest horizontally), the lines 3.7 units apart
 * (outer crest y 6, middle 9.7, inner 13.4) and their feet 3.7 / 3.8 apart — an even gap, so it reads as topo, not a
 * rainbow. The crests lean upper-right of centre and the right-hand tails flare off at different heights, so the
 * shape is a knoll rather than a target. The old glyph (a dome on a baseline) is gone from the bundle. */
export const GRADING_GLYPH = Object.freeze({
  contours: Object.freeze([
    "M2.5 17C3.7 10.8 7.6 6 13 6C17.6 6 19.4 9.6 21.5 11",
    "M6.2 17C7.2 12.8 9.6 9.7 13 9.7C15.7 9.7 17 11.6 18.8 12.4",
    "M10 17C10.9 14.8 12.2 13.4 13.9 13.4C15.1 13.4 15.8 14 16.2 14.5",
  ]),
  /* The spot-elevation triangle: 2.5 units of geometry (about 3.5 painted with its thin rounded edge), filled (the only filled mark in the rail), stroke thinned to 1 so its
   * corners round without ballooning the mark. */
  spot: "M17.3 21.5l1.8-2.5 1.8 2.5z",
  spotStrokeWidth: 1,
});
