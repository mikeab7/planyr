/* The look of the Counties & Cities lines (B2507065 / NEW-10, owner constraint #47) — three ranks of line that never read as the same thing:
 *   cities   a bolder outline + a light tint inside (nothing outside it = unincorporated);
 *   counties a heavier DASHED GREY line with a light halo (`.pf-county-line` in index.css) — dashed, so it is not mistaken for a city limit;
 *   states   heavier still (adminBoundaryData.EMPHASIS_STATE_STYLE, drawn while this layer is on).
 * One home for the numbers so the planner, the Map view and the PDF cannot drift. Colours are map ink (cartography, not UI chrome). */
export const COUNTY_LINE_COLOR = "#4b5563"; // design-exempt: map ink — the county line's neutral grey
export const COUNTY_LINE_WEIGHT = 2.8;
export const COUNTY_LINE_DASH = "10 6";
export const CITY_LINE_MIN_WEIGHT = 3;
export const CITY_TINT_OPACITY = 0.12;
