/* Shared hatch-pattern catalog — a small, pure, extensible appearance primitive.
 *
 * First consumer: easement + encumbrance polygons (site-planner/lib/easements.js,
 * NEW-EASE-STYLE). Before this, NO element type in the app carried an editable
 * colour/fill/hatch — easements rendered from a fixed per-TYPE colour with a
 * hardcoded diagonal hatch baked directly into SitePlanner.jsx's <defs>, and no
 * object could ever override it. This module (the catalog) + the resolvers in
 * easements.js (the type-default/per-element-override precedence) are written as
 * a general appearance model on purpose, so a future element type (a markup, a
 * pond, a parcel) that wants a user-editable hatch can reuse this catalog and the
 * same resolver shape instead of growing a second one. Only easements/encumbrances
 * are WIRED to it this session — extending it elsewhere is a follow-up, not a
 * rewrite.
 *
 * Tiles are pure DATA — a renderer (SVG/JSX, necessarily in a .jsx file) turns a
 * spec into an actual <pattern>. Every existing hand-authored pattern in this app
 * (pat-berm, pat-trailer, pat-sidewalk, pat-landscape, the old pat-ease-* set) uses
 * `patternUnits="userSpaceOnUse"` with a small constant-PIXEL tile (7-9px) and NO
 * scale ancestor — the planner projects feet -> screen px before drawing, so there
 * is no SVG <scale> transform on the geometry a pattern tile could inherit. That
 * means a hatch tile stays the SAME apparent size on screen at every zoom level: it
 * can never coarsen into a solid block zoomed in, or thin into aliased mush zoomed
 * out. This module keeps that exact technique for every new/parameterised pattern,
 * rather than inventing a feet-scaled hatch that would have that problem.
 *
 * ⛔ CORRECTED (B794960) — this module used to end by claiming "no export-specific
 * pattern handling is needed or should be added." That was WRONG. PDF/PNG export (exportSheet.js
 * `buildExportSvgRaw`) clones the live <svg> verbatim, so a <pattern> defined in the
 * live <defs> DOES survive export automatically — but `buildComposedSheet` then nests
 * that clone as its OWN `<svg viewBox=…>` inside the sheet, sized to a FIXED physical
 * plan box (centi-inches). The browser's native SVG rasterizer (exportSheet.js's
 * `exportPDF` loads the composed sheet into a real `<img>` and draws it to a canvas)
 * applies that nested viewBox's fit scale to EVERYTHING inside it, patterns included —
 * so a tile's declared constant-canvas-px size prints at a PHYSICAL size that varies
 * with whatever live zoom (`rppf`) was active when the export was captured, exactly
 * the defect class `exportStyle.js` already solved for stroke width ("independent of
 * the zoom the user was at when they hit print"). The renderer (SitePlanner.jsx's
 * `HatchPatternDef` + its sibling hand-authored patterns) now composes a `labelK`
 * correction into `patternTransform` — 1 on screen (byte-identical), the sheet's own
 * scale during export — so the tile's PRINTED size stops depending on capture zoom.
 */

export const HATCH_OPTIONS = [
  { key: "none", label: "None (flat fill)" },
  { key: "diagonal", label: "Diagonal" },
  { key: "diagonalReverse", label: "Diagonal (reverse)" },
  { key: "cross", label: "Cross-hatch" },
  { key: "horizontal", label: "Horizontal" },
  { key: "vertical", label: "Vertical" },
  { key: "dots", label: "Dots" },
];

const HATCH_KEYS = new Set(HATCH_OPTIONS.map((h) => h.key));
export const isHatchKey = (k) => typeof k === "string" && HATCH_KEYS.has(k);

// Pure geometry recipe per pattern key. `null` ("none") means a flat wash with no
// line/dot overlay — a deliberate, valid choice (some easement types read cleaner
// as a plain colour band, e.g. an access easement). Tile size/rotation match the
// app's existing hand-authored patterns so a new hatch reads at the same visual
// weight as the ones already on screen.
const SPEC = {
  none: null,
  diagonal: { size: 7, rotate: 45, lines: [[0, 0, 0, 7]] },
  diagonalReverse: { size: 7, rotate: -45, lines: [[0, 0, 0, 7]] },
  cross: { size: 7, rotate: 45, lines: [[0, 0, 0, 7], [0, 0, 7, 0]] },
  horizontal: { size: 7, rotate: 0, lines: [[0, 0, 7, 0]] },
  vertical: { size: 7, rotate: 0, lines: [[0, 0, 0, 7]] },
  dots: { size: 7, rotate: 0, dot: [1.4, 1.4, 0.7] },
};

/** The tile recipe for a hatch key. A corrupt/legacy/unknown key (never "none",
 * which is a deliberate valid choice) falls back to "diagonal" rather than
 * throwing — a bad stored value must degrade to a visible default, never crash
 * the render (LOUD-FAILURE is for writes/fetches; a paint path stays defensive). */
export const hatchSpec = (key) => {
  if (key === "none") return null;
  return Object.prototype.hasOwnProperty.call(SPEC, key) ? SPEC[key] : SPEC.diagonal;
};
