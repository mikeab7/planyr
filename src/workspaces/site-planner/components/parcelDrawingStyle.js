/* Pure per-object style helpers for the ParcelDrawing overlay (B735 / NEW-2).
 *
 * Brings the parcel-drawing overlay onto the SHARED per-object style model instead of its old
 * single-`color`-per-mark fork: every mark now carries stroke/weight/dash/opacity (+ fill for the
 * closed Box), and the overlay's property panel is the shared PropertyPanel driven by these keys.
 * These helpers are pure (no React/DOM) so they unit-test, and they reuse the shared column
 * metadata so the overlay can never drift from the one style vocabulary.
 *
 * The overlay keeps its own 0..1 coordinate space + persistence — this adopts the shared style
 * MODEL, not the full MarkupRenderer/matrix coordinate port.
 */
import { columnMeta } from "../../../shared/markup/tools.matrix.js";

/* Which shared property columns each overlay tool exposes — capability-driven (a control shows
 * only if the tool can use it, hidden otherwise). Mirrors the shared closed→fill rule: only the
 * closed Box (rect) gets a fill; open marks get stroke/weight/dash; text gets its text color. */
export const PD_PROPS = {
  pen:     ["stroke", "strokeWidth", "strokeStyle", "opacity"],
  line:    ["stroke", "strokeWidth", "strokeStyle", "opacity"],
  measure: ["stroke", "strokeWidth", "strokeStyle", "opacity"],
  calib:   ["stroke", "strokeWidth"],
  rect:    ["stroke", "strokeWidth", "strokeStyle", "opacity", "fill", "fillOpacity"],
  text:    ["fontColor"],
};

/* The overlay's historical default ink (its old first swatch), so a fresh mark looks exactly as
 * before until edited. */
export const PD_DEFAULT_COLOR = "#dc2626";

/* Sticky default style: shared column defaults, with the color keys pinned to the overlay's
 * historical red so nothing changes visually until the user edits it. */
export const PD_DEFAULT_STYLE = {
  stroke:      PD_DEFAULT_COLOR,
  strokeWidth: columnMeta("strokeWidth").default,
  strokeStyle: columnMeta("strokeStyle").default,
  fill:        PD_DEFAULT_COLOR,
  fillOpacity: columnMeta("fillOpacity").default,
  opacity:     columnMeta("opacity").default,
  fontColor:   PD_DEFAULT_COLOR,
};

/* Dash-array in the overlay's 0..1 viewBox units (its stroke is non-scaling). The calibration
 * line keeps its signature dash regardless of the user's strokeStyle. */
const PD_DASH = { solid: undefined, dashed: "0.012 0.008", dotted: "0.004 0.006" };
export const dashFor = (m) => (m && m.type === "calib" ? "0.012 0.008" : PD_DASH[(m && m.strokeStyle) || "solid"]);

/* One-time read-migration: legacy marks carried a single `color`. Map it onto the shared field
 * names (text→fontColor, everything else→stroke) so existing drawings keep their colors — no
 * silent data loss (LOUD-FAILURE). Idempotent: a mark already on the new model is returned as-is. */
export function migrateMark(m) {
  if (!m || typeof m !== "object" || Array.isArray(m)) return m;
  if (m.stroke != null || m.fontColor != null) return m; // already migrated
  const { color, ...rest } = m;
  const c = color != null ? color : PD_DEFAULT_COLOR;
  return m.type === "text" ? { ...rest, fontColor: c } : { ...rest, stroke: c };
}
export const migrateMarks = (marks) => (Array.isArray(marks) ? marks.map(migrateMark) : []);

/* Fields to stamp on a NEW mark of `type`, taken from the sticky style (its capability subset). */
export const stampStyle = (style, type) =>
  Object.fromEntries((PD_PROPS[type] || []).map((k) => [k, style[k]]));

/* The capability-driven control list for the shared PropertyPanel: one entry per exposed column
 * carrying the subject's current value + the column metadata (type/label/min/max/options). */
export function pdSchema(subject) {
  const keys = PD_PROPS[subject && subject.type] || [];
  return keys.map((key) => ({ key, value: subject[key] ?? columnMeta(key)?.default, ...columnMeta(key) }));
}
