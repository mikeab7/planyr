/* Shared per-object markup STYLE resolution (B734 / NEW-1).
 *
 * ONE place that turns a markup's stored style fields into the values a renderer paints,
 * applying the historical per-KIND default when a field is unset. Both the shared
 * `MarkupRenderer` (committed markups) and the Document Review draft preview (in-progress
 * markups) resolve through this, so a shape can never preview one color and commit another
 * (the B734 draft↔commit drift). Pure: matrix + propertySchema only, no React/DOM.
 *
 * The default MODEL is per-object-stored-fields with a kind-keyed fallback (the convention
 * NEW-2 standardized on): a markup owns concrete `stroke`/`fill` once committed, but an
 * absent field falls back to its kind's historical color — teal for measures, burnt-orange
 * for annotations — so a new markup looks the way that kind always looked until edited.
 */
import { readProp } from "./propertySchema.js";
import { isClosedTool } from "./tools.matrix.js";

/* Kinds that read a real-world value (their historical ink is teal). `dimension` is a
 * length annotation but shares the measure ink. Mirrors MarkupRenderer's MEASURE_KINDS. */
export const MEASURE_KINDS = new Set(["distance", "polylength", "perimeter", "area", "count", "dimension"]);

export const ANNOT_STROKE = "#c2410c"; // annotation default (matches PROPERTY_COLUMNS.stroke)
export const MEAS_STROKE  = "#0e7490"; // measure overlay ink (teal)

/* The historical default style for a KIND: measures teal, annotations burnt-orange. A closed
 * measure (area / perimeter) also carries a matching fill so its wash reads teal, not orange.
 * Used BOTH to seed a new markup at commit and as the render fallback for an unset field, so
 * the two can't diverge. */
export function kindDefaults(kind) {
  const isMeas = MEASURE_KINDS.has(kind);
  const d = { stroke: isMeas ? MEAS_STROKE : ANNOT_STROKE };
  if (isMeas && isClosedTool(kind)) d.fill = MEAS_STROKE;
  return d;
}

/* Resolve a markup's DISPLAY style. A per-object field wins; an unset stroke/fill falls back
 * to the kind default (never the generic column default, which would paint every measure
 * orange). Width / dash / opacity / fillOpacity read through `readProp` so the Site Planner's
 * legacy field names (weight/dash) still resolve. Returns raw values — each renderer maps
 * `strokeStyle` to its own dash-array units (page-px vs 0..1). */
export function resolveMarkupStyle(m) {
  const kd = kindDefaults(m && m.kind);
  return {
    stroke:      (m && m.stroke != null) ? m.stroke : kd.stroke,
    strokeWidth: readProp(m, "strokeWidth") || 2,
    strokeStyle: readProp(m, "strokeStyle") || "solid",
    opacity:     readProp(m, "opacity") ?? 1,
    fill:        (m && m.fill != null) ? m.fill : (kd.fill ?? "none"),
    fillOpacity: readProp(m, "fillOpacity") ?? 0,
  };
}
