/* The look of the Counties & Cities lines (B2507065 / NEW-10, owner constraint #47) — three ranks of line that never read as the same thing:
 *   cities   a bolder outline + a light tint inside (nothing outside it = unincorporated);
 *   counties a heavier DASHED GREY line with a light halo (`.pf-county-line` in index.css) — dashed, so it is not mistaken for a city limit;
 *   states   heavier still (adminBoundaryData.EMPHASIS_STATE_STYLE, drawn while this layer is on).
 * One home for the numbers so the planner, the Map view and the PDF cannot drift. Colours are map ink (cartography, not UI chrome). */
export const COUNTY_LINE_COLOR = "#4b5563"; // design-exempt: map ink — the county line's neutral grey
export const COUNTY_LINE_WEIGHT = 2.8;
export const COUNTY_LINE_DASH = "10 6";
export const CITY_LINE_MIN_WEIGHT = 3.5;
export const CITY_TINT_OPACITY = 0.2;
/* NEW-1 (owner 2026-11-05, Academy › Concept A: "every boundary is drawn in the same blue … Sugar Land, Missouri City, Stafford, Houston, Richmond and Rosenberg are
 * indistinguishable"): each city gets ITS OWN hue (palette below, assigned by `boundaryPaint.createColorBook` so two neighbours never share one), its limits a bold solid
 * outline + a light tint, its ETJ the SAME hue thinner and dashed with a fainter tint — line weight and dash, never hue, tell limits from ETJ. */
export const ETJ_LINE_WEIGHT = 2;
export const ETJ_LINE_DASH = "7 6";
export const ETJ_TINT_OPACITY = 0.09;
export const PLACE_PALETTE = [
  "#2563eb", // design-exempt: map ink — place hue 1 (blue)
  "#ea580c", // design-exempt: map ink — place hue 2 (orange)
  "#16a34a", // design-exempt: map ink — place hue 3 (green)
  "#9333ea", // design-exempt: map ink — place hue 4 (violet)
  "#0891b2", // design-exempt: map ink — place hue 5 (cyan)
  "#db2777", // design-exempt: map ink — place hue 6 (pink)
  "#ca8a04", // design-exempt: map ink — place hue 7 (gold)
  "#92400e", // design-exempt: map ink — place hue 8 (brown)
];
/* A name that is the place's own label — never the layer's — keeps its pill legible on any imagery. */
export const PLACE_LABEL_INK = "#fff"; // design-exempt: map ink — place-name text on its coloured pill
export const PLACE_PILL_ETJ_BG = "rgba(255,255,255,0.88)"; // design-exempt: map ink — an ETJ name's pale pill (dashed in the place's hue)
export const PLACE_PILL_SHADOW = "0 0 0 1px rgba(255,255,255,0.55),0 1px 4px rgba(0,0,0,0.45)"; // design-exempt: map ink — the pill's keyline + lift over any imagery
export const PLACE_LABEL_SHADOW = "0 0 3px rgba(0,0,0,0.9),0 0 7px rgba(0,0,0,0.55)"; // design-exempt: map ink — a bare name's halo over any imagery
export const BOUNDARY_FALLBACK_INK = "#374151"; // design-exempt: map ink — a boundary row with no colour of its own
export const STATE_LINE_CASING = "#000"; // design-exempt: map ink — the state line's dark casing
export const STATE_LINE_CORE = "#fff"; // design-exempt: map ink — the state line's light core
/* The ONE click highlight (B2507061 amendment): a clicked feature is outlined in this colour until its card closes — never a hover. */
export const CLICK_HIGHLIGHT_COLOR = "#f97316"; // design-exempt: map ink — the clicked feature's outline
export const CLICK_HIGHLIGHT_WEIGHT = 4;
