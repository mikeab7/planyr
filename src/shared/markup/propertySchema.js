/* Shared PROPERTY SCHEMA (B423 / NEW-2).
 *
 * Bridges the tool matrix (which property COLUMNS a tool exposes) to a live markup (the
 * CURRENT value of each). The shared PropertyPanel renders exactly what `schemaForMarkup`
 * returns, so the panel can never drift from the matrix — adding a column to a matrix row
 * makes the control appear, and the NEW-9 conformance test asserts the two agree.
 *
 * It also owns the canonical-key ⇄ host-field reconciliation: the engine speaks neutral
 * keys (`strokeWidth`, `strokeStyle`, `fontColor`), while the Site Planner persists its own
 * historical field names (`weight`, `dash`, `color`). `readProp`/`writeProp` map between
 * them so neither host has to rename its stored data. Pure: matrix only.
 */
import { propsForTool, columnMeta, toolById } from "./tools.matrix.js";

/* Canonical key → candidate stored fields (first match wins on read; the FIRST entry is the
 * canonical write target). Keeps the Site Planner's legacy field names readable without a
 * data migration. */
const FIELD_ALIASES = {
  stroke:         ["stroke"],
  strokeWidth:    ["strokeWidth", "weight"],
  strokeStyle:    ["strokeStyle", "dash"],
  opacity:        ["opacity"],
  fill:           ["fill"],
  fillOpacity:    ["fillOpacity"],
  arrowStart:     ["arrowStart"],
  arrowEnd:       ["arrowEnd"],
  fontSize:       ["fontSize", "size"],
  fontColor:      ["fontColor", "color"],
  bold:           ["bold"],
  italic:         ["italic"],
  underline:      ["underline"],
  align:          ["align"],
  lineHeight:     ["lineHeight"],
  padding:        ["padding", "padX"],
  measureCaption: ["measureCaption", "showLabel"],
};

const aliases = (key) => FIELD_ALIASES[key] || [key];

/* Map a stored markup to its matrix tool id. Shape/measure kinds ARE matrix ids; the Site
 * Planner's measure records use a `mode` (line/polyline/area) instead, mapped here. */
const MODE_TO_ID = { line: "distance", polyline: "polylength", area: "area" };
export function toolIdForMarkup(m) {
  if (!m) return null;
  if (toolById(m.kind)) return m.kind;
  if (m.mode && MODE_TO_ID[m.mode]) return MODE_TO_ID[m.mode];
  return null;
}

/** Current value of a canonical property on a markup (its column default if unset). */
export function readProp(m, key) {
  for (const f of aliases(key)) if (m && m[f] !== undefined) return m[f];
  const meta = columnMeta(key);
  return meta ? meta.default : undefined;
}

/** A patch object that writes a canonical property using the markup's existing field name
 *  (so the Site Planner keeps writing `weight`, Document Review writes `strokeWidth`). */
export function writeProp(m, key, value) {
  for (const f of aliases(key)) if (m && m[f] !== undefined) return { [f]: value };
  return { [aliases(key)[0]]: value }; // not yet set → write the canonical field
}

/* The ordered control list for a markup's property panel: one entry per matrix column the
 * markup's tool exposes, each carrying its column metadata + the markup's current value. */
export function schemaForMarkup(m) {
  const id = toolIdForMarkup(m);
  if (!id) return [];
  return propsForTool(id).map((key) => ({ key, value: readProp(m, key), ...columnMeta(key) }));
}
