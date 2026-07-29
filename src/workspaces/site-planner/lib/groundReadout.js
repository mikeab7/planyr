/* NEW-2 — THE ONE composition of the map's cursor elevation readout (the chip at the
 * bottom of both map surfaces). Pure: takes the two sampled states and returns the
 * segments to paint, so the planner canvas and the map finder cannot drift, and so the
 * whole state machine unit-tests in plain node.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: the elevation field is ALWAYS PRESENT. B706
 * rendered no-data, void, in-flight and failure all as ABSENCE — "the segment simply
 * doesn't appear" — so whenever the fast local path was unavailable (layer off, or the
 * map below the contour gate) the field silently vanished mid-drag and read as a glitch,
 * indistinguishable from a real "nothing here." The no-fabrication rule was right; the
 * vanishing was not. Every state now has a NAME:
 *   value       → "Exist 152.6"     (a coarse grid cell is marked ≈ and explained)
 *   pending     → "Exist …"          (a sample is in flight)
 *   void        → "Exist — (no data here)"   (DEM void / water)
 *   unavailable → "Exist — (unavailable)"    (the endpoint failed)
 * No state ever invents a number.
 *
 * PROPOSED rides the same line where the concept has a graded surface under the cursor,
 * and the signed delta is the point of the pair — labelled Fill / Cut on the B809/B826
 * cut/fill ramp so the chip reads like the cut/fill exhibit. The delta is suppressed
 * whenever either side is unknown (a delta against a guess is a lie).
 */
import { FILL_RAMP, HEAT_RAMP, binIndex, ZERO_BAND_FT } from "./mitigationHeatmap.js";

// A grid cell wider than this is coarse enough that the point sample deserves a "≈".
export const COARSE_CELL_FT = 12;

const f1 = (n) => (Math.round(n * 10) / 10).toFixed(1);

/* The chip sits on a dark translucent panel over aerial imagery, so the delta takes the
 * READABLE end of each ramp — the same warm-fill / cool-cut families the cut/fill
 * exhibit uses (so the two read as one system), clamped to the light bins that clear
 * contrast on the chip. Depth is carried by the number; hue carries the direction. */
export const deltaColor = (dzFt) => {
  if (dzFt == null || !isFinite(dzFt)) return null;
  if (Math.abs(dzFt) < ZERO_BAND_FT) return "#D1D5DB";
  return dzFt > 0
    ? FILL_RAMP[Math.min(3, binIndex(dzFt))]
    : HEAT_RAMP[Math.min(2, binIndex(-dzFt))];
};

const PROP_REASON = {
  nosurface: "No proposed surface yet — set a finished floor (FFE) on the concept.",
  noffe: "No proposed surface yet — set a finished floor (FFE) on the concept.",
  outside: "No graded element here — the concept proposes nothing at this point.",
  pond: "Inside a pond — that dirt is priced as borrow in the excavation ledger, not as a graded surface.",
  void: "No ground data here, so the transition to existing grade can't be placed.",
};

const EXIST_TITLE = {
  pending: "Reading the ground elevation here…",
  void: "The elevation source reports no data at this point (open water or a LiDAR void).",
  unavailable: "The elevation source did not answer. Nothing is being guessed.",
};

/* el:   { status: "value"|"pending"|"void"|"unavailable", ft?, cellFt?, reason? }
 * prop: { status: "value"|"none", ft?, reason?, wedge? } — omit entirely on a surface
 *       with no concept (the map finder), where "proposed" has no meaning.
 * Returns { parts: [{ key, text, color? }], text, title }. Pure. */
export function groundReadout({ el = null, prop = null } = {}) {
  const parts = [];
  const notes = [];
  const st = (el && el.status) || "pending";
  const coarse = st === "value" && el.cellFt != null && el.cellFt > COARSE_CELL_FT;
  if (st === "value") {
    parts.push({ key: "exist", text: `Exist ${coarse ? "≈" : ""}${f1(el.ft)}`, numeric: true });
    if (coarse) notes.push("Sampled from a coarse elevation grid at this zoom — zoom in for a finer sample.");
  } else {
    parts.push({
      key: "exist",
      text: st === "pending" ? "Exist …" : `Exist — (${st === "void" ? "no data here" : "unavailable"})`,
      numeric: false,
    });
    if (EXIST_TITLE[st]) notes.push(EXIST_TITLE[st]);
  }
  if (prop) {
    if (prop.status === "value") {
      parts.push({ key: "prop", text: `Prop ${f1(prop.ft)}`, numeric: true });
    } else {
      parts.push({ key: "prop", text: "Prop —", numeric: false });
      const r = PROP_REASON[prop.reason] || PROP_REASON.outside;
      notes.push(r);
    }
    // The delta is the point of showing both — but only when BOTH sides are real.
    if (prop.status === "value" && st === "value") {
      const dz = prop.ft - el.ft;
      parts.push(Math.abs(dz) < ZERO_BAND_FT
        ? { key: "delta", text: "On grade", numeric: false, color: deltaColor(dz) }
        : { key: "delta", text: `${dz > 0 ? "Fill" : "Cut"} ${f1(Math.abs(dz))}`, numeric: true, color: deltaColor(dz) });
    }
  }
  // The unit is written ONCE, on the last numeric segment — "Exist 152.6 · Prop 155.0 ·
  // Fill 2.4 ft" reads as one measurement, not three repetitions of a unit.
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].numeric) { parts[i] = { ...parts[i], text: `${parts[i].text} ft` }; break; }
  }
  return { parts, text: parts.map((p) => p.text).join(" · "), title: notes.join(" ") };
}
